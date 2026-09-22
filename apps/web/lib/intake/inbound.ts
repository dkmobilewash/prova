import crypto from "node:crypto";
import { prisma } from "@prova/db";
import { classifyDocument } from "@/lib/intake/classify";
import { isIntakeKind, soleJobForHint } from "@/lib/intake/review";
import {
  INTAKE_MAX_FILE_BYTES,
  displayFileName,
  intakeUploadPathname,
  isAllowedIntakeType,
} from "@/lib/intake/upload";

/**
 * Forward-an-email intake: the provider-agnostic half.
 *
 * Onboarding paper arrives by email — a GC's transmittal, a returned
 * submittal, a COI from an insurance broker — and "save the attachment,
 * open /intake, drop it in" is three steps where forwarding is one. So each
 * company gets its own inbound address, `docs-<token>@<domain>`, and
 * anything forwarded there lands in the tray exactly as if it had been
 * dropped in: same blob prefix, same classifier, same "nothing files until
 * a person confirms".
 *
 * THE TOKEN IS THE ONLY THING TRUSTED. The recipient address routes to a
 * company because only this app issues tokens and the token is unguessable
 * (128 random bits). The sender, the subject, and everything else in the
 * email are DISPLAY ONLY — a From header is whatever the sender typed, so
 * it is stored as provenance for a person to read and never used to
 * resolve, file, or authorise anything.
 *
 * Nothing provider-specific lives in this file. The Resend adapter
 * (lib/intake/resend-inbound.ts) verifies the webhook signature, parses
 * the payload, and hands `processInboundEmail` a normalised email whose
 * attachments know how to fetch their own bytes. A second provider is a
 * second adapter, not a second copy of the rules below.
 */

/* ----------------------------- the address ----------------------------- */

/** The local part is `docs-<token>`. "docs" says what the address is for on
 * sight in a forward dialog; the token does the routing. */
export const INTAKE_ADDRESS_PREFIX = "docs-";

/** 32 lowercase hex chars — 128 random bits, same shape the migration
 * backfills. Local part stays well under SMTP's 64-char limit
 * ("docs-" + 32 = 37). */
export function newIntakeEmailToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** The receiving domain, e.g. `in.cstream.ai`. Null when this install has
 * no inbound email configured — the UI then shows no address rather than a
 * broken one. */
export function intakeInboundDomain(env: NodeJS.ProcessEnv): string | null {
  const domain = env.INTAKE_INBOUND_DOMAIN?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return domain;
}

export function intakeEmailAddress(token: string, domain: string): string {
  return `${INTAKE_ADDRESS_PREFIX}${token}@${domain}`;
}

/** Tokens as this app issues them. Bounded so an attacker-controlled
 * recipient string cannot feed an unbounded value into the lookup. */
const TOKEN_PATTERN = /^[a-z0-9]{16,64}$/;

/** The token in one recipient address, or null. Accepts `Name <addr>`
 * shapes defensively even though providers hand over bare addresses. */
export function intakeTokenFromAddress(recipient: string, domain: string): string | null {
  const angled = /<([^<>]+)>/.exec(recipient);
  const address = (angled ? angled[1] : recipient).trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  if (address.slice(at + 1) !== domain) return null;
  const local = address.slice(0, at);
  if (!local.startsWith(INTAKE_ADDRESS_PREFIX)) return null;
  const token = local.slice(INTAKE_ADDRESS_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

/** First token found across the recipients, in the order given. The caller
 * puts the envelope recipient (`received_for`) first: a forward's To line
 * is the FORWARDER's view, and the envelope is where the mail actually
 * went. */
export function intakeTokenFromRecipients(recipients: string[], domain: string): string | null {
  for (const recipient of recipients) {
    const token = intakeTokenFromAddress(recipient, domain);
    if (token) return token;
  }
  return null;
}

/* --------------------------- the token's row --------------------------- */

type TokenDb = {
  company: {
    findUnique(args: {
      where: { id: string };
      select: { intakeEmailToken: true };
    }): Promise<{ intakeEmailToken: string | null } | null>;
    updateMany(args: {
      where: { id: string; intakeEmailToken: null };
      data: { intakeEmailToken: string };
    }): Promise<{ count: number }>;
  };
};

/**
 * This company's token, minted if it has none yet.
 *
 * The migration backfilled every company that existed; this covers the ones
 * created since. `updateMany` guarded on `intakeEmailToken: null` is the
 * race guard — two first opens of /intake both try, one write wins, both
 * read the winner back. Never OVERWRITES: regenerating a live token is the
 * owner's deliberate action (`regenerateIntakeEmailAddress`), not a side
 * effect of a page load.
 */
export async function ensureIntakeEmailToken(
  companyId: string,
  db: TokenDb = prisma as unknown as TokenDb,
): Promise<string> {
  const existing = await db.company.findUnique({
    where: { id: companyId },
    select: { intakeEmailToken: true },
  });
  if (existing?.intakeEmailToken) return existing.intakeEmailToken;

  await db.company.updateMany({
    where: { id: companyId, intakeEmailToken: null },
    data: { intakeEmailToken: newIntakeEmailToken() },
  });
  const written = await db.company.findUnique({
    where: { id: companyId },
    select: { intakeEmailToken: true },
  });
  if (!written?.intakeEmailToken) throw new Error("Could not issue an intake email token");
  return written.intakeEmailToken;
}

/* ------------------------------ the email ------------------------------ */

/** One attachment, as an adapter hands it over. `size` and `content` may
 * reach the provider's API and may throw; the processor treats a throw as
 * that one attachment refused, never the whole email. */
export type InboundAttachmentSource = {
  filename: string;
  contentType: string;
  /** A cid-referenced inline image — the sender's signature logo, not a
   * document. Skipped, because a tray that grows three logo rows per
   * forwarded email teaches people to stop reading the tray. */
  inline: boolean;
  /** Declared size in bytes where the provider states one, else null.
   * Checked BEFORE downloading so an oversized file costs metadata, not a
   * 25MB transfer; the actual bytes are re-checked after. */
  size(): Promise<number | null>;
  content(): Promise<Uint8Array>;
};

export type InboundEmail = {
  /** Provider's id for the received email — the replay guard. */
  messageId: string;
  from: string;
  subject: string;
  /** Envelope recipient(s) first, then To, then Cc. */
  recipients: string[];
  attachments: InboundAttachmentSource[];
};

/** More attachments than any real transmittal; fewer than a mail bomb. */
export const INTAKE_MAX_EMAIL_ATTACHMENTS = 30;

/** Total bytes one email may bring in, across its attachments. Four full
 * 25MB scans in one forward is a big day's paper; past it, the rest of the
 * email is refused and the log says so. */
export const INTAKE_MAX_EMAIL_TOTAL_BYTES = 100 * 1024 * 1024;

/** What a stored From/Subject may occupy. Display columns, so a truncation
 * loses nothing anyone routes on. */
const MAX_PROVENANCE_LENGTH = 300;

function provenance(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_PROVENANCE_LENGTH ? `${trimmed.slice(0, MAX_PROVENANCE_LENGTH - 1)}…` : trimmed;
}

export type InboundRefusal = { filename: string; reason: string };

export type InboundResult = {
  outcome: "recorded" | "no_company" | "already_recorded" | "nothing_usable";
  companyId: string | null;
  recorded: number;
  refused: InboundRefusal[];
};

type BlobPut = (
  pathname: string,
  bytes: Uint8Array,
  contentType: string,
) => Promise<{ url: string }>;

export type InboundProcessorDeps = {
  db?: typeof prisma;
  putBlob?: BlobPut;
};

async function defaultPutBlob(pathname: string, bytes: Uint8Array, contentType: string) {
  // Imported lazily so tests that inject a mock never load the SDK, and so
  // this module can be imported by pages without pulling the store client
  // into their graph.
  const { put } = await import("@vercel/blob");
  // Uint8Array -> a fresh ArrayBuffer-backed copy; `put` accepts a Buffer.
  const result = await put(pathname, Buffer.from(bytes), {
    access: "public",
    // The same store behaviour as every other upload in this app: the
    // random suffix is what makes the public URL unguessable.
    addRandomSuffix: true,
    contentType,
  });
  return { url: result.url };
}

/**
 * One verified inbound email becomes zero or more tray rows.
 *
 * CALLED ONLY AFTER THE ADAPTER HAS VERIFIED THE WEBHOOK SIGNATURE. This
 * function resolves the company from the recipient token and NOTHING else —
 * no id in the payload body is ever consulted, which is what makes a
 * cross-company write impossible: an attacker who controls every byte of
 * the email still lands in the company whose token they sent to, which is
 * the one company that token-holder may fill anyway.
 *
 * AN UNKNOWN TOKEN IS A SILENT DROP. The caller answers 200 either way, in
 * identical shape — this route must not be an oracle for which tokens
 * exist (the generic webhook route does the same for unknown accounts).
 *
 * NEVER SILENTLY HALF-IMPORTS. Every attachment is either recorded or in
 * `refused` with a reason, and the caller logs the refusals where the
 * operator reads (the server log — the same place the generic webhook
 * route sends what it cannot attribute). A transient failure on one
 * attachment refuses that attachment, not the email.
 */
export async function processInboundEmail(
  email: InboundEmail,
  domain: string,
  deps: InboundProcessorDeps = {},
): Promise<InboundResult> {
  const db = deps.db ?? prisma;
  const putBlob = deps.putBlob ?? defaultPutBlob;

  const token = intakeTokenFromRecipients(email.recipients, domain);
  const company = token
    ? await db.company.findUnique({ where: { intakeEmailToken: token }, select: { id: true } })
    : null;
  if (!company) {
    return { outcome: "no_company", companyId: null, recorded: 0, refused: [] };
  }
  const companyId = company.id;

  // The replay guard. A webhook redelivered with a valid signature — or an
  // email sent to two of this install's addresses in one send, which the
  // provider fans out as one message id per recipient — writes nothing the
  // second time for the same company.
  const already = await db.documentIntake.findFirst({
    where: { companyId, emailMessageId: email.messageId },
    select: { id: true },
  });
  if (already) {
    return { outcome: "already_recorded", companyId, recorded: 0, refused: [] };
  }

  const emailFrom = provenance(email.from);
  const emailSubject = provenance(email.subject);

  const refused: InboundRefusal[] = [];
  let recorded = 0;
  let totalBytes = 0;

  // The jobs list is only needed when a filename carries a hint, and only
  // once per email.
  let jobsPromise: Promise<{ id: string; name: string }[]> | null = null;
  const jobsFor = () =>
    (jobsPromise ??= db.job.findMany({ where: { companyId }, select: { id: true, name: true } }));

  for (const [index, attachment] of email.attachments.entries()) {
    const fileName = displayFileName(attachment.filename || "document");

    if (attachment.inline) {
      // Not a refusal worth alarming anyone over — an embedded signature
      // logo is doing exactly what it should by not becoming a row.
      continue;
    }
    if (index >= INTAKE_MAX_EMAIL_ATTACHMENTS) {
      refused.push({ filename: fileName, reason: `Past the ${INTAKE_MAX_EMAIL_ATTACHMENTS}-attachment cap for one email` });
      continue;
    }
    if (!isAllowedIntakeType(attachment.contentType)) {
      refused.push({ filename: fileName, reason: `Type ${attachment.contentType || "(none)"} is not one intake accepts` });
      continue;
    }

    try {
      const declared = await attachment.size();
      if (declared !== null && declared > INTAKE_MAX_FILE_BYTES) {
        refused.push({ filename: fileName, reason: `${declared} bytes is over the per-file cap` });
        continue;
      }

      const bytes = await attachment.content();
      if (bytes.length === 0) {
        refused.push({ filename: fileName, reason: "Empty file" });
        continue;
      }
      // Re-checked on the actual bytes: the declared size is the provider's
      // claim, and the cap is only a cap if it binds on what arrived.
      if (bytes.length > INTAKE_MAX_FILE_BYTES) {
        refused.push({ filename: fileName, reason: `${bytes.length} bytes is over the per-file cap` });
        continue;
      }
      if (totalBytes + bytes.length > INTAKE_MAX_EMAIL_TOTAL_BYTES) {
        refused.push({ filename: fileName, reason: "Past the per-email total size cap" });
        continue;
      }
      totalBytes += bytes.length;

      // The SAME path a drag-and-drop lands in, which is the security
      // boundary: everything downstream (filing, viewing) already proves a
      // URL sits under `document-intake/<companyId>/` before trusting it.
      const pathname = intakeUploadPathname(companyId, fileName);
      if (!pathname) {
        refused.push({ filename: fileName, reason: "Could not build a storage path" });
        continue;
      }
      const blob = await putBlob(pathname, bytes, attachment.contentType);

      // The classifier reads the person's own filename, exactly as the
      // drag-and-drop path does. No text preview: extracting text from an
      // arbitrary emailed file is parser attack surface a webhook has no
      // business opening. A weaker guess lands as a lower-confidence row a
      // person reads anyway.
      let proposal;
      try {
        proposal = classifyDocument({
          filename: fileName,
          mimeType: attachment.contentType,
          sizeBytes: bytes.length,
          textPreview: null,
        });
      } catch (err) {
        console.error("[intake-inbound] classifier threw", err);
        proposal = {
          kind: "UNKNOWN" as const,
          confidence: "LOW" as const,
          reason: "Nothing could be read from this file, so it is waiting for you.",
          jobHint: null,
          revisionHint: null,
        };
      }

      const proposedKind = isIntakeKind(proposal.kind) ? proposal.kind : "UNKNOWN";
      const proposedConfidence =
        proposal.confidence === "HIGH" || proposal.confidence === "MEDIUM" ? proposal.confidence : "LOW";
      const jobId = proposal.jobHint ? (soleJobForHint(await jobsFor(), proposal.jobHint)?.id ?? null) : null;

      await db.documentIntake.create({
        data: {
          companyId,
          jobId,
          blobUrl: blob.url,
          fileName,
          contentType: attachment.contentType,
          byteSize: bytes.length,
          proposedKind,
          proposedConfidence,
          proposedReason: proposal.reason,
          revisionHint: proposal.revisionHint ?? null,
          jobHint: proposal.jobHint ?? null,
          // No person uploaded this; the email provenance is the byline.
          uploadedByUserId: null,
          emailFrom,
          emailSubject,
          emailMessageId: email.messageId,
        },
      });
      recorded += 1;
    } catch (err) {
      console.error(`[intake-inbound] attachment "${fileName}" failed`, err);
      refused.push({ filename: fileName, reason: "Could not be fetched or stored" });
    }
  }

  return {
    outcome: recorded > 0 ? "recorded" : "nothing_usable",
    companyId,
    recorded,
    refused,
  };
}

import { NextResponse } from "next/server";
import { verifyResendSignature } from "@/lib/resend-webhook";
import {
  intakeInboundDomain,
  processInboundEmail,
  type InboundAttachmentSource,
  type InboundProcessorDeps,
} from "@/lib/intake/inbound";

/**
 * The Resend adapter for forward-an-email intake.
 *
 * Resend receives mail for the MX'd subdomain and delivers an
 * `email.received` webhook — verified 2026-09-19 against
 * resend.com/docs/dashboard/receiving/*: the webhook carries the envelope
 * (`from`, `to`, `cc`, `received_for`, `subject`, `email_id`) and
 * ATTACHMENT METADATA ONLY (`id`, `filename`, `content_type`,
 * `content_disposition`, `content_id`). The bytes come from a second,
 * authenticated call: `GET /emails/receiving/{email_id}/attachments/{id}`
 * with the ordinary `RESEND_API_KEY`, which answers `{ download_url, size,
 * … }`, the URL valid for one hour — this handler uses it immediately.
 *
 * That metadata-only shape is a security property this route leans on: the
 * webhook body stays small (so the body cap is real), and the bytes are
 * fetched FROM Resend's API with OUR key rather than trusted from whoever
 * posted to the route.
 *
 * ORDER, following the DocuSign Connect receiver — every step refuses
 * before the next is reached:
 *
 *   1. No RESEND_INBOUND_WEBHOOK_SECRET on this install -> 503. A receiver
 *      that cannot verify must not process.
 *   2. Missing svix headers, stale timestamp, or a bad signature -> 401,
 *      nothing parsed. (The svix scheme is the same one the outbound
 *      delivery webhook verifies — one shared implementation,
 *      lib/resend-webhook.ts.)
 *   3. Body over the cap -> 413. Metadata for 30 attachments is a few KB;
 *      the cap bounds what an unauthenticated caller can make this read.
 *   4. Not an `email.received` event -> 200 "Ignored". A misrouted event
 *      type is not an error the provider can retry into being one.
 *   5. Verified email -> processInboundEmail, which resolves the company
 *      from the recipient token and NOTHING else. Unknown token and
 *      recorded email answer BYTE-IDENTICAL 200s — this route is not an
 *      oracle for which addresses exist.
 *
 * Always 200 once verified: a non-2xx makes Resend retry, and a retry
 * cannot fix an unknown token — while a retry of a partially-failed email
 * is handled by the emailMessageId replay guard, so re-answering 200 with
 * refusals logged is safe either way.
 */

/** Metadata for the max attachment count is ~10KB; this leaves room for
 * long subject lines and headers without letting an anonymous caller feed
 * the parser megabytes. */
export const RESEND_INBOUND_MAX_BODY_BYTES = 256 * 1024;

/** Same replay window as the outbound delivery webhook. */
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

type ResendInboundAttachment = {
  id?: unknown;
  filename?: unknown;
  content_type?: unknown;
  content_disposition?: unknown;
  content_id?: unknown;
};

type ResendInboundBody = {
  type?: unknown;
  data?: {
    email_id?: unknown;
    from?: unknown;
    to?: unknown;
    cc?: unknown;
    received_for?: unknown;
    subject?: unknown;
    attachments?: unknown;
  };
};

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

type AttachmentMeta = { downloadUrl: string; size: number | null };

export type ResendInboundDeps = InboundProcessorDeps & {
  /** GET /emails/receiving/{emailId}/attachments/{attachmentId} — returns
   * the presigned download URL and declared size, or null on a non-2xx. */
  fetchAttachmentMeta?: (emailId: string, attachmentId: string) => Promise<AttachmentMeta | null>;
  /** Fetch the presigned URL's bytes. */
  downloadAttachment?: (url: string) => Promise<Uint8Array | null>;
  env?: NodeJS.ProcessEnv;
};

async function defaultFetchAttachmentMeta(emailId: string, attachmentId: string): Promise<AttachmentMeta | null> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[intake-inbound] RESEND_API_KEY is not set; cannot fetch attachment content.");
    return null;
  }
  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) {
    console.error(`[intake-inbound] attachment meta fetch answered ${response.status}`);
    return null;
  }
  const body = (await response.json()) as { download_url?: unknown; size?: unknown };
  if (typeof body.download_url !== "string" || !body.download_url) return null;
  return {
    downloadUrl: body.download_url,
    size: typeof body.size === "number" && Number.isFinite(body.size) ? body.size : null,
  };
}

async function defaultDownloadAttachment(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`[intake-inbound] attachment download answered ${response.status}`);
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The one body every verified request gets, whatever happened — see the
 * oracle note in the header. */
function accepted(): Response {
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function handleResendInbound(request: Request, deps: ResendInboundDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;

  const secret = env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn("[intake-inbound] refused: RESEND_INBOUND_WEBHOOK_SECRET is not set on this install.");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Unsigned" }, { status: 401 });
  }

  // Raw body read once — the signature is over the exact bytes sent.
  const raw = await request.text();
  if (raw.length > RESEND_INBOUND_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // Reject anything outside the replay window so a captured request can't
  // be replayed indefinitely.
  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds) || Math.abs(Date.now() / 1000 - sentAtSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return NextResponse.json({ error: "Stale or invalid timestamp" }, { status: 401 });
  }

  if (!verifyResendSignature(secret, id, timestamp, raw, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let body: ResendInboundBody;
  try {
    body = JSON.parse(raw) as ResendInboundBody;
  } catch {
    // Signed by our provider but unparseable: a retry re-sends the same
    // bytes, so a 4xx only earns the retry schedule.
    return NextResponse.json({ error: "Ignored" }, { status: 200 });
  }

  if (body.type !== "email.received") {
    return NextResponse.json({ error: "Ignored" }, { status: 200 });
  }

  const emailId = typeof body.data?.email_id === "string" ? body.data.email_id : null;
  if (!emailId) {
    return NextResponse.json({ error: "Ignored" }, { status: 200 });
  }

  const domain = intakeInboundDomain(env);
  if (!domain) {
    // The webhook is configured but the address domain is not — a
    // misconfiguration the operator fixes in env, which a Resend retry
    // cannot. Logged where the operator reads, answered 200.
    console.error("[intake-inbound] INTAKE_INBOUND_DOMAIN is not set; a verified inbound email was dropped.");
    return accepted();
  }

  const fetchMeta = deps.fetchAttachmentMeta ?? defaultFetchAttachmentMeta;
  const download = deps.downloadAttachment ?? defaultDownloadAttachment;

  const rawAttachments = Array.isArray(body.data?.attachments) ? (body.data.attachments as ResendInboundAttachment[]) : [];
  const attachments: InboundAttachmentSource[] = rawAttachments
    .filter((entry): entry is ResendInboundAttachment => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const attachmentId = typeof entry.id === "string" ? entry.id : null;
      // Fetched at most once per attachment, shared by size() and content().
      let metaPromise: Promise<AttachmentMeta | null> | null = null;
      const meta = () => (metaPromise ??= attachmentId ? fetchMeta(emailId, attachmentId) : Promise.resolve(null));
      return {
        filename: typeof entry.filename === "string" ? entry.filename : "document",
        contentType: typeof entry.content_type === "string" ? entry.content_type : "",
        inline: entry.content_disposition === "inline" && typeof entry.content_id === "string" && entry.content_id !== "",
        size: async () => (await meta())?.size ?? null,
        content: async () => {
          const resolved = await meta();
          if (!resolved) throw new Error("No attachment metadata");
          const bytes = await download(resolved.downloadUrl);
          if (!bytes) throw new Error("Attachment download failed");
          return bytes;
        },
      };
    });

  const result = await processInboundEmail(
    {
      messageId: emailId,
      from: typeof body.data?.from === "string" ? body.data.from : "",
      subject: typeof body.data?.subject === "string" ? body.data.subject : "",
      // Envelope first: a forward's To line is the forwarder's view; the
      // envelope (`received_for`) is where the mail actually went.
      recipients: [...strings(body.data?.received_for), ...strings(body.data?.to), ...strings(body.data?.cc)],
      attachments,
    },
    domain,
    deps,
  );

  // The operator-visible record of anything that did not become a row —
  // the server log, the same place the generic webhook route reports what
  // it cannot attribute. Nothing here is silent, and nothing here changes
  // the response: an anonymous observer sees one shape.
  if (result.outcome === "no_company") {
    console.warn(`[intake-inbound] email ${emailId}: recipient matched no intake address; dropped.`);
  } else if (result.outcome === "already_recorded") {
    console.warn(`[intake-inbound] email ${emailId}: already recorded; replay dropped.`);
  } else if (result.recorded === 0) {
    console.error(
      `[intake-inbound] email ${emailId}: nothing usable for company ${result.companyId}. Refused: ${
        result.refused.map((entry) => `${entry.filename} (${entry.reason})`).join("; ") || "no attachments"
      }`,
    );
  } else if (result.refused.length > 0) {
    console.error(
      `[intake-inbound] email ${emailId}: recorded ${result.recorded} for company ${result.companyId}, refused ${
        result.refused.length
      }: ${result.refused.map((entry) => `${entry.filename} (${entry.reason})`).join("; ")}`,
    );
  }

  return accepted();
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { deleteDocument } from "@/lib/blob";
import { extractSpecSection, SPEC_SECTION_PROMPT_VERSION } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { claimSpecPages, markSpecFailure } from "@/lib/ask/specSpend";
import {
  documentDisplayFileName,
  documentUrlProblem,
  isAllowedDocumentType,
  uploadMaxBytesFor,
  type DocumentUploadContentType,
} from "@/lib/document-uploads";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "@/lib/actions/shared";

/**
 * Reading a spec section for what it demands that costs money.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NOTHING HERE WRITES A FIELD ANY OTHER MODULE READS.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Not a `BidRequirement` row, which `lib/bid-responsiveness.ts` reads to decide
 * whether a bid is reported non-responsive — and whose `required` column
 * defaults to true, so a model-invented one would default to condemning the bid.
 * Not `affectsPricedScope`. Not the bid's due date. A reading is a list of what
 * a document demands; every assertion about the bid stays the estimator's.
 *
 * `bid-specs.prisma` carries the long form, and `addendumRead.ts` is the
 * template this copies rather than re-argues.
 *
 * ── THE ORDER IS NOT STYLISTIC ──
 *
 * Session, capability, ownership proved FROM THE SESSION rather than from the
 * argument, URL validated, gate, claim the read, bytes, claim the pages, model,
 * mark-on-failure. `quoteRead.ts` says why the URL is checked before a byte is
 * fetched: read the other way round, this is a server-side request to an
 * address a caller chose.
 *
 * And the GATE COMES BEFORE THE LEDGER. A company that has switched spec
 * reading off must not have pages claimed against its allowance on the way to
 * being told no — `titleBlock.ts`'s rule, and the reason the refusal costs
 * nothing: reading a spec section by hand is what an estimator does today and
 * still can.
 *
 * ── THE DOUBLE-READ GUARD IS A CLAIM, NOT A TIME WINDOW, AND THAT IS
 *    DELIBERATE ──
 *
 * `addendumRead.ts` guards a double-click with a 30-second window over its own
 * readings — `createdAt >= now - 30s` — and `FEATURE-AUDIT.md` carries **#563
 * open against exactly that**: "the save looks like it failed and a retry
 * duplicates it". The race is plain once named. The first read's row is not
 * committed when the second read's check runs, so the window sees nothing and
 * both calls reach the model and bill.
 *
 * So this claims instead. `BidSpecSection.readInFlightAt` is taken with an
 * `updateMany` on `readInFlightAt: null`, which is atomic in Postgres: two
 * racing reads produce one winner and one zero-count update, and `count === 0`
 * IS the refusal with no window between checking and claiming. It is the shape
 * `PlanIngestTask` already proves, and `allowance.ts` uses for money.
 *
 * WITH AN EXPIRY, because a claim with none converts a recoverable failure into
 * a permanently stuck section — CLAUDE.md names that as worse than not being
 * recoverable at all, since a stuck job looks like a slow one. The claim is also
 * released in a `finally`, so the lease is the backstop rather than the
 * mechanism.
 */

/** How long a claimed read is held before another may take it. */
const SPEC_READ_LEASE_MS = 120_000;

const NOT_YOURS =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * Log that a section is in this bid's spec book.
 *
 * NOT AN AI ACTION, and it works with the switch off: the whole point of
 * `BidSpecSection.fileUrl` being nullable is that recording "09 21 16 is in this
 * book" is useful before anybody has the PDF and whether or not a model ever
 * reads it. `saveBidAddendum` is the shape.
 */
export async function saveBidSpecSection(
  bidInvitationId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS);
  const { company } = context;

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId: company.id },
    select: { id: true },
  });
  if (!bid) return actionFail("That bid is no longer on your list.");

  const sectionNumber = String(formData.get("sectionNumber") ?? "").trim();
  if (!sectionNumber) {
    return actionFail("Give the section a number as the spec prints it — “09 21 16”.");
  }
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.bidSpecSection.create({
    data: {
      bidInvitationId: bid.id,
      sectionNumber,
      title: title || null,
      notes: notes || null,
    },
  });

  revalidatePath("/bids");
  return actionOk;
}

/**
 * Remove a section from the bid.
 *
 * DELETES THE FILE TOO, for #559's reason: a blob is `access: "public"`, so an
 * unreferenced one stays readable forever by anyone who ever held the URL and
 * nothing will ever collect it. The READINGS go with it by cascade, which is
 * correct rather than regrettable — a reading is a record of what a model said
 * about a document, and with the section gone there is nothing for it to be
 * about.
 */
export async function deleteBidSpecSection(bidSpecSectionId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS);
  const { company } = context;

  const section = await prisma.bidSpecSection.findFirst({
    where: { id: bidSpecSectionId, bidInvitation: { companyId: company.id } },
    select: { id: true, fileUrl: true },
  });
  if (!section) return actionFail("That spec section is no longer on this bid.");

  // The FILE first, then the row. The other order strands the blob whenever the
  // delete succeeds and the store call fails — and `deleteDocument` swallows its
  // own failures by design, so this cannot turn a successful removal into an
  // error for the person.
  if (section.fileUrl) await deleteDocument(section.fileUrl);
  await prisma.bidSpecSection.delete({ where: { id: section.id } });

  revalidatePath("/bids");
  return actionOk;
}

/**
 * Attach the PDF to a spec section, separately from reading it.
 *
 * TWO ACTIONS AND NOT ONE, for `attachAddendumDocument`'s reason: having the
 * file on record and spending money on a model are different decisions, and a
 * person who uploads the wrong section should be able to fix it without paying
 * to have the wrong one read first.
 */
export async function attachSpecSectionDocument(
  bidSpecSectionId: string,
  fileUrl: string,
  fileNameRaw: string,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS);
  const { company } = context;

  const existing = await prisma.bidSpecSection.findFirst({
    // The id in the argument is a claim; this join is the check.
    where: { id: bidSpecSectionId, bidInvitation: { companyId: company.id } },
    select: { id: true, fileUrl: true },
  });
  if (!existing) return actionFail("That spec section is no longer on this bid.");

  const problem = documentUrlProblem(fileUrl, "bid-spec-section", company.id, process.env);
  if (problem) return actionFail(problem);

  // THE FILE THIS ONE REPLACES, for #559's reason: a blob is `access: "public"`,
  // so an unreferenced one stays readable forever by anyone who ever held the
  // URL and nothing will ever collect it. Attaching the right section after the
  // wrong one is an ordinary thing to do and should not leave two.
  //
  // Guarded on INEQUALITY, because re-attaching the SAME url — a double submit,
  // or the same file picked again — must not delete the file the row now points
  // at. That would leave a row whose document 404s, which is worse than a
  // stranded blob: the reading's evidence would be gone with nothing saying so.
  if (existing.fileUrl && existing.fileUrl !== fileUrl) await deleteDocument(existing.fileUrl);

  await prisma.bidSpecSection.update({
    where: { id: existing.id },
    data: { fileUrl, fileName: documentDisplayFileName(fileNameRaw) },
  });

  revalidatePath("/bids");
  return actionOk;
}

export type SpecReadResult = {
  findingCount: number;
  /** What the page charge was, in words — `pageChargeNote`'s sentence. */
  note: string;
  pagesLeft: number;
};

/**
 * Read one spec section.
 *
 * Returns a SUMMARY rather than the findings: the page re-renders from the
 * database after `revalidatePath`, and handing the findings back too would give
 * the screen two sources for the same list.
 */
export async function readSpecSection(
  bidSpecSectionId: string,
): Promise<ActionResultWith<SpecReadResult>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail(NOT_YOURS) as ActionResultWith<SpecReadResult>;
  }
  const { company, ...user } = context;

  const section = await prisma.bidSpecSection.findFirst({
    where: { id: bidSpecSectionId, bidInvitation: { companyId: company.id } },
    select: { id: true, bidInvitationId: true, fileUrl: true, fileName: true, sectionNumber: true },
  });
  if (!section) {
    return actionFail("That spec section is no longer on this bid.") as ActionResultWith<SpecReadResult>;
  }
  if (!section.fileUrl) {
    return actionFail(
      "There's no document on that section yet. Attach the PDF first.",
    ) as ActionResultWith<SpecReadResult>;
  }

  const problem = documentUrlProblem(section.fileUrl, "bid-spec-section", company.id, process.env);
  if (problem) return actionFail(problem) as ActionResultWith<SpecReadResult>;

  // THE SWITCH, before the bytes are fetched back out of the store let alone
  // sent anywhere.
  const gate = await aiGate(company.id, "SPEC_READ");
  if (!gate.ok) {
    return actionFail(`${gate.error} You can still read the section yourself.`) as ActionResultWith<SpecReadResult>;
  }

  // THE READ CLAIM — see the header. Atomic, so a double-submit loses rather
  // than bills. The lease is what stops a crashed read holding the section.
  const leaseCutoff = new Date(Date.now() - SPEC_READ_LEASE_MS);
  const claimed = await prisma.bidSpecSection.updateMany({
    where: {
      id: section.id,
      OR: [{ readInFlightAt: null }, { readInFlightAt: { lt: leaseCutoff } }],
    },
    data: { readInFlightAt: new Date() },
  });
  if (claimed.count === 0) {
    return actionFail(
      "That section is being read right now. Give it a moment — the findings will appear below.",
    ) as ActionResultWith<SpecReadResult>;
  }

  try {
    const read = await readStoredSpecSection(section.fileUrl);
    if (!read.ok) return actionFail(read.error) as ActionResultWith<SpecReadResult>;

    // Counted from the BYTES and claimed BEFORE the call. A refused claim is the
    // hard stop: nothing is charged and the model is never reached.
    const spend = await claimSpecPages(
      company.id,
      gate.settings.specPagesPerMonth,
      read.mediaType,
      read.buffer,
    );
    if (!spend.ok) return actionFail(spend.error) as ActionResultWith<SpecReadResult>;

    let extraction;
    try {
      extraction = await extractSpecSection({
        fileBase64: read.buffer.toString("base64"),
        mediaType: read.mediaType,
        fileName: section.fileName ?? `${section.sectionNumber}.pdf`,
        model: gate.model,
        onUsage: (usage) =>
          recordAskUsage({
            companyId: company.id,
            userId: user.id,
            model: gate.model,
            usage,
            // `proposal`, not `answered`: what this produces is a list a person
            // checks against their own number, and nothing is filed by the
            // machine. `titleBlock.ts` makes the same distinction for the same
            // reason — the row records a suggestion, not an answer given.
            outcome: "proposal",
            feature: "spec-read",
            promptVersion: SPEC_SECTION_PROMPT_VERSION,
          }),
      });
    } catch (err) {
      // MARKED, NOT RELEASED. A unit you can get back by making calls fail is
      // not a cap, and the provider bills a request that died halfway anyway.
      await markSpecFailure(spend.claim, spend.charge.pages);
      console.error("[spec-read] the model call failed after the pages were claimed", err);
      return actionFail(
        "That section couldn't be read. Its pages are recorded as a failed read on this month's allowance — " +
          "the account owner can see them on Settings → Assistant. Read the section yourself; nothing was saved.",
      ) as ActionResultWith<SpecReadResult>;
    }

    await prisma.bidSpecReading.create({
      data: {
        bidSpecSectionId: section.id,
        bidInvitationId: section.bidInvitationId,
        findings: extraction.findings,
        readingReason: extraction.readingReason,
        pagesCharged: spend.charge.pages,
        model: gate.model,
        promptVersion: SPEC_SECTION_PROMPT_VERSION,
        startedByUserId: user.id,
      },
    });

    revalidatePath("/bids");
    return {
      ok: true,
      value: { findingCount: extraction.findings.length, note: spend.note, pagesLeft: spend.pagesLeft },
    };
  } finally {
    // RELEASED ON EVERY PATH OUT, which is what makes the lease a backstop
    // rather than the mechanism — a refused claim, a failed fetch, a refused
    // allowance, a thrown model call and a success all land here. Swallowed,
    // because a section left claimed is recovered by the lease and turning a
    // successful read into an error over bookkeeping would be the worse trade.
    try {
      await prisma.bidSpecSection.updateMany({
        where: { id: section.id },
        data: { readInFlightAt: null },
      });
    } catch (err) {
      console.error("[spec-read] the in-flight claim could not be released; the lease will expire it", err);
    }
  }
}

async function readStoredSpecSection(
  fileUrl: string,
): Promise<{ ok: true; buffer: Buffer; mediaType: DocumentUploadContentType } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(fileUrl);
  } catch {
    return { ok: false, error: "That section couldn't be fetched from storage. Try again in a moment." };
  }
  if (!response.ok) {
    return { ok: false, error: "That section couldn't be fetched from storage. Try again in a moment." };
  }

  // THE MEDIA TYPE FROM THE STORE, never from anything a caller claimed.
  const served = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!isAllowedDocumentType(served)) {
    return { ok: false, error: "That file isn't a PDF or an image, so it can't be read." };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // The signed token already bound the transfer to this ceiling. This is the
  // second look, taken before the bytes are base64'd and sent on — and the
  // ceiling is the SPEC one, 50MB, not the 15MB default.
  if (buffer.byteLength === 0 || buffer.byteLength > uploadMaxBytesFor("bid-spec-section")) {
    return { ok: false, error: "That file is empty or too big to read." };
  }
  return { ok: true, buffer, mediaType: served as DocumentUploadContentType };
}

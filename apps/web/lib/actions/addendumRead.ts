"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { deleteDocument } from "@/lib/blob";
import { extractAddendum, ADDENDUM_PROMPT_VERSION } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { claimAddendumPages, markAddendumFailure } from "@/lib/ask/addendumSpend";
import { normaliseReference } from "@/lib/addenda-overlap";
import {
  documentDisplayFileName,
  documentUrlProblem,
  isAllowedDocumentType,
  uploadMaxBytesFor,
  type DocumentUploadContentType,
} from "@/lib/document-uploads";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "@/lib/actions/shared";

/**
 * Reading a bid addendum, and recording what an estimator decided about it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NOTHING HERE WRITES A FIELD ANY OTHER MODULE READS.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Not `BidAddendum.affectsPricedScope`, not `acknowledgedOn`, not `issuedOn`,
 * not `BidInvitation.dueDate`. `lib/ask/commands/estimating.ts` refused
 * `saveBidAddendum` to the assistant because "whether it changed work you
 * already priced is an estimator's judgement about drawings the assistant has
 * not seen", and reading the addendum does not give the model the drawings or
 * the estimate. So the judgement stays where it was and this only supplies
 * something to make it with.
 *
 * The consequence is worth stating plainly, because it is what makes this safe
 * to ship: no verdict on any bid or any job changes as a result of a read.
 * `bid-responsiveness.ts` and `takeoff-currency.ts` cannot tell that it happened.
 *
 * THE ORDER IN `readBidAddendumDocument` IS NOT STYLISTIC. Session, capability,
 * ownership proved from the session rather than the argument, URL validated,
 * gate, bytes, claim, model, mark-on-failure. `quoteRead.ts` says why the URL is
 * checked before a byte is fetched: read the other way round, this is a
 * server-side request to an address a caller chose.
 */

const NOT_YOURS =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * A second read within this window is treated as a double-click.
 *
 * `plan-ingest.prisma` put a unique index on its task rows because a
 * double-create "would spend twice", and the same hazard is here with no natural
 * key to constrain: readings are deliberately append-only, so nothing in the
 * schema stops two. A person genuinely re-reading after correcting something
 * waits longer than this; a double-submitted form does not.
 */
const DOUBLE_READ_WINDOW_MS = 30_000;

/**
 * Attach the addendum's own document to the row.
 *
 * SEPARATE FROM READING IT, deliberately. Having the PDF on file and spending
 * money on a model are different decisions, and keeping them apart means a
 * re-read needs no re-upload and an addendum can carry its document without
 * anybody ever reading it — which is the normal case for a letter somebody has
 * already read themselves.
 */
export async function attachAddendumDocument(
  bidAddendumId: string,
  fileUrl: string,
  fileNameRaw: string,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS);
  const { company } = context;

  const url = fileUrl.trim();
  if (!url) return actionFail("Choose a file first.");
  const problem = documentUrlProblem(url, "bid-addendum", company.id, process.env);
  if (problem) return actionFail(problem);

  // The id in the argument is a claim; this is the check. The existing file is
  // read in the same breath because REPLACING one strands it otherwise.
  const existing = await prisma.bidAddendum.findFirst({
    where: { id: bidAddendumId, companyId: company.id },
    select: { fileUrl: true },
  });
  if (!existing) return actionFail("That addendum is no longer on this bid. Reload the page.");

  const updated = await prisma.bidAddendum.updateMany({
    where: { id: bidAddendumId, companyId: company.id },
    data: { fileUrl: url, fileName: documentDisplayFileName(fileNameRaw) },
  });
  if (updated.count === 0) return actionFail("That addendum is no longer on this bid. Reload the page.");

  // THE FILE THIS ONE REPLACES, for the reason `deleteBidAddendum` deletes the
  // file it removes: a blob is `access: "public"`, so an unreferenced one stays
  // readable forever by anyone who ever had the URL and nothing will ever
  // collect it. Attaching the right PDF after attaching the wrong one is an
  // ordinary thing to do, and doing it twice should not leave two.
  //
  // Guarded on inequality because re-attaching the SAME url — a double-submit,
  // or the same file picked again — must not delete the file the row now points
  // at. That would leave a row whose document 404s, which is worse than a
  // stranded blob: the reading's evidence would be gone with nothing saying so.
  if (existing.fileUrl && existing.fileUrl !== url) await deleteDocument(existing.fileUrl);

  revalidatePath("/bids");
  return actionOk;
}

export type AddendumReadResult = {
  itemCount: number;
  /** What the pages cost, so the screen can say it rather than imply it. */
  note: string;
  pagesLeft: number;
};

/**
 * Read the attached addendum and record what it says it changed.
 *
 * Returns a summary rather than the items: the page re-renders from the database
 * after `revalidatePath`, and handing the items back too would give the screen
 * two sources for the same list.
 */
export async function readBidAddendumDocument(
  bidAddendumId: string,
): Promise<ActionResultWith<AddendumReadResult>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail(NOT_YOURS) as ActionResultWith<AddendumReadResult>;
  }
  const { company, ...user } = context;

  const addendum = await prisma.bidAddendum.findFirst({
    where: { id: bidAddendumId, companyId: company.id },
    select: { id: true, bidInvitationId: true, fileUrl: true, fileName: true },
  });
  if (!addendum) return { ok: false, error: "That addendum is no longer on this bid. Reload the page." };
  if (!addendum.fileUrl) {
    return { ok: false, error: "There's no document on this addendum yet. Attach the PDF first." };
  }

  const problem = documentUrlProblem(addendum.fileUrl, "bid-addendum", company.id, process.env);
  if (problem) return { ok: false, error: problem };

  // A double-submitted form must not buy two readings, because each one charges.
  const recent = await prisma.bidAddendumReading.findFirst({
    where: { bidAddendumId: addendum.id, createdAt: { gte: new Date(Date.now() - DOUBLE_READ_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) {
    return {
      ok: false,
      error: "This addendum was just read — the reading is below. Give it a moment before reading it again.",
    };
  }

  // THE SWITCH, before the bytes are fetched back out of the store let alone
  // sent anywhere. A company that has turned this off has said a GC's bid
  // documents must not reach a model. The refusal costs nothing: logging an
  // addendum and noting what it changed has always worked by hand and still does.
  const gate = await aiGate(company.id, "ADDENDUM_READ");
  if (!gate.ok) {
    return { ok: false, error: `${gate.error} You can still note what it changed yourself.` };
  }

  const read = await readStoredAddendum(addendum.fileUrl);
  if (!read.ok) return { ok: false, error: read.error };

  // Counted from the BYTES and claimed BEFORE the call. A refused claim is the
  // hard stop: nothing is charged and the model is never reached.
  const spend = await claimAddendumPages(
    company.id,
    gate.settings.addendumPagesPerMonth,
    read.mediaType,
    read.buffer,
  );
  if (!spend.ok) return { ok: false, error: spend.error };

  let extraction: Awaited<ReturnType<typeof extractAddendum>>;
  try {
    extraction = await extractAddendum({
      fileBase64: read.buffer.toString("base64"),
      mediaType: read.mediaType,
      fileName: addendum.fileName ?? "addendum",
      model: gate.model,
      onUsage: (usage) =>
        recordAskUsage({
          companyId: company.id,
          userId: user.id,
          model: gate.model,
          usage,
          outcome: "answered",
          feature: "addendum-read",
          promptVersion: ADDENDUM_PROMPT_VERSION,
        }),
    });
  } catch (err) {
    // MARKED, NOT RELEASED. A unit you can get back by making calls fail is not
    // a cap, and the provider bills a request that died halfway anyway.
    await markAddendumFailure(spend.claim, spend.charge.pages);
    console.error("[addendum-read] the extractor failed after its allowance was claimed", {
      companyId: company.id,
      bidAddendumId: addendum.id,
      err,
    });
    return {
      ok: false,
      error:
        "That addendum couldn't be read. Its pages are recorded as a failed read on this month's allowance — " +
        "the account owner can see them on Settings → Assistant. Note what it changed yourself; nothing was saved.",
    };
  }

  await prisma.bidAddendumReading.create({
    data: {
      bidAddendumId: addendum.id,
      bidInvitationId: addendum.bidInvitationId,
      // Stored exactly as the model returned it and never updated after insert —
      // the reason an estimator was given has to be the reason they were given.
      items: extraction.items,
      readingReason: extraction.readingReason,
      proposedIssueDateText: extraction.issueDateText,
      proposedBidDateText: extraction.bidDateText,
      pagesCharged: spend.charge.pages,
      model: gate.model,
      promptVersion: ADDENDUM_PROMPT_VERSION,
      startedByUserId: user.id,
    },
  });

  revalidatePath("/bids");
  return {
    ok: true,
    value: { itemCount: extraction.items.length, note: spend.note, pagesLeft: spend.pagesLeft },
  };
}

/**
 * Record that a scope an addendum names is, or is not, this trade's problem.
 *
 * KEYED ON THE ADDENDUM AND THE NORMALISED SCOPE, never on a reading — see
 * `bid-addenda.prisma`. An addendum's items have no stable identity across runs,
 * so a decision hung off a reading is lost the next time anybody reads the
 * document, which is the failure `plan-ingest` and `intake` both refuse.
 *
 * An upsert rather than an insert: unlike a reading, which records something
 * that happened, a decision is a current position and an estimator is entitled
 * to change their mind.
 */
export async function decideAddendumReference(
  bidAddendumId: string,
  displayReference: string,
  decision: "MINE" | "NOT_MINE",
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS);
  const { company, ...user } = context;

  const addendum = await prisma.bidAddendum.findFirst({
    where: { id: bidAddendumId, companyId: company.id },
    select: { id: true },
  });
  if (!addendum) return actionFail("That addendum is no longer on this bid. Reload the page.");

  const normalised = normaliseReference(displayReference);
  if (!normalised) return actionFail("That item doesn't name a scope, so there's nothing to decide about it.");

  await prisma.bidAddendumItemDecision.upsert({
    where: { bidAddendumId_normalisedReference: { bidAddendumId: addendum.id, normalisedReference: normalised } },
    create: {
      bidAddendumId: addendum.id,
      normalisedReference: normalised,
      displayReference,
      decision,
      decidedByUserId: user.id,
    },
    update: { decision, decidedByUserId: user.id, displayReference },
  });

  revalidatePath("/bids");
  return actionOk;
}

/**
 * Reads the file back out of the store so the model can be shown it.
 *
 * ONLY EVER CALLED WITH A URL `documentUrlProblem` HAS ALREADY ACCEPTED. The
 * media type is taken from the STORE's response rather than from anything a
 * caller claimed, and checked against the same allowlist the upload token was
 * minted from — `readStoredQuote`'s shape, and its reasons.
 */
async function readStoredAddendum(
  fileUrl: string,
): Promise<{ ok: true; buffer: Buffer; mediaType: DocumentUploadContentType } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(fileUrl);
  } catch {
    return { ok: false, error: "That addendum couldn't be fetched from storage. Try again in a moment." };
  }
  if (!response.ok) {
    return { ok: false, error: "That addendum couldn't be fetched from storage. Try again in a moment." };
  }

  const served = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!isAllowedDocumentType(served)) {
    return { ok: false, error: "That file isn't a PDF or an image, so it can't be read." };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // The signed token already bound the transfer to this ceiling. This is the
  // second look, taken before the bytes are base64'd and sent on.
  if (buffer.byteLength === 0 || buffer.byteLength > uploadMaxBytesFor("bid-addendum")) {
    return { ok: false, error: "That file is empty or too big to read." };
  }
  return { ok: true, buffer, mediaType: served as DocumentUploadContentType };
}

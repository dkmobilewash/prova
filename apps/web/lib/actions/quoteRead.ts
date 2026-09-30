"use server";

import { prisma } from "@prova/db";
import { extractBidQuote } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { claimDocumentPages } from "@/lib/ask/documentSpend";
import { markAskAllowanceFailure } from "@/lib/ask/allowance";
import {
  documentDisplayFileName,
  documentUrlProblem,
  isAllowedDocumentType,
  formatDocumentSize,
  uploadMaxBytesFor,
  type DocumentUploadContentType,
} from "@/lib/document-uploads";
import { actionFail, type ActionResultWith } from "./shared";

/**
 * Reading a sub's quote document into values a person then checks.
 *
 * ITS OWN FILE, NOT A FUNCTION IN `estimating.ts`, and the reason is what this
 * action is NOT allowed to do. Everything in `estimating.ts` writes; this writes
 * NOTHING about the quote. It returns a proposal, `saveBidQuote` stays exactly
 * as it was, and a person pressing save is the only thing that creates a
 * `BidQuote`. Keeping it out of the file full of writers is how that stays true
 * — a reader glancing at `estimating.ts` should not find a model call in it.
 *
 * WHY THERE IS NO NEW MODEL AT ALL. `BidQuote` already holds the normalised
 * inbound quote and `BidLevelling.tsx` already compares them; the step-1 plan's
 * `QuoteDocument`/`QuoteLine` would have been a second schema for one thing.
 * Because the proposal never lands in the database un-reviewed, there is also
 * nothing to record provenance ABOUT: the suggestion exists in a form, and what
 * gets stored is what a human submitted.
 *
 * THE SPEND IS THE EXISTING PAGE ALLOWANCE, deliberately. A quote PDF is the
 * same cost shape as a compliance document — a whole file base64'd into one
 * request — so it claims from `claimDocumentPages`, the SAME ledger the Ask box
 * and the compliance upload claim from. A second ledger for a second kind of
 * document is how a bill stops adding up, and #533's own notes say the one
 * thing a customer must be able to do is read one number and have it be the
 * bill.
 */

const NOT_YOURS =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/** What the form gets back. Every field is a SUGGESTION for a person to correct
 *  — named so at the type level, because a caller that forgets is a caller that
 *  saves a model's guess. */
export type QuoteSuggestion = {
  vendorName: string;
  packageLabel: string | null;
  /** A number ready for the amount box, or null when the document had no single
   *  total. Null is a real answer here and the levelling module already
   *  understands it — it is the state an unanswered request is in. */
  amount: number | null;
  quotedOn: string | null;
  exclusions: string | null;
  /** Why the reader should look twice, if it should. Rendered beside the form,
   *  never stored: it is about this reading, not about the quote. */
  readingNotes: string | null;
  /** What the allowance said after claiming, so the form can pass on the same
   *  sentence `/compliance` shows. */
  note: string;
  pagesLeft: number;
};

/**
 * Reads an uploaded quote and proposes its fields. WRITES NOTHING.
 *
 * The URL has already been checked by `documentUrlProblem` against our own
 * store and this company's own prefix before a byte is fetched — the same order
 * `uploadComplianceDocument` uses, and load-bearing rather than stylistic: read
 * the other way round, this would be a server-side request to an address a
 * caller chose.
 */
export async function readBidQuoteDocument(
  bidInvitationId: string,
  fileUrl: string,
  fileNameRaw: string,
): Promise<ActionResultWith<QuoteSuggestion>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS) as ActionResultWith<QuoteSuggestion>;
  const { company, ...user } = context;

  // The bid is the caller's own, proved from the SESSION's company rather than
  // from the argument. The id in the argument is a claim; this is the check.
  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId: company.id },
    select: { id: true },
  });
  if (!bid) return { ok: false, error: "That bid could not be found." };

  const url = fileUrl.trim();
  if (!url) return { ok: false, error: "Choose a file first." };
  const problem = documentUrlProblem(url, "bid-quote", company.id, process.env);
  if (problem) return { ok: false, error: problem };
  const fileName = documentDisplayFileName(fileNameRaw);

  // THE PER-COMPANY AI SWITCH, before the bytes are fetched back out of the
  // store, let alone sent anywhere. A company that has switched quote reading
  // off has said a competitor's pricing must not reach a model.
  //
  // UNLIKE THE COMPLIANCE UPLOAD, THIS REFUSAL COSTS NOTHING, and the difference
  // is worth stating: `uploadComplianceDocument` is the only path that files a
  // compliance document, so switching that off stops filing entirely. Logging a
  // quote by hand has always worked and still does — this only fills the form
  // in. So the sentence can be short, because nothing is lost.
  const gate = await aiGate(company.id, "QUOTE_EXTRACT");
  if (!gate.ok) return { ok: false, error: `${gate.error} You can still type the quote in yourself.` };

  const read = await readStoredQuote(url);
  if (!read.ok) return { ok: false, error: read.error };

  // Counted from the BYTES and claimed BEFORE the call, never from anything the
  // browser said. A refused claim is the hard stop: the sentence says what ran
  // out, nothing is charged, and the model is never reached.
  const spend = await claimDocumentPages(company.id, read.mediaType, read.buffer);
  if (!spend.ok) return { ok: false, error: spend.error };

  let extraction: Awaited<ReturnType<typeof extractBidQuote>>;
  try {
    extraction = await extractBidQuote({
      fileBase64: read.buffer.toString("base64"),
      mediaType: read.mediaType,
      fileName: fileName ?? "quote",
      model: gate.model,
      onUsage: (usage) =>
        recordAskUsage({
          companyId: company.id,
          userId: user.id,
          model: gate.model,
          usage,
          outcome: "answered",
          feature: "quote-extract",
        }),
    });
  } catch (err) {
    // MARKED, NOT RELEASED — the same rule the compliance upload and the Ask
    // box follow. A unit you can get back by making calls fail is not a cap,
    // and the provider bills a request that died halfway anyway. The mark is
    // what lets an owner see failed reads on /settings/assistant and ask for a
    // credit; nothing here adjusts an allowance by itself.
    await markAskAllowanceFailure(spend.claim);
    console.error("[quote-read] the extractor failed after its allowance was claimed", {
      companyId: company.id,
      bidInvitationId: bid.id,
      err,
    });
    return {
      ok: false,
      error:
        "That quote couldn't be read. Its pages are recorded as a failed read on this month's allowance — the " +
        "account owner can see them on Settings → Assistant. Type the quote in instead; nothing was saved.",
    };
  }

  // A DATE IS VALIDATED, NOT TRUSTED. The model is asked for `YYYY-MM-DD` and
  // mostly obliges; anything else becomes null rather than reaching a date input
  // as a string it will silently reject. A quote whose date could not be read is
  // a quote the person dates themselves, which is this app's rule for dates that
  // matter anyway.
  const quotedOn = isoDateOrNull(extraction.quotedOn);

  return {
    ok: true,
    value: {
      vendorName: extraction.vendorName.trim(),
      packageLabel: extraction.packageLabel?.trim() || null,
      // A NEGATIVE OR NON-FINITE AMOUNT IS DROPPED rather than shown. The model
      // is told never to invent one, and this is the second of the two checks:
      // a quote cannot be for less than nothing, and `NaN` in a money box is a
      // figure somebody might save.
      amount:
        typeof extraction.amount === "number" && Number.isFinite(extraction.amount) && extraction.amount >= 0
          ? extraction.amount
          : null,
      quotedOn,
      exclusions: extraction.exclusions?.trim() || null,
      readingNotes: extraction.readingNotes?.trim() || null,
      note: spend.note,
      pagesLeft: spend.pagesLeft,
    },
  };
}

/** `YYYY-MM-DD` or null. Rejects a real-looking string that is not a real day —
 *  `2026-02-30` parses in some readings and is not a date. */
function isoDateOrNull(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const round =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return round ? value : null;
}

/**
 * Reads the file back out of the blob store so the model can be shown it.
 *
 * ONLY EVER CALLED WITH A URL `documentUrlProblem` HAS ALREADY ACCEPTED — the
 * host is our own store and the path is under this company's own folder. The
 * media type is taken from the STORE's response rather than the caller's claim,
 * and compared against the same allowlist the upload token was minted from.
 */
async function readStoredQuote(
  fileUrl: string,
): Promise<{ ok: true; buffer: Buffer; mediaType: DocumentUploadContentType } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(fileUrl);
  } catch {
    return { ok: false, error: "That file could not be read back from storage — try again." };
  }
  if (!response.ok) return { ok: false, error: "That file could not be read back from storage — try again." };

  const served = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!isAllowedDocumentType(served)) {
    return { ok: false, error: "Upload a PDF, PNG, JPEG, or WEBP file." };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // The signed token already bound the transfer to this ceiling. This is the
  // second look, taken before the bytes are base64'd and sent on.
  const max = uploadMaxBytesFor("bid-quote");
  if (buffer.byteLength === 0 || buffer.byteLength > max) {
    return { ok: false, error: `That file is over the ${formatDocumentSize(max)} limit.` };
  }
  return { ok: true, buffer, mediaType: served };
}

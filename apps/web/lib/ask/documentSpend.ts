import {
  allowanceForCompany,
  claimAskAllowance,
  type AllowanceClaim,
  type MonthlyAllowance,
} from "./allowance";
import { attachmentPageCharge, pageChargeNote, type PageCharge } from "./pageCount";

/**
 * SPENDING THE MONTHLY ALLOWANCE ON A DOCUMENT THAT IS NOT AN ASK QUESTION.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AND WHAT IT DELIBERATELY DOES NOT CONTAIN.
 * ────────────────────────────────────────────────────────────────────────
 *
 * `uploadComplianceDocument` sends a whole document to the model — the most
 * expensive single call in this app, put at $2.25-$4.50 by this repo's own
 * audit — and until now it was neither page-counted nor bound by anything.
 * It sat entirely outside the allowance #465 shipped, which is the clearest
 * way there is to lose money on a customer paying a fixed $399 a month.
 *
 * There is NO second ledger here, NO second page counter and NO second cap.
 * Every number comes from the two modules beside this one:
 *
 *   - the pages from `attachmentPageCharge` (./pageCount), including the
 *     flat-10 rule for a PDF whose page tree cannot be read;
 *   - the ceiling, the claim, the stop sentence and the reset date from
 *     ./allowance, whose `AskAllowancePeriod` row is the SAME row the Ask
 *     box claims against. A document uploaded here reduces what the Ask box
 *     has left, and that is the point rather than a side effect: a customer
 *     buys one allowance, not one per surface.
 *
 * What this file adds is exactly one thing the Ask path does not need — a
 * ceiling on a SINGLE document — and the composition that puts the count,
 * the ceiling and the claim in the one order that cannot leak.
 *
 * ────────────────────────────────────────────────────────────────────────
 * IT FAILS CLOSED, LIKE THE CAP IT SPENDS AND UNLIKE THE COURTESY LIMITS.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Read ./allowance's header for the argument in full. In short:
 * `askAllowance` in ./usage is a courtesy limit and lets a question through
 * when it cannot read itself, because the worst case there is our own bill.
 * THIS spends a ceiling somebody has paid for, so when the accounting
 * cannot be done the upload is REFUSED and nothing is sent to the model.
 * The `catch` at the bottom of `claimDocumentPages` is that rule, and it is
 * the reason this function returns a result rather than throwing: a thrown
 * Server Action message is redacted to a digest in production, so a
 * customer hitting the stop would get a dead button instead of the sentence
 * telling them what happened.
 */

/**
 * A single document may use at most a THIRD of the monthly page allowance.
 *
 * 100 pages today, derived rather than typed, so a plan that changes
 * `allowanceForCompany` moves this with it instead of leaving a literal
 * behind to disagree.
 *
 * WHY A THIRD. The ceiling has to be above every document this product
 * actually receives and far below the month. The documents on this path are
 * lien waivers, certificates of insurance with their endorsements,
 * certified payroll runs and union fringe filings; the biggest of those is
 * tens of pages, so 100 refuses nothing real. And three absurd uploads
 * rather than one are needed to empty a month, which is the whole job of
 * this number: one wrong file — a scanned drawing set someone filed as a
 * COI — must not be able to spend a customer's entire month in one click.
 *
 * It is a CEILING, not a second cap: what is left in the month still
 * decides, and a 100-page document with 40 pages left is refused by the
 * ledger, not by this.
 */
export const SINGLE_DOCUMENT_ALLOWANCE_FRACTION = 3;

export function singleDocumentPageCeiling(allowance: MonthlyAllowance): number {
  return Math.max(1, Math.floor(allowance.pages / SINGLE_DOCUMENT_ALLOWANCE_FRACTION));
}

export type DocumentSpendResult =
  | {
      ok: true;
      /** What to mark if the model call then fails. Never released — see
       * ./allowance's header for why a releasable unit is not a cap. */
      claim: AllowanceClaim;
      charge: PageCharge;
      /** The clause the person is shown: what this document cost, and for
       * an unreadable PDF, why it cost that. */
      note: string;
      pagesLeft: number;
    }
  | { ok: false; error: string };

/** The sentence for the check itself failing. Deliberately the same shape
 * as ./allowance's — what happened, that nothing was charged, what to do —
 * worded for a document rather than for a question. */
const UNREADABLE =
  "We couldn't check your company's monthly AI allowance just now, so this document wasn't read. " +
  "Nothing has been charged. Try again in a few minutes — if it keeps happening, contact C Stream.";

/**
 * Count this document's pages and CLAIM them, before anything is sent to
 * the model.
 *
 * The order is the whole of it, and it is the order `streamAnswer` uses:
 * the bytes are already in hand (fetching our own blob spends no model
 * money), the pages come out of those bytes rather than out of anything a
 * browser claimed, the single-document ceiling is applied, and only then is
 * the unit claimed. A refusal at any of those three points has taken
 * NOTHING — no pages, no question — and the caller must not call the model.
 */
export async function claimDocumentPages(
  companyId: string,
  contentType: string,
  bytes: Buffer,
  now: Date = new Date(),
): Promise<DocumentSpendResult> {
  try {
    const charge = attachmentPageCharge(contentType, bytes);
    const allowance = await allowanceForCompany(companyId);
    const ceiling = singleDocumentPageCeiling(allowance);

    if (charge.pages > ceiling) {
      return {
        ok: false,
        error:
          `That wasn't read — this document is ${pageChargeNote(charge)} and one upload can use at most ` +
          `${ceiling} of your company's ${allowance.pages} document pages a month. Nothing has been charged. ` +
          `Split it into smaller files and upload the parts you need read.`,
      };
    }

    // One question and this document's pages, claimed in the same
    // conditional statement the Ask box uses. A document IS a question to
    // the model — one request, one answer — so it costs one of those too,
    // and the two surfaces stay comparable on /settings/assistant.
    const claimed = await claimAskAllowance(companyId, { questions: 1, pages: charge.pages }, now);
    if (!claimed.ok) return { ok: false, error: claimed.error };

    return {
      ok: true,
      claim: claimed.claim,
      charge,
      note: pageChargeNote(charge),
      pagesLeft: claimed.left.pages,
    };
  } catch (err) {
    // FAILS CLOSED. `claimAskAllowance` already answers a database failure
    // with a refusal of its own; this catches everything else on the way to
    // it — a plan lookup, a count that threw — and refuses too, because a
    // cap that spends when it cannot check itself is not a cap.
    console.error(
      "[ask] a document could not be counted or claimed against the monthly allowance, so it was " +
        "REFUSED rather than read unbounded — this cap fails closed, unlike the hourly and daily " +
        "limits in lib/ask/usage.ts.",
      err,
    );
    return { ok: false, error: UNREADABLE };
  }
}

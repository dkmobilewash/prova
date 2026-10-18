import { prisma } from "@prova/db";
import { attachmentPageCharge, pageChargeNote, type PageCharge } from "./pageCount";
import { periodStartFor } from "./allowance";

/**
 * WHAT READING ONE BID ADDENDUM COSTS, claimed before the model is called.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A FOURTH UNIT, AND IT IS THE THIRD UNIT'S ARGUMENT ARRIVING AGAIN.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The obvious design was `claimDocumentPages`, which every other whole-document
 * read uses, and `quoteRead.ts` gives the argument for it: "a second ledger for
 * a second kind of document is how a bill stops adding up." That is a good rule
 * and this is the case it does not cover.
 *
 * It checks the CEILING and never checks the MONTH. An addendum is eight pages
 * against a hundred-page single-document ceiling, so one fits with room to
 * spare — but an estimator bidding twenty jobs with three addenda each is about
 * 480 pages against a 300-page month, and that month is shared with the Ask box
 * and with the lien waivers and certificates the job they WIN will need. The
 * unit that funds compliance paperwork would have been spent on bids nobody won.
 *
 * `docs/ai/DECISIONS.md` made exactly this argument for plan sheets — "one
 * 300-sheet drawing set is 300 pages, which is the ENTIRE existing monthly page
 * allowance" — and the two cases differ only in how the volume arrives. A plan
 * set spends it in one click; addenda spend it eight pages at a time, on every
 * bid, whether or not anybody planned to.
 *
 * PAGES RATHER THAN DOCUMENTS, unlike plan sheets' one-per-sheet. A three-page
 * letter and a forty-page one are not the same call to make or the same cost to
 * serve, and `attachmentPageCharge` already counts pages out of bytes for every
 * other document path — so this reuses that rather than inventing a second
 * counter, which is the half of `quoteRead.ts`'s rule that DOES carry over.
 */

/** What to mark if the model call then fails. Never released — see `allowance.ts`. */
export type AddendumClaim = { companyId: string; periodStart: Date };

export type AddendumClaimResult =
  | { ok: true; claim: AddendumClaim; charge: PageCharge; note: string; pagesLeft: number }
  | { ok: false; error: string };

const UNREADABLE =
  "This month's addendum allowance couldn't be checked, so the addendum wasn't read. Nothing was charged. " +
  "Try again in a minute — and if it keeps happening, the account owner can see the month on " +
  "Settings → Assistant.";

function stopSentence(ceiling: number, used: number, wanted: number): string {
  const left = Math.max(0, ceiling - used);
  return (
    `Reading this addendum needs ${wanted} ${wanted === 1 ? "page" : "pages"} and there ${left === 1 ? "is" : "are"} ` +
    `${left} of ${ceiling} left this month. It hasn't been read and nothing was charged. The addendum is still on ` +
    `the bid and you can note what it changed yourself; the account owner can see the month on Settings → Assistant.`
  );
}

/**
 * Count this addendum's pages and CLAIM them, before anything reaches the model.
 *
 * THE CEILING IS PASSED IN RATHER THAN RE-READ, the shape `claimPlanSheet` uses:
 * `aiGate` has already returned this company's `AiSettings`, which carries
 * `addendumPagesPerMonth`, so re-reading it here would be a second query to
 * learn something the caller established a line earlier.
 *
 * THE CLAIM IS ONE CONDITIONAL STATEMENT. Under Postgres READ COMMITTED two
 * concurrent claims for the last pages cannot both match: the second blocks on
 * the first's row lock and re-evaluates its `WHERE` against the committed value.
 * So `count === 0` IS the refusal and there is no window between checking and
 * claiming. Nothing here reads the row first and decides in JavaScript.
 *
 * FAILS CLOSED. A cap that spends when it cannot check itself is not a cap.
 */
export async function claimAddendumPages(
  companyId: string,
  ceiling: number,
  contentType: string,
  bytes: Buffer,
  now: Date = new Date(),
): Promise<AddendumClaimResult> {
  // Out of the BYTES, never out of anything a browser claimed. A scan whose page
  // tree cannot be parsed is charged a flat figure by `attachmentPageCharge`
  // rather than guessed at, and `pageChargeNote` is what says so on screen.
  const charge = attachmentPageCharge(contentType, bytes);
  const periodStart = periodStartFor(now);

  try {
    try {
      await prisma.askAllowancePeriod.upsert({
        where: { companyId_periodStart: { companyId, periodStart } },
        create: { companyId, periodStart },
        update: {},
      });
    } catch (err) {
      // Two reads arriving together race here; the unique index decides, and
      // P2002 means the other one won — a success for us, because the row exists.
      const code = (err as { code?: unknown } | null)?.code;
      if (code !== "P2002") throw err;
    }

    const claimed = await prisma.askAllowancePeriod.updateMany({
      where: { companyId, periodStart, addendumPagesUsed: { lte: ceiling - charge.pages } },
      data: { addendumPagesUsed: { increment: charge.pages } },
    });

    const row = await prisma.askAllowancePeriod.findUnique({
      where: { companyId_periodStart: { companyId, periodStart } },
      select: { addendumPagesUsed: true },
    });
    if (!row) {
      console.error("[addendum-read] the allowance period row disappeared mid-claim, so the read was REFUSED");
      return { ok: false, error: UNREADABLE };
    }

    if (claimed.count === 0) {
      return { ok: false, error: stopSentence(ceiling, row.addendumPagesUsed, charge.pages) };
    }

    // After this claim — `row` is read back following the increment.
    const pagesLeft = Math.max(0, ceiling - row.addendumPagesUsed);

    return {
      ok: true,
      claim: { companyId, periodStart },
      charge,
      note: pageChargeNote(charge, { noun: "addendum pages", left: pagesLeft, ceiling }),
      pagesLeft,
    };
  } catch (err) {
    console.error(
      "[addendum-read] addendum pages could not be claimed against the monthly allowance, so the read was " +
        "REFUSED rather than run unbounded — this cap fails closed.",
      err,
    );
    return { ok: false, error: UNREADABLE };
  }
}

/**
 * The model call that followed a claim failed. MARK IT — never release it.
 *
 * `allowance.ts` argues this for its own units and it carries over whole:
 * releasing would let anyone defeat the cap by inducing failures, the provider
 * bills a call that produced nothing usable anyway, and this figure is what makes
 * a human credit possible — an owner sees on `/settings/assistant` that the month
 * included failures and can ask for them back. Nothing here adjusts an allowance
 * by itself and nothing bills for one.
 *
 * Bookkeeping after the fact, so a failure to write it is logged and swallowed:
 * the claim already stands, which is the conservative direction.
 */
export async function markAddendumFailure(claim: AddendumClaim, pages: number): Promise<void> {
  try {
    await prisma.askAllowancePeriod.updateMany({
      where: { companyId: claim.companyId, periodStart: claim.periodStart },
      data: { failedAddendumPages: { increment: pages } },
    });
  } catch (err) {
    console.error("[addendum-read] a failed addendum read could not be marked; the claim stands regardless", err);
  }
}

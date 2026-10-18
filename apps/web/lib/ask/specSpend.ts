import { prisma } from "@prova/db";
import { attachmentPageCharge, pageChargeNote, type PageCharge } from "./pageCount";
import { periodStartFor } from "./allowance";

/**
 * WHAT READING ONE SPEC SECTION COSTS, claimed before the model is called.
 *
 * ── A FIFTH UNIT, AND IT IS THE FOURTH UNIT'S ARGUMENT ARRIVING AGAIN ──
 *
 * The obvious design was `claimAddendumPages`: both are bid documents, both
 * arrive with the invitation, both are read per page, and the claim code is
 * line-for-line the same. Sharing it would have been one fewer column, one fewer
 * settings field and one fewer migration.
 *
 * It is the wrong call, for a reason `addendumSpend.ts`'s own argument does not
 * cover. That one is about a ceiling that never checks the month. This is about
 * two features spending ONE unit at wildly different rates: a spec section runs
 * thirty to sixty pages against an addendum's two to twenty, so three sections
 * on one bid is roughly a hundred pages, and twenty bids a month is **1,800
 * against an addendum allowance of 600**. Reading specs would consume the
 * allowance for reading addenda three times over, and nothing on screen could
 * tell a contractor which of the two had spent their month — they would simply
 * find that logging addenda had stopped working.
 *
 * ── 1,800 IS A FIGURE, NOT A MEASUREMENT, AND THE FIRST FIGURE WAS WRONG ──
 *
 * Worth recording because the error is instructive rather than embarrassing. It
 * was pitched as 600 — symmetric with addendum pages — on an estimate of "four
 * ten-page sections per bid". A spec section is not ten pages. At thirty pages
 * and three sections, 600 is three bids a month rather than fifteen, which would
 * have shipped a feature that stops working in the first week of use and read as
 * a bug rather than a cap.
 *
 * 1,800 is twenty bids at three thirty-page sections. Step 2's cost panel is
 * what turns it into a measurement, and `docs/ai/DECISIONS.md` records both
 * numbers so the next person can see which one evidence replaced.
 *
 * ── PAGES RATHER THAN SECTIONS ──
 *
 * Unlike plan sheets' one-per-sheet. A twelve-page section and a sixty-page one
 * are not the same call to make or the same cost to serve, and
 * `attachmentPageCharge` already counts pages out of bytes for every other
 * document path — so this reuses that rather than inventing a second counter,
 * which is the half of `quoteRead.ts`'s one-ledger rule that DOES carry over.
 */

/** What to mark if the model call then fails. Never released — see `allowance.ts`. */
export type SpecClaim = { companyId: string; periodStart: Date };

export type SpecClaimResult =
  | { ok: true; claim: SpecClaim; charge: PageCharge; note: string; pagesLeft: number }
  | { ok: false; error: string };

const UNREADABLE =
  "This month's spec allowance couldn't be checked, so the section wasn't read. Nothing was charged. " +
  "Try again in a minute — and if it keeps happening, the account owner can see the month on " +
  "Settings → Assistant.";

function stopSentence(ceiling: number, used: number, wanted: number): string {
  const left = Math.max(0, ceiling - used);
  return (
    `Reading this section needs ${wanted} ${wanted === 1 ? "page" : "pages"} and there ${left === 1 ? "is" : "are"} ` +
    `${left} of ${ceiling} left this month. It hasn't been read and nothing was charged. The section is still on ` +
    `the bid and you can read it yourself; the account owner can see the month on Settings → Assistant.`
  );
}

/**
 * Count this section's pages and CLAIM them, before anything reaches the model.
 *
 * THE CEILING IS PASSED IN RATHER THAN RE-READ, the shape `claimPlanSheet` and
 * `claimAddendumPages` both use: `aiGate` has already returned this company's
 * `AiSettings`, which carries `specPagesPerMonth`, so re-reading it here would
 * be a second query to learn something the caller established a line earlier.
 *
 * THE CLAIM IS ONE CONDITIONAL STATEMENT. Under Postgres READ COMMITTED two
 * concurrent claims for the last pages cannot both match: the second blocks on
 * the first's row lock and re-evaluates its `WHERE` against the committed value.
 * So `count === 0` IS the refusal and there is no window between checking and
 * claiming. Nothing here reads the row first and decides in JavaScript.
 *
 * FAILS CLOSED. A cap that spends when it cannot check itself is not a cap.
 */
export async function claimSpecPages(
  companyId: string,
  ceiling: number,
  contentType: string,
  bytes: Buffer,
  now: Date = new Date(),
): Promise<SpecClaimResult> {
  // Out of the BYTES, never out of anything a browser claimed. A scanned section
  // whose page tree cannot be parsed is charged a flat figure by
  // `attachmentPageCharge` rather than guessed at — and that matters more here
  // than for an addendum, because a scanned spec book is the common case and the
  // flat charge is what `pageChargeNote` says on screen before the press.
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
      where: { companyId, periodStart, specPagesUsed: { lte: ceiling - charge.pages } },
      data: { specPagesUsed: { increment: charge.pages } },
    });

    const row = await prisma.askAllowancePeriod.findUnique({
      where: { companyId_periodStart: { companyId, periodStart } },
      select: { specPagesUsed: true },
    });
    if (!row) {
      console.error("[spec-read] the allowance period row disappeared mid-claim, so the read was REFUSED");
      return { ok: false, error: UNREADABLE };
    }

    if (claimed.count === 0) {
      return { ok: false, error: stopSentence(ceiling, row.specPagesUsed, charge.pages) };
    }

    // AFTER this claim, not before: `row` is read back following the increment,
    // so this is what the sub has left once this read is paid for — which is
    // the only version of the number worth printing to them.
    const pagesLeft = Math.max(0, ceiling - row.specPagesUsed);

    return {
      ok: true,
      claim: { companyId, periodStart },
      charge,
      pagesLeft,
      note: pageChargeNote(charge, { noun: "spec pages", left: pagesLeft, ceiling }),
    };
  } catch (err) {
    console.error(
      "[spec-read] spec pages could not be claimed against the monthly allowance, so the read was REFUSED " +
        "rather than run unbounded — this cap fails closed.",
      err,
    );
    return { ok: false, error: UNREADABLE };
  }
}

/**
 * The model call that followed a claim failed. MARK IT — never release it.
 *
 * Releasing would let anyone defeat the cap by inducing failures, the provider
 * bills a call that produced nothing usable anyway, and this figure is what
 * makes a human credit possible — an owner sees on `/settings/assistant` that
 * the month included failures and can ask for them back. Nothing here adjusts an
 * allowance by itself and nothing bills for one.
 *
 * Bookkeeping after the fact, so a failure to write it is logged and swallowed:
 * the claim already stands, which is the conservative direction.
 */
export async function markSpecFailure(claim: SpecClaim, pages: number): Promise<void> {
  try {
    await prisma.askAllowancePeriod.updateMany({
      where: { companyId: claim.companyId, periodStart: claim.periodStart },
      data: { failedSpecPages: { increment: pages } },
    });
  } catch (err) {
    console.error("[spec-read] a failed spec read could not be marked; the claim stands regardless", err);
  }
}

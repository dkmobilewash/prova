import { prisma } from "@prova/db";
import { periodStartFor } from "./allowance";

/**
 * THE PLAN-SHEET METER — the third unit, and the one nothing was claiming.
 *
 * `AskAllowancePeriod.planSheetsUsed` and `failedPlanSheets` have been in the
 * schema since step 0, and `CompanyAiSettings.planSheetsPerMonth` has defaulted to
 * 1,500 for as long. Nothing ever incremented them. `ai-settings.prisma` said plan
 * sheets were "metered by `AskAllowancePeriod.planSheetsUsed`" and that
 * `allowanceForCompany` "reads it" — both aspirational: that function returns
 * `{questions, pages}` and ignores its `companyId` argument entirely. This file is
 * what makes those sentences true, and that comment is corrected in the same change.
 *
 * WHY A THIRD UNIT AND NOT MORE PAGES, quoting the schema rather than re-arguing
 * it: "Ingesting one 300-sheet plan set is 300 pages — the ENTIRE existing monthly
 * page allowance — so a contractor who uploaded a drawing set would have no
 * document allowance left for the compliance paperwork the same job needs… a page
 * is a document somebody hands the assistant, and a sheet is a unit of a bulk job
 * that runs unattended."
 *
 * WHY IT IS ITS OWN FILE rather than a third field on `MonthlyAllowance`: that
 * type, `AllowanceRequest`, `AllowanceClaim` and the stop sentence are all shaped
 * around two units that the Ask box and the compliance upload share. Widening them
 * would touch every existing caller to serve a unit none of them spends, and the
 * schema's whole argument is that these are not the same product. `documentSpend.ts`
 * is the precedent: the document-page POLICY lives beside the ledger rather than
 * inside it.
 *
 * ONE SHEET AT A TIME, claimed inside the per-page work, which is not an
 * optimisation to undo later. A 300-page run is 300 claims, and that is the point:
 * a run that stops halfway through the month's allowance has read half the set and
 * charged for half the set, with every finished page's proposal already on file. A
 * single up-front claim for the whole set would refuse a 300-sheet set outright the
 * moment 299 sheets were left, and would have to be released or reconciled if the
 * run stopped — and a releasable unit is not a cap.
 */

/** What one claimed sheet came to, for marking if the model call then fails. */
export type PlanSheetClaim = {
  companyId: string;
  periodStart: Date;
};

export type PlanSheetClaimResult =
  | { ok: true; claim: PlanSheetClaim; sheetsLeft: number }
  | { ok: false; error: string };

/**
 * The sentence for the accounting itself being unreadable. Same shape as
 * `allowance.ts`'s — what happened, that nothing was charged, what to do — worded
 * for a sheet rather than for a question, and it is a SENTENCE because a stage's
 * failure text is rendered on screen beside a Retry button.
 */
const UNREADABLE =
  "We couldn't check your company's monthly sheet allowance just now, so this sheet wasn't read. " +
  "Nothing has been charged. Retry it in a few minutes — if it keeps happening, contact C Stream.";

function stopSentence(ceiling: number, used: number): string {
  const left = Math.max(0, ceiling - used);
  return (
    `That sheet wasn't read: your company has used ${used} of its ${ceiling} plan sheets this month` +
    `${left === 0 ? "" : ` and ${left} are left`}. The allowance comes back on the first of next month. ` +
    `Nothing has been charged for this sheet.`
  );
}

/**
 * Claim ONE plan sheet, before the model is called.
 *
 * THE CEILING IS PASSED IN RATHER THAN RE-READ, because the caller has already got
 * it: `aiGate` returns the company's `AiSettings`, which carries
 * `planSheetsPerMonth`. Re-reading it here would be a second query per page — three
 * hundred of them on one set — to learn something the gate established a line
 * earlier.
 *
 * THE CLAIM IS ONE CONDITIONAL STATEMENT, the shape `claimAskAllowance` documents
 * at length and for its reason: under Postgres READ COMMITTED two concurrent claims
 * for the last sheet cannot both match, because the second blocks on the first's
 * row lock and then re-evaluates its `WHERE` against the committed value. So
 * `count === 0` IS the refusal, and there is no window between checking and
 * claiming. Nothing here reads the row first and decides in JavaScript.
 *
 * FAILS CLOSED. A cap that spends when it cannot check itself is not a cap — the
 * opposite posture to the hourly and daily courtesy limits in `usage.ts`, which
 * fail open on purpose because a counter that will not read should not stop a
 * person working. This one is the paid ceiling.
 */
export async function claimPlanSheet(
  companyId: string,
  ceiling: number,
  now: Date = new Date(),
): Promise<PlanSheetClaimResult> {
  const periodStart = periodStartFor(now);
  try {
    // The period row for this month, created on first use. Two pages arriving
    // together race here; the unique index decides, and P2002 means the other one
    // won — which is a success for us, because the row now exists.
    try {
      await prisma.askAllowancePeriod.upsert({
        where: { companyId_periodStart: { companyId, periodStart } },
        create: { companyId, periodStart },
        update: {},
      });
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code !== "P2002") throw err;
    }

    const claimed = await prisma.askAllowancePeriod.updateMany({
      where: { companyId, periodStart, planSheetsUsed: { lte: ceiling - 1 } },
      data: { planSheetsUsed: { increment: 1 } },
    });

    const row = await prisma.askAllowancePeriod.findUnique({
      where: { companyId_periodStart: { companyId, periodStart } },
      select: { planSheetsUsed: true },
    });
    if (!row) {
      console.error("[plan-ingest] the allowance period row disappeared mid-claim, so the sheet was REFUSED");
      return { ok: false, error: UNREADABLE };
    }

    if (claimed.count === 0) return { ok: false, error: stopSentence(ceiling, row.planSheetsUsed) };

    return { ok: true, claim: { companyId, periodStart }, sheetsLeft: Math.max(0, ceiling - row.planSheetsUsed) };
  } catch (err) {
    console.error(
      "[plan-ingest] a plan sheet could not be claimed against the monthly allowance, so it was REFUSED " +
        "rather than read unbounded — this cap fails closed.",
      err,
    );
    return { ok: false, error: UNREADABLE };
  }
}

/**
 * The model call that followed a claim failed. MARK IT — never release it.
 *
 * `allowance.ts` argues this for its own two units and the argument carries over
 * whole: releasing would let anyone defeat the cap by inducing failures, the
 * provider bills the tokens of a call that produced nothing usable, and this figure
 * is what makes a human credit possible — an owner can see on
 * `/settings/assistant` that the month included failures and ask for them back.
 * Nothing in this app adjusts an allowance automatically and nothing bills for one.
 *
 * Bookkeeping AFTER the fact, so a failure to write it is logged and swallowed: the
 * claim already stands, which is the conservative direction.
 */
export async function markPlanSheetFailure(claim: PlanSheetClaim): Promise<void> {
  try {
    await prisma.askAllowancePeriod.updateMany({
      where: { companyId: claim.companyId, periodStart: claim.periodStart },
      data: { failedPlanSheets: { increment: 1 } },
    });
  } catch (err) {
    console.error("[plan-ingest] a failed plan sheet could not be marked; the claim stands regardless", err);
  }
}

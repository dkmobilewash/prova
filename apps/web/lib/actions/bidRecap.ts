"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  bidRecap,
  spreadToLines,
  spreadTotal,
  type CostCategoryValue,
  type RecapLine,
  type RecapRates,
} from "@/lib/bid-recap";
import { NOT_ESTIMATE_STAGE } from "@/lib/estimating/draft-lines";
import {
  actionFail,
  actionOk,
  InputError,
  nullableDecimalFromForm,
  nullablePercentFromForm,
  runAction,
  type ActionResult,
  type ActionResultWith,
} from "./shared";

/**
 * The bid recap's writes: the rates, a line's cost type, and the one action
 * that pushes the bid into the line prices.
 *
 * GATES. The rates and the cost types are edited on the Estimate tab, which
 * withholds its whole body on VIEW_JOB_COSTS, so every write here asserts that
 * capability (issue #383 — a page guard stops a page, not an endpoint). The
 * company defaults are edited on Settings and answer to MANAGE_ESTIMATING,
 * owner-only, like the rest of that page.
 *
 * Every refusal is RETURNED. Percentages go through `nullablePercentFromForm`,
 * which bounds them 0-100 — the 0.10-meaning-ten-percent scar that withheld
 * $105 instead of $10,500 on a real contract — and raises `InputError`, which
 * `runAction` turns into a sentence a form can render.
 */

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const NO_SETTINGS =
  "Company settings aren't part of your job function. The account owner sets who sees what, on the Team page.";
const NO_JOB = "That job isn't on your account any more.";

/** Every rate the recap holds, in the order they apply. One list, so a new
 * rate cannot be added to the form and forgotten in the parse. */
const RATE_KEYS = [
  "materialMarkupPercent",
  "laborMarkupPercent",
  "subcontractorMarkupPercent",
  "otherMarkupPercent",
  "escalationPercent",
  "materialTaxPercent",
  "overheadPercent",
  "profitPercent",
  "bondPercent",
  "contingencyPercent",
] as const;

const RATE_LABELS: Record<(typeof RATE_KEYS)[number], string> = {
  materialMarkupPercent: "Material markup",
  laborMarkupPercent: "Labor markup",
  subcontractorMarkupPercent: "Subcontractor markup",
  otherMarkupPercent: "Other markup",
  escalationPercent: "Escalation",
  materialTaxPercent: "Sales tax on material",
  overheadPercent: "Overhead",
  profitPercent: "Profit",
  bondPercent: "Bond premium",
  contingencyPercent: "Contingency",
};

function ratesFromForm(formData: FormData): Record<string, string | null> {
  const rates: Record<string, string | null> = {};
  for (const key of RATE_KEYS) {
    rates[key] = nullablePercentFromForm(formData, key, { label: RATE_LABELS[key] });
  }
  return rates;
}

const COST_CATEGORIES: readonly CostCategoryValue[] = ["MATERIAL", "LABOR", "SUBCONTRACTOR", "OTHER"];

async function estimateJob(jobId: string, companyId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, status: true } });
  if (!job) return { ok: false as const, error: NO_JOB };
  if (job.status !== "ESTIMATE") return { ok: false as const, error: NOT_ESTIMATE_STAGE };
  return { ok: true as const };
}

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/estimate`);
}

/* --------------------------------------------------------------- the rates */

export async function saveBidRecap(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return actionFail(gate.error);

  return runAction(async () => {
    const rates = ratesFromForm(formData);
    await prisma.jobBidRecap.upsert({
      where: { jobId },
      create: { jobId, companyId, ...rates },
      // `appliedAt` is deliberately NOT cleared here: it records that a spread
      // happened, which stays true after the rates change. The screen compares
      // the two and says the applied prices are behind the current rates.
      update: rates,
    });
    revalidateJob(jobId);
    return actionOk;
  });
}

export async function setLineCostCategory(jobId: string, lineItemId: string, category: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return actionFail(gate.error);

  /*
   * THE `runAction` WRAPPER IS HERE FOR THE REFUSAL BELOW, NOT FOR PRISMA — and
   * the first version of this change said otherwise, which was wrong.
   *
   * #524 flagged "setLineCostCategory is not wrapped in runAction, so a Prisma
   * failure reaches production as a redacted digest". The premise is false:
   * `runAction` converts an `InputError` and RETHROWS everything else
   * (`shared.ts`), so wrapping buys nothing against a pool timeout. A Prisma
   * failure reaches production as a digest from EVERY action in this codebase,
   * wrapped or not, and that is deliberate — CLAUDE.md's rule is that `throw`
   * is for genuine bugs, and a connection timeout is one.
   *
   * Caught by writing the test for the claim: it asserted the action resolves
   * when Prisma throws, and it went red. The flag had been repeated from my own
   * PR body twice without anyone reading `runAction`.
   *
   * WHAT WAS ACTUALLY WRONG HERE, found while checking that: an unrecognised
   * category was SILENTLY COERCED TO NULL. `COST_CATEGORIES.includes(...)
   * ? ... : null` treats "MATERAIL" and a tampered value exactly like the
   * deliberate "no cost type" — so a bad value quietly CLEARED a line's cost
   * type, and an uncategorised line is never marked up. That is a line dropping
   * out of every markup because of a typo, with a success response.
   *
   * An empty string is the real "clear it" signal — the select's own
   * "No cost type" option — so that stays. Anything else is now refused, which
   * needs an `InputError`, which is what the wrapper is for.
   */
  return runAction(async () => {
    const trimmed = category.trim();
    const next = trimmed === "" ? null : (trimmed as CostCategoryValue);
    if (next !== null && !COST_CATEGORIES.includes(next)) {
      throw new InputError(
        `"${trimmed}" is not a cost type. Pick one of ${COST_CATEGORIES.join(", ")}, or "No cost type" to clear it.`,
      );
    }

    const updated = await prisma.jobLineItem.updateMany({
      where: { id: lineItemId, jobId, isDeleted: false },
      data: { costCategory: next },
    });
    if (updated.count === 0) throw new InputError("That line is no longer on the estimate.");

    revalidateJob(jobId);
    return actionOk;
  });
}

/**
 * Sets ONE line's budgeted cost, from the recap itself.
 *
 * WHY THIS EXISTS. #512 made the recap mark up `budgetedUnitCost`, and a line
 * with no cost is reported and marked up at nothing. On a job built through the
 * bid wizard — which collected only prices until #512 — that is every line, so
 * the recap reads $0 and names them all. Correct, and a dead end: the warning
 * told an estimator what was wrong and left him to go and find each line on
 * another part of the page.
 *
 * This is the way out, and CLAUDE.md asks for one by name ("real empty states
 * with a way out"). The cost goes in beside the cost type, in the row that is
 * already there for the other thing a line can be missing.
 *
 * DELIBERATELY NOT A "COPY PRICES INTO COSTS" BUTTON, which is the fix that
 * first suggests itself and is the original bug wearing a nicer coat: cost =
 * price is a 0% margin nobody typed, and the recap would then mark up the sale
 * price exactly as it did before #512. One number at a time, each one the
 * estimator's own.
 *
 * Shaped like `setLineCostCategory` above — same gates, same per-line
 * `updateMany` scoped by `jobId`, same refusal when the line has moved on — with
 * one difference: it is wrapped in `runAction`, so a parse failure comes back as
 * a sentence. `nullableDecimalFromForm`'s bounds are the reason that matters;
 * `InputError` is what a person can fix.
 */
export async function setLineBudgetedCost(jobId: string, lineItemId: string, cost: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return actionFail(gate.error);

  return runAction(async () => {
    const form = new FormData();
    form.set("budgetedUnitCost", cost);
    // Blank clears it, which is a real intent: "I do not know what this costs"
    // has to stay expressible, or the only way out of a wrong number is a
    // worse one. A cleared cost puts the line straight back into the warning.
    const next = nullableDecimalFromForm(form, "budgetedUnitCost", {
      label: "Budgeted cost",
      min: 0,
    });

    const updated = await prisma.jobLineItem.updateMany({
      where: { id: lineItemId, jobId, isDeleted: false },
      // `currentEstimatedUnitCost` is deliberately NOT touched. It is the PM's
      // live forecast and it diverges from the budget on purpose once a job
      // runs; re-deriving it here would overwrite a forecast from a screen that
      // is about the bid. `addLineItem` seeds them equal at creation and
      // `updateLineItemForecast` is what moves the forecast afterwards.
      data: { budgetedUnitCost: next },
    });
    if (updated.count === 0) throw new InputError("That line is no longer on the estimate.");

    revalidateJob(jobId);
    return actionOk;
  });
}

/* ------------------------------------------------------------- the spread */

export type ApplySummary = { bidTotal: number; appliedTotal: number; lineCount: number };

/**
 * Writes the bid into the line prices.
 *
 * WHY THIS IS AN EXPLICIT BUTTON RATHER THAN AUTOMATIC. Raising a line's unit
 * price changes the number every invoice, pay application, retainage balance
 * and WIP figure is computed from. That is exactly what SHOULD happen once a
 * bid is accepted — otherwise the app's contract value is short by the whole
 * markup — but it is a decision with a date on it, not a side effect of typing
 * a percentage.
 *
 * THE RATES ARE RE-READ AND THE MATH RE-RUN HERE. Nothing about the figure
 * comes from the request: a browser posts "apply", and what gets written is
 * computed on this side from the job's own lines and its own stored rates.
 */
export async function applyBidRecap(jobId: string): Promise<ActionResultWith<ApplySummary>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return gate;

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const recapRow = await tx.jobBidRecap.findFirst({ where: { jobId, companyId } });
      if (!recapRow) throw new InputError("Set the markup rates first — there is nothing to apply yet.");

      const rows = await tx.jobLineItem.findMany({
        where: { jobId, isDeleted: false },
        select: { id: true, quantity: true, budgetedUnitCost: true, unitPrice: true, costCategory: true },
      });
      const lines: RecapLine[] = rows.map((row) => ({
        id: row.id,
        quantity: Number(row.quantity),
        // #512. The bid is built from cost; `unitPrice` is what Apply WRITES,
        // which is why both are read here and only one is marked up.
        unitCost: row.budgetedUnitCost != null ? Number(row.budgetedUnitCost) : null,
        unitPrice: row.unitPrice != null ? Number(row.unitPrice) : null,
        costCategory: (row.costCategory as CostCategoryValue | null) ?? null,
      }));

      const rates: RecapRates = Object.fromEntries(
        RATE_KEYS.map((key) => [key, recapRow[key] != null ? Number(recapRow[key]) : null]),
      );
      const recap = bidRecap(lines, rates);
      if (recap.addedTotal === 0) {
        throw new InputError("These rates add nothing to the bid, so the line prices are already the bid.");
      }

      const spread = spreadToLines(lines, recap.bidTotal);
      if (spread.length === 0) {
        throw new InputError("No line on this estimate carries a price, so there is nothing to spread the bid across.");
      }
      for (const next of spread) {
        await tx.jobLineItem.update({ where: { id: next.id }, data: { unitPrice: next.unitPrice } });
      }

      const applied = spreadTotal(lines, spread);
      await tx.jobBidRecap.update({
        where: { id: recapRow.id },
        data: { appliedAt: new Date(), appliedTotal: applied.toFixed(2) },
      });
      return { bidTotal: recap.bidTotal, appliedTotal: applied, lineCount: spread.length };
    });

    revalidateJob(jobId);
    return { ok: true, value: summary };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}

/* ----------------------------------------------------------- the defaults */

/**
 * MANAGE_COMPLIANCE, not MANAGE_ESTIMATING, and deliberately not owner-only.
 *
 * The capability is the one its door takes: these are edited on /settings,
 * which withholds on MANAGE_COMPLIANCE, and an action must assert what its own
 * page withholds (issue #383). Asserting MANAGE_ESTIMATING instead would answer
 * an estimator who cannot open the page and refuse the office manager who can —
 * `action-capability-guards.test.ts` executed both and said so.
 *
 * The owner check is gone for the same reason: it refused a PAYROLL_COMPLIANCE
 * member holding the page's capability, which is that person's own work. The
 * page is owner-gated in its own right.
 */
export async function saveCompanyBidDefaults(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NO_SETTINGS);
  const companyId = context.company.id;

  return runAction(async () => {
    const rates = ratesFromForm(formData);
    await prisma.companyBidDefaults.upsert({
      where: { companyId },
      create: { companyId, ...rates },
      update: rates,
    });
    revalidatePath("/settings");
    return actionOk;
  });
}

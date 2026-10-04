import { prisma } from "@prova/db";
import { askFeatureLabel } from "@/lib/ai/features";
import {
  allowanceOver,
  costAtAllowance,
  costPerUnit,
  spendOver,
  startOfUtcMonth,
  tokensOver,
  type PricedRow,
  type Spend,
  type Tokens,
} from "./cost";

/**
 * The row-reading half of step 2 — what a company's AI actually cost.
 *
 * Split from `cost.ts` the way `takeoff-currency-query.ts` is split from
 * `takeoff-currency.ts`: the arithmetic stays pure and testable in a
 * millisecond, and the Prisma shapes live here.
 *
 * ── THE DENOMINATOR COMES FROM THE ALLOWANCE LEDGER, NOT FROM A ROW COUNT ──
 *
 * A cost per unit needs the unit the allowance is denominated in, and those
 * counts already exist on `AskAllowancePeriod`: `planSheetsUsed`,
 * `addendumPagesUsed`, `pagesUsed`, `questionsUsed`. Counting `AskUsage` rows
 * instead would divide by the wrong thing for three of the four — a plan-sheet
 * row happens to be one sheet, but one document read is one row and many pages,
 * so a per-page figure taken from rows would be the per-CALL figure wearing the
 * wrong label.
 *
 * `*Used` INCLUDES the failures, and that is correct for a cost: a claim
 * increments it before the call and `markAskAllowanceFailure` adds to
 * `failed*` without taking anything back, because a call that died halfway was
 * still billed. The failed count rides along so the screen can say how much of
 * the month produced nothing.
 */

/** A unit an allowance is denominated in, and the features that consume it. */
type Unit = {
  key: "planSheets" | "addendumPages" | "specPages" | "documentPages" | "questions";
  label: string;
  /** What one of them is called in a sentence. */
  noun: string;
  features: string[];
  used: number;
  failed: number;
  /** The monthly ceiling, so the screen can project a full month. */
  allowance: number | null;
};

export type FeatureSpend = {
  feature: string;
  label: string;
  calls: number;
  spend: Spend;
};

export type UnitCost = {
  key: Unit["key"];
  label: string;
  noun: string;
  used: number;
  failed: number;
  allowance: number | null;
  perUnit: number | null;
  atAllowance: number | null;
  spend: Spend;
};

export type CostReport = {
  from: Date;
  byFeature: FeatureSpend[];
  total: Spend;
  /** What `total` was computed from, so the figure can be checked on screen —
   *  see `tokensOver`. The panel shipped without this and a correct $0.43
   *  looked like a 1,000x rate error. */
  totalTokens: Tokens;
  units: UnitCost[];
  /** True when an allowance period reaching back before the window contributed
   *  its whole count, making every per-unit figure a slight UNDER-estimate.
   *  Printed rather than hidden — see `allowanceOver`. */
  straddled: boolean;
  /** Distinct reasons anything could not be priced, for one sentence at the top
   *  rather than the same words repeated per row. */
  missing: string[];
};

const ROW_FIELDS = {
  feature: true,
  model: true,
  createdAt: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  webSearches: true,
} as const;

/**
 * What this company's AI cost since `from`, by feature and per unit of work.
 *
 * Reads rows ONCE and groups in memory. The alternative is a `groupBy` per
 * feature, which would be four queries and could not price anything anyway:
 * a cost needs each row's own model and day, and a sum of tokens across
 * models is not a cost — it is a number that looks like one.
 */
export async function loadCostReport(companyId: string, from: Date): Promise<CostReport> {
  const [rows, periods, settings] = await Promise.all([
    prisma.askUsage.findMany({
      where: { companyId, createdAt: { gte: from } },
      select: ROW_FIELDS,
      // A cap, not a page: a company that somehow has more than this in a month
      // has a bigger problem than an understated figure, and an unbounded read
      // on a settings page is how a page stops loading.
      take: 20_000,
      orderBy: { createdAt: "desc" },
    }),
    // EVERY period overlapping the window, not one. `findFirst` with
    // `periodStart >= from` shipped on 2026-10-02 and divided a 30-day spend by
    // a single period's counts — blank when no period started inside the window,
    // and up to ~15x too high on the 1st of a month. `allowanceOver`'s header
    // has the full account. A period is a UTC calendar month with no end
    // column, so the ones that can overlap start at or after the first of the
    // window's own month.
    prisma.askAllowancePeriod.findMany({
      where: { companyId, periodStart: { gte: startOfUtcMonth(from) } },
      orderBy: { periodStart: "asc" },
    }),
    prisma.companyAiSettings.findUnique({ where: { companyId } }),
  ]);

  const byFeatureRows = new Map<string, PricedRow[]>();
  for (const row of rows) {
    const list = byFeatureRows.get(row.feature) ?? [];
    list.push(row);
    byFeatureRows.set(row.feature, list);
  }

  const byFeature: FeatureSpend[] = [...byFeatureRows.entries()]
    .map(([feature, featureRows]) => ({
      feature,
      // `askFeatureLabel` translates the LEDGER's kebab spelling to the label
      // map's SCREAMING_SNAKE key. Reading `AI_FEATURE_LABEL` directly here is
      // what shipped on 2026-10-02 and rendered every row's raw database key on
      // a money screen; that function's header has the whole story.
      label: askFeatureLabel(feature),
      calls: featureRows.length,
      spend: spendOver(featureRows),
    }))
    .sort((a, b) => b.spend.usd - a.spend.usd || b.calls - a.calls);

  const total = spendOver(rows);
  const claimed = allowanceOver(periods, from);

  const unitDefs: Unit[] = [
    {
      key: "planSheets",
      label: "Plan sheets read",
      noun: "sheet",
      features: ["plan-ingestion"],
      used: claimed.planSheetsUsed,
      failed: claimed.failedPlanSheets,
      allowance: settings?.planSheetsPerMonth ?? null,
    },
    {
      key: "addendumPages",
      label: "Addendum pages read",
      noun: "page",
      features: ["addendum-read"],
      used: claimed.addendumPagesUsed,
      failed: claimed.failedAddendumPages,
      allowance: settings?.addendumPagesPerMonth ?? null,
    },
    {
      // MISSING UNTIL 2026-10-04, and the click-through of #604 is what found
      // it: "the Cost per unit of work section has rows for plan sheets,
      // addendum pages and document pages, but none for spec pages, even though
      // the read is counted in usage and cost."
      //
      // Exactly right, and the consequence is the part worth recording. Spec
      // pages were registered in eight places that FAIL TO COMPILE when one is
      // missed — `AI_FEATURES`, `FEATURE_MODEL`, the `AiFeature` enum,
      // `AI_FEATURE_LABEL`, `AI_FEATURE_DESCRIPTION`, `AskUsageFeature`, the
      // gate census, `FEATURE_LABELS` — and this list is not one of them. So
      // `spec-read` showed up in the per-FEATURE spend (the tester saw its
      // 10,894-token call) while the per-UNIT figure, the one thing step 2 of
      // the AI plan exists to produce, was never computed for it.
      //
      // CLAUDE.md's #526 entry names this shape: a guard that a list is
      // COMPLETE cannot notice a SECOND list. `unitCensus.test.ts` now asks the
      // other question — is every metered unit here — because nothing is ever
      // missing from a list nobody checks.
      key: "specPages",
      label: "Spec section pages read",
      noun: "page",
      features: ["spec-read"],
      used: claimed.specPagesUsed,
      failed: claimed.failedSpecPages,
      allowance: settings?.specPagesPerMonth ?? null,
    },
    {
      key: "documentPages",
      label: "Document pages read",
      noun: "page",
      // The shared document ledger: compliance uploads and quote reads both
      // claim against `pagesUsed`, so their cost shares the denominator.
      features: ["compliance-extract", "quote-extract"],
      used: claimed.pagesUsed,
      failed: claimed.failedPages,
      allowance: null,
    },
    {
      key: "questions",
      label: "Assistant questions",
      noun: "question",
      features: ["ask"],
      used: claimed.questionsUsed,
      failed: claimed.failedQuestions,
      allowance: null,
    },
  ];

  const units: UnitCost[] = unitDefs.map((unit) => {
    const unitRows = unit.features.flatMap((feature) => byFeatureRows.get(feature) ?? []);
    const spend = spendOver(unitRows);
    const perUnit = costPerUnit(spend, unit.used);
    return {
      key: unit.key,
      label: unit.label,
      noun: unit.noun,
      used: unit.used,
      failed: unit.failed,
      allowance: unit.allowance,
      perUnit,
      atAllowance: unit.allowance != null ? costAtAllowance(perUnit, unit.allowance) : null,
      spend,
    };
  });

  return {
    from,
    byFeature,
    total,
    totalTokens: tokensOver(rows),
    units,
    straddled: claimed.straddled,
    missing: total.missing,
  };
}

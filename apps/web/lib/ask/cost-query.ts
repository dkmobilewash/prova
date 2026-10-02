import { prisma } from "@prova/db";
import { AI_FEATURE_LABEL } from "@/lib/ai/features";
import { costPerUnit, costAtAllowance, spendOver, type PricedRow, type Spend } from "./cost";

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
  key: "planSheets" | "addendumPages" | "documentPages" | "questions";
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
  units: UnitCost[];
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
  const [rows, period, settings] = await Promise.all([
    prisma.askUsage.findMany({
      where: { companyId, createdAt: { gte: from } },
      select: ROW_FIELDS,
      // A cap, not a page: a company that somehow has more than this in a month
      // has a bigger problem than an understated figure, and an unbounded read
      // on a settings page is how a page stops loading.
      take: 20_000,
      orderBy: { createdAt: "desc" },
    }),
    prisma.askAllowancePeriod.findFirst({
      where: { companyId, periodStart: { gte: from } },
      orderBy: { periodStart: "desc" },
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
      // An unlabelled feature appears under its own key rather than being
      // dropped — the rule `/settings/assistant` already follows for a fifth
      // caller nobody has named yet.
      label: AI_FEATURE_LABEL[feature as keyof typeof AI_FEATURE_LABEL] ?? feature,
      calls: featureRows.length,
      spend: spendOver(featureRows),
    }))
    .sort((a, b) => b.spend.usd - a.spend.usd || b.calls - a.calls);

  const total = spendOver(rows);

  const unitDefs: Unit[] = [
    {
      key: "planSheets",
      label: "Plan sheets read",
      noun: "sheet",
      features: ["plan-ingestion"],
      used: period?.planSheetsUsed ?? 0,
      failed: period?.failedPlanSheets ?? 0,
      allowance: settings?.planSheetsPerMonth ?? null,
    },
    {
      key: "addendumPages",
      label: "Addendum pages read",
      noun: "page",
      features: ["addendum-read"],
      used: period?.addendumPagesUsed ?? 0,
      failed: period?.failedAddendumPages ?? 0,
      allowance: settings?.addendumPagesPerMonth ?? null,
    },
    {
      key: "documentPages",
      label: "Document pages read",
      noun: "page",
      // The shared document ledger: compliance uploads and quote reads both
      // claim against `pagesUsed`, so their cost shares the denominator.
      features: ["compliance-extract", "quote-extract"],
      used: period?.pagesUsed ?? 0,
      failed: period?.failedPages ?? 0,
      allowance: null,
    },
    {
      key: "questions",
      label: "Assistant questions",
      noun: "question",
      features: ["ask"],
      used: period?.questionsUsed ?? 0,
      failed: period?.failedQuestions ?? 0,
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

  return { from, byFeature, total, units, missing: total.missing };
}

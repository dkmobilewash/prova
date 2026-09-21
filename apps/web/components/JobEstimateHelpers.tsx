import { money } from "@/lib/money";
import type { ProductionBackCheck } from "@/lib/labor-productivity";

export const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

/**
 * How much to trust a drafted price.
 *
 * One "AI-drafted — verify" pill for every machine-produced row said only
 * that a machine made it, which is the flaw the market research names as
 * fatal in every competitor's auto-pricing: a well-grounded number and an
 * invented one look identical. After grounding the draft in this company's
 * own catalog and won bids, a price can come from three places that deserve
 * very different confidence, so they get three visibly different badges.
 */
export function PriceBasisBadge({
  basis,
}: {
  basis: "COMPANY_CATALOG" | "HISTORICAL_BID" | "GENERAL_KNOWLEDGE" | null;
}) {
  if (basis === "COMPANY_CATALOG") {
    return (
      <span className="inline-flex items-center rounded-full bg-tag-green px-2 py-0.5 text-xs font-medium text-tag-green-ink">
        Your catalog price
      </span>
    );
  }
  if (basis === "HISTORICAL_BID") {
    return (
      <span className="inline-flex items-center rounded-full bg-tag-blue px-2 py-0.5 text-xs font-medium text-tag-blue-ink">
        From your past bids — verify
      </span>
    );
  }
  if (basis === "GENERAL_KNOWLEDGE") {
    return (
      <span className="inline-flex items-center rounded-full bg-tag-amber px-2 py-0.5 text-xs font-medium text-tag-amber-ink">
        AI guess, no company data — check the price
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-700 px-2 py-0.5 text-xs font-medium text-ink-label">
      AI-drafted, unpriced — verify
    </span>
  );
}

/**
 * "≈ $X labor" beside the hours field. Read-only and informational — never
 * written into budgetedUnitCost, which stays the estimator's own number, the
 * same philosophy as the estimatedCostToComplete PM override.
 */
export function LaborCostHint({ cost }: { cost: number | null }) {
  if (cost === null) return null;
  return (
    <span className="text-xs text-ink-body" title="Burdened labor: base wage plus fringes, at straight time">
      ≈ {money(cost)} labor
    </span>
  );
}

/**
 * "actual 50 SF/hr vs 62.5 est · -20%" beside the rate field — the back-check
 * the competitive audit's #1 finding calls the point of a production rate. It
 * compares the hours logged against the line to what the estimate assumed;
 * nothing is stored, so it updates as hours are logged.
 */
export function ProductionBackCheckHint({
  check,
  unit,
}: {
  check: ProductionBackCheck | null;
  unit: string | null;
}) {
  if (check === null) return null;
  const unitLabel = unit ? ` ${unit}` : "";
  const pct = Math.round(check.variance * 100);
  const signed = pct > 0 ? `+${pct}%` : `${pct}%`;
  return (
    <span
      className={`text-xs ${check.isFlagged ? "text-tag-amber-ink" : "text-ink-body"}`}
      title="Actual production rate vs. what this line was estimated at, derived from the hours logged against it. Negative means the crew is slower than the estimate."
    >
      actual {check.actualRate.toFixed(1)}
      {unitLabel}/hr vs {check.estimatedRate.toFixed(1)} est · {signed}
    </span>
  );
}

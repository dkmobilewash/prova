import { money } from "@/lib/money";
import {
  MIN_EARNED_COVERAGE,
  marginIsHealthy,
  type CompanyFinancials,
} from "@/lib/company-financials";

/**
 * Four company-wide numbers, pinned under the content.
 *
 * Inside the content column rather than fixed to the viewport, so it can
 * never sit over the nav rail — and so a page that scrolls keeps it in
 * view without the rail having to know it exists.
 *
 * Dark, matching the rail and the top bar: the chrome is one surface and
 * the page inside it is another. It moves to the light tokens when the
 * pages it frames do.
 *
 * The margin is the only conditionally-coloured figure here, and only
 * above the healthy threshold. Colouring a number green regardless of its
 * value teaches people to stop reading the colour; a 24.6% margin is
 * ordinary and should look ordinary.
 */
export function MetricBar({ financials }: { financials: CompanyFinancials }) {
  const marginText =
    financials.grossMarginRate === null
      ? "—"
      : `${(financials.grossMarginRate * 100).toFixed(1)}%`;

  // "—" used to mean only "nothing earned yet". It now also means "not
  // enough of the book carries an earned-revenue figure to blend a margin
  // over" — a dash with no reason beside it reads as broken, and the
  // difference between the two is the difference between a quiet start and
  // a book nobody has finished estimating.
  const marginHint =
    financials.grossMarginRate === null && financials.earnedCoverage < MIN_EARNED_COVERAGE
      ? `${Math.round(financials.earnedCoverage * 100)}% estimated, needs ${Math.round(
          MIN_EARNED_COVERAGE * 100,
        )}%`
      : undefined;

  return (
    <div className="print:hidden flex h-[52px] shrink-0 items-center gap-6 overflow-x-auto border-t border-slate-800 bg-slate-900 px-4 sm:px-6">
      <Metric label="Estimated revenue" value={money(financials.estimatedRevenue)} />
      <Metric
        label="Gross margin"
        value={marginText}
        hint={marginHint}
        tone={marginIsHealthy(financials.grossMarginRate) ? "good" : "neutral"}
      />
      <Metric label="Cash collected" value={money(financials.cashPosition)} />
      <Metric label="Retainage held" value={money(financials.retainageHeld)} />
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good";
}) {
  return (
    <div className="flex shrink-0 items-baseline gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span
        className={`text-sm font-semibold tabular-nums ${
          tone === "good" ? "text-green-400" : "text-slate-100"
        }`}
      >
        {value}
      </span>
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </div>
  );
}

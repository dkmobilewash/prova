import { money } from "@/lib/money";
import { marginIsHealthy, type CompanyFinancials } from "@/lib/company-financials";

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

  return (
    <div className="print:hidden flex h-[52px] shrink-0 items-center gap-6 overflow-x-auto border-t border-slate-800 bg-slate-900 px-4 sm:px-6">
      <Metric label="Estimated revenue" value={money(financials.estimatedRevenue)} />
      <Metric
        label="Gross margin"
        value={marginText}
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
  tone = "neutral",
}: {
  label: string;
  value: string;
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
    </div>
  );
}

import { Hint } from "@/components/Hint";
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
      <Metric
        label="Estimated revenue"
        value={money(financials.estimatedRevenue)}
        describe="Contract value across your active jobs — what you have sold. Not what has been billed, and not what has come in."
      />
      <Metric
        label="Gross margin"
        value={marginText}
        hint={marginHint}
        tone={marginIsHealthy(financials.grossMarginRate) ? "good" : "neutral"}
        describe="Earned revenue less the cost you have run up, blended across your active jobs. A dash means nothing is earned yet, or too little of the book is estimated to blend one honestly."
      />
      <Metric
        label="Cash collected"
        value={money(financials.cashPosition)}
        describe="Payments logged as received against your invoices. Not what is billed and not what is owed — what came in."
      />
      <Metric
        label="Retainage held"
        value={money(financials.retainageHeld)}
        describe="What GCs are still holding out of what they have been billed, across every job: withheld less released. Yours, and not paid yet."
      />
    </div>
  );
}

/**
 * One figure, and what it counts.
 *
 * `describe` is required — `hintCensus.test.ts` fails the build without it.
 * These four numbers are the product's own argument and nothing anywhere
 * said what any of them meant: "Cash collected" and "Estimated revenue" are
 * both money and neither is what an owner assumes until told.
 *
 * THE FIGURE IS A TAB STOP NOW, and that is the cost of the feature rather
 * than an accident. A hover-only explanation is no explanation for anyone
 * using a keyboard, and the only way a static figure can take focus is
 * `tabIndex`. It adds four stops at the end of every page. The `div` became
 * a `span` in the same change; it still carries `flex`, so its box is the
 * box it was.
 */
function Metric({
  label,
  value,
  hint,
  describe,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  describe: string;
  tone?: "neutral" | "good";
}) {
  return (
    <Hint text={describe}>
      <span
        tabIndex={0}
        className="flex shrink-0 items-baseline gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
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
      </span>
    </Hint>
  );
}

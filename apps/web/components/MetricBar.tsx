"use client";

/**
 * A CLIENT component, and that is load-bearing rather than incidental.
 *
 * `Metric` below hands a `<span>` to `<Hint>`, which is a client
 * component. While this file was a SERVER component that span had to
 * travel through React's Flight payload to get there — and React's
 * production serializer defers any element it reaches after the current
 * row has passed 3,200 bytes, so the span arrived in the browser as a
 * LAZY with no `.props` and `Hint` threw reading one. This bar is in the
 * `(app)` layout, so that took down every signed-in page: the dashboard,
 * the jobs list and every job tab, with no way out of it from the UI.
 * Created here in the browser, the element never crosses that boundary
 * and cannot be deferred.
 *
 * `financials` is plain numbers, so nothing else about this changes: the
 * queries still run on the server in the layout, and only the four
 * already-computed figures are serialized.
 *
 * `hintClientOnly.test.ts` fails the build if this directive is ever
 * removed, or if any other file rendering <Hint> is a server component.
 */

import { Hint } from "@/components/Hint";
import { money } from "@/lib/money";
import {
  MIN_EARNED_COVERAGE,
  hasNothingToSay,
  marginIsHealthy,
  type CompanyFinancials,
} from "@/lib/company-financials";

/**
 * Four company-wide numbers, at the top of the Money area (/areas/money).
 *
 * MOVED 2026-10-10 (Concept G). This was a 52px strip pinned under the
 * content of EVERY page, and it covered things: on a job's Billing stage it
 * sat over "Review & send". Concept G has no bottom chrome, so the figures
 * live where someone goes to look at money, behind the same
 * VIEW_COMPANY_FINANCIALS gate the strip had. The component keeps its name
 * so `hintCensus.test.ts` and `hintClientOnly.test.ts` keep pointing at it.
 *
 * The margin is the only conditionally-coloured figure here, and only
 * above the healthy threshold. Colouring a number green regardless of its
 * value teaches people to stop reading the colour; a 24.6% margin is
 * ordinary and should look ordinary.
 *
 * IT RENDERS NOTHING UNTIL IT HAS A FIGURE. On a brand-new account all four
 * read "$0.00 / - / $0.00 / $0.00", which says less than nothing; it comes
 * back the instant any of the four becomes a number.
 */
export function MetricBar({ financials }: { financials: CompanyFinancials }) {
  if (hasNothingToSay(financials)) return null;

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
    <section aria-label="Company figures" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-area="company-figures">
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
    </section>
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
 * THE FIGURE IS A TAB STOP, and that is the cost of the feature rather
 * than an accident. A hover-only explanation is no explanation for anyone
 * using a keyboard, and the only way a static figure can take focus is
 * `tabIndex`.
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
        className="flex h-full min-w-0 flex-col rounded-[14px] border border-line-card bg-surface px-4 py-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {/* `text-slate-500` until 2026-09-21, and it was 3.66:1 on this
            ground — below the 4.5:1 floor, at 10px, uppercase, in a truck
            in daylight, on the one strip of text that says WHICH of four
            money figures you are reading. Exactly the scar
            `theme-contrast.test.ts`'s own header records ("a muted grey at
            2.4:1 that was carrying stat-tile labels"), which that census
            cannot see because it matches `bg-brand` and nothing maps a raw
            grey back to the ground under it. `ink-muted` is 6.9:1 here and
            is the token the config sanctions for exactly this job. */}
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        <span
          className={`mt-1.5 truncate font-headline text-[26px] leading-tight tabular-nums ${
            tone === "good" ? "text-ok" : "text-ink"
          }`}
        >
          {value}
        </span>
        {hint && <span className="mt-0.5 text-xs text-ink-muted">{hint}</span>}
      </span>
    </Hint>
  );
}

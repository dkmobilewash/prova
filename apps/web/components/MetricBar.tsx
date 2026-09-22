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
 *
 * AND IT RENDERS NOTHING UNTIL IT HAS A FIGURE, which is a usability fix
 * rather than a tidy-up. On a brand-new account all four read
 * "$0.00 / — / $0.00 / $0.00", and those 52px come off the bottom of the
 * scroll port on EVERY screen — measured on `/jobs/new/[id]/items` at a
 * 740px-tall window, where the page's own "Continue" button sat below the
 * port with the bar occupying the pixels where it would otherwise have
 * been. A bar with nothing to report was pushing the primary control of
 * the screen out of sight. It comes back the instant any of the four
 * becomes a number, so nothing a reader has ever seen disappears on them.
 *
 * Deliberately NOT "hide the zeros and keep the bar": a 52px empty strip
 * costs the same pixels and says less than nothing.
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
    <div className="print:hidden flex h-[52px] shrink-0 items-center gap-6 overflow-x-auto border-t border-line-card bg-surface px-4 sm:px-6">
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
        {/* `text-slate-500` until 2026-09-21, and it was 3.66:1 on this
            ground — below the 4.5:1 floor, at 10px, uppercase, in a truck
            in daylight, on the one strip of text that says WHICH of four
            money figures you are reading. Exactly the scar
            `theme-contrast.test.ts`'s own header records ("a muted grey at
            2.4:1 that was carrying stat-tile labels"), which that census
            cannot see because it matches `bg-brand` and nothing maps a raw
            grey back to the ground under it. `ink-muted` is 6.9:1 here and
            is the token the config sanctions for exactly this job. */}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            tone === "good" ? "text-green-400" : "text-ink"
          }`}
        >
          {value}
        </span>
        {hint && <span className="text-[10px] text-ink-muted">{hint}</span>}
      </span>
    </Hint>
  );
}

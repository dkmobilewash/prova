import type { CostReport } from "@/lib/ask/cost-query";

/**
 * WHAT THE AI COST, AND WHAT ONE UNIT OF WORK COSTS — step 2 on screen.
 *
 * A server component with no state: every figure is computed from rows at read
 * time (`lib/ask/cost.ts`), so there is nothing to hydrate and nothing stored
 * that could disagree with its own inputs.
 *
 * ── AN UNKNOWN COST SAYS SO, AND NEVER SHOWS A ZERO ──
 *
 * Three of the five rates are not confirmed yet, and a model routed somewhere
 * new will have none. `$0.00` on a cost screen reads as "that was free", which
 * is the one reading that stops anybody asking — so an unpriced row is counted
 * apart and named, and a figure that could not be computed is a dash with a
 * reason rather than a number.
 *
 * ── AND IT SAYS WHEN A TOTAL IS A FLOOR ──
 *
 * `AskUsage.webSearches` only began being recorded on 2026-10-02. Rows before
 * that read zero searches whether any ran or not, so any window spanning it
 * understates lead search and bid research by an amount nothing can recover.
 * The panel says that out loud rather than presenting the total as complete —
 * the same rule the WIP figures follow about a thin estimate: blank, or
 * qualified, never quietly wrong.
 */

/** The window this panel reports on, so the page and the query agree on it. */
export function thirtyDaysAgo(now: Date): Date {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

function usd(value: number): string {
  // Four decimals under a cent, because a per-sheet cost is fractions of one
  // and rounding it to $0.00 would delete the figure this panel exists for.
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function CostPanel({ report }: { report: CostReport }) {
  const anyPriced = report.total.priced > 0;

  return (
    <section className="mb-6 rounded-lg border border-line-card bg-surface p-4" data-ask="cost">
      <h2 className="mb-1 text-sm font-semibold text-ink">What it cost, last 30 days</h2>

      {!anyPriced ? (
        <p className="text-sm text-ink-body">
          Nothing here can be priced yet.{" "}
          {report.total.unpriced > 0
            ? `${report.total.unpriced} ${report.total.unpriced === 1 ? "call" : "calls"} were recorded and no rate is set for them.`
            : "No model calls in the last 30 days."}
        </p>
      ) : (
        <>
          <p className="mb-1 text-sm text-ink-body">
            <strong className="text-ink">{usd(report.total.usd)}</strong> across{" "}
            {report.total.priced} priced {report.total.priced === 1 ? "call" : "calls"}
            {report.total.unpriced > 0 && (
              <>
                {" "}
                — and <strong className="text-ink">{report.total.unpriced}</strong>{" "}
                {report.total.unpriced === 1 ? "call that could not be priced" : "calls that could not be priced"}
              </>
            )}
            .
          </p>
          {report.total.understated && (
            // Not a footnote. A total that is a floor and does not say so is the
            // kind of figure somebody quotes.
            <p className="mb-2 text-xs text-ink-muted">
              This is a FLOOR, not a total: web searches were not recorded before 2 October 2026, and
              lead search and bid research bill per search on top of tokens. Calls from before then are
              counted at their token cost only.
            </p>
          )}
        </>
      )}

      {report.missing.length > 0 && (
        <p className="mb-3 rounded-md bg-tag-amber px-3 py-2 text-xs text-tag-amber-ink">
          Not priced because: {report.missing.join("; ")}. Rates live in{" "}
          <code>packages/integrations/src/pricing.ts</code>.
        </p>
      )}

      {report.byFeature.length > 0 && (
        <ul className="mb-3 divide-y divide-line-row text-sm" data-ask="cost-by-feature">
          {report.byFeature.map((row) => (
            <li key={row.feature} className="flex justify-between gap-3 py-1">
              <span className="text-ink-label">{row.label}</span>
              <span className="text-ink-muted">
                {row.calls} {row.calls === 1 ? "call" : "calls"} ·{" "}
                {row.spend.priced > 0 ? usd(row.spend.usd) : "not priced"}
                {row.spend.unpriced > 0 && row.spend.priced > 0 && ` (${row.spend.unpriced} not priced)`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* THE FIGURE STEP 2 EXISTS FOR. DECISIONS.md's open question is whether
          1,500 plan sheets and 600 addendum pages a month are sustainable, and
          it says only a measured per-unit cost can answer it. The right-hand
          column is that answer: what a full month at the ceiling would cost. */}
      <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-label">
        Cost per unit of work
      </h3>
      <ul className="divide-y divide-line-row text-sm" data-ask="cost-per-unit">
        {report.units.map((unit) => (
          <li key={unit.key} className="flex justify-between gap-3 py-1">
            <span className="text-ink-label">
              {unit.label}
              {unit.used > 0 && (
                <span className="text-ink-muted">
                  {" "}
                  · {unit.used.toLocaleString("en-US")}
                  {unit.failed > 0 && `, ${unit.failed.toLocaleString("en-US")} of them failed`}
                </span>
              )}
            </span>
            <span className="min-w-0 text-right text-ink-muted">
              {unit.perUnit === null ? (
                // A month with no plan sheets has no cost per sheet. Inventing
                // one from a single row would be the most confidently wrong
                // number on this page.
                <span>{unit.used === 0 ? `no ${unit.noun}s this month` : "not priced"}</span>
              ) : (
                <>
                  <span className="text-ink">{usd(unit.perUnit)}</span> per {unit.noun}
                  {unit.atAllowance != null && (
                    <span className="block text-xs">
                      {unit.allowance?.toLocaleString("en-US")} a month would be {usd(unit.atAllowance)}
                    </span>
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-ink-muted">
        Figures are computed from recorded tokens and searches against the rate in force on each call&apos;s
        own day — nothing is stored, so a rate correction moves every past figure with it. A per-unit cost
        divides by the units the allowance counts, failures included, because a call that died halfway was
        still billed.
      </p>
    </section>
  );
}

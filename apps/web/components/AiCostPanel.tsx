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
 * All five rates are recorded as of 2026-10-02, so nothing a currently-routed
 * model writes reads unknown today. That is a fact about this week rather than
 * a property of the panel: a model routed somewhere new arrives with no rate at
 * all, and a price change recorded for only some token kinds arrives with a
 * partial one. `$0.00` on a cost screen reads as "that was free", which is the
 * one reading that stops anybody asking — so an unpriced row is counted apart
 * and named, and a figure that could not be computed says so in words rather
 * than as a number.
 *
 * (That sentence said "three of the five rates are not confirmed yet" until
 * 2026-10-02, which was true when it was written and false the hour the rates
 * were filled in. Left standing, it would have told the next reader this panel
 * cannot price cache tokens and sent them looking for a gap that is closed.)
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

function tok(value: number): string {
  return value.toLocaleString("en-US");
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
          {/* WHAT THE TOTAL WAS COMPUTED FROM. The panel shipped without this
              and a CORRECT $0.43 read as a 1,000x rate error, because the usage
              block above shows only two of the four token kinds this charges
              for — the cache tokens, which Ask generates on every pass, were
              invisible. `tokensOver`'s header has the full account. */}
          <p className="mb-2 text-xs text-ink-muted" data-ask="cost-inputs">
            From {tok(report.totalTokens.inputTokens)} in · {tok(report.totalTokens.outputTokens)} out
            {report.totalTokens.cacheWriteTokens > 0 && <> · {tok(report.totalTokens.cacheWriteTokens)} cache written</>}
            {report.totalTokens.cacheReadTokens > 0 && <> · {tok(report.totalTokens.cacheReadTokens)} cache read</>}
            {report.totalTokens.webSearches > 0 && (
              <>
                {" "}
                · {tok(report.totalTokens.webSearches)}{" "}
                {report.totalTokens.webSearches === 1 ? "web search" : "web searches"}
              </>
            )}
            . Cached tokens are most of a repeat question&apos;s cost and are not in the usage figures above.
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
      {report.straddled && (
        // Same rule as the FLOOR note above: qualified, never quietly wrong.
        // An allowance period is a calendar month and its counters are
        // per-period, so the earliest one contributes days before this window
        // began. Nothing records which day a unit was claimed on, so it cannot
        // be apportioned — the denominator is a little too big and these
        // figures are therefore a little too LOW.
        <p className="mb-2 text-xs text-ink-muted">
          These are slight UNDER-estimates: an allowance period that began before this window counts in
          full, because the ledger counts units per month rather than per day.
        </p>
      )}
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

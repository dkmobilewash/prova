import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { money } from "@/lib/money";
import { formatCoveragePercent } from "@/lib/wip";
import { loadPhaseCodeRollup } from "@/lib/phase-code-rollup-query";
import type { PhaseCodeRollupRow } from "@/lib/phase-code-rollup";

/**
 * Budget versus actual PER PHASE CODE, ACROSS EVERY JOB.
 *
 * The question this page answers cannot be asked anywhere else in the app:
 * a JobLineItem's description is free text and belongs to one job, so
 * "what has plywood actually cost us this year" has, until now, meant
 * opening every job and reading. A phase code is the company's own name
 * for a bucket of work, and this totals the same bucket across the book.
 *
 * WHY THE UNCODED ROW IS NOT OPTIONAL. Most line items have no phase code
 * — there is no backfill, and the schema comment says there never will be,
 * because inferring a phase from a description is the guess the column
 * exists to replace. A page that quietly summed only the coded lines would
 * show a contractor a total that looks like their whole budget and is not,
 * and they would have no way to tell. So uncoded work gets its own row
 * with its own money, the coverage line says what share of the budget the
 * coded rows actually cover, and both are on screen before any of the
 * per-phase figures are.
 *
 * Every figure here is derived at read time. Nothing is stored — a stored
 * total is a total that can disagree with what it was derived from.
 */

/** VIEW_COMPANY_FINANCIALS, and it is an arguable call made deliberately.
 *
 * This is cost summed across EVERY job, which is the definition that
 * capability carries in lib/permissions.ts ("Company-wide money") and the
 * reason PROJECT_MANAGER is excluded from it there: "a PM needs their own
 * jobs rather than the whole book". This page is the whole book, by phase
 * instead of by job, so gating it on VIEW_JOB_COSTS — whose own comment
 * scopes it to "a job" — would hand a PM and an estimator exactly what
 * that rule withholds.
 *
 * The cost of the call is real and worth naming: an ESTIMATOR holds
 * VIEW_JOB_COSTS and not this, and historical cost per phase is precisely
 * what pricing the next job wants. They can still read cost job by job.
 * Widening this later is a decision somebody can make in one line; a page
 * that had already shown the whole book to everyone with VIEW_JOB_COSTS
 * cannot be un-shown. `/cash-flow`, the app's only other cross-job money
 * page, is gated the same way.
 *
 * A FIELD user holds neither, and so reaches neither.
 *
 * Spelled out as a literal at both call sites below rather than hoisted
 * into a constant: lib/permissions.test.ts reads the guard out of this
 * file's SOURCE, matching `requireCapability("…")` and the `capability`
 * prop on `<NoAccess>`, so a constant makes a genuinely guarded page read
 * as an unguarded one to the enumeration that exists to catch unguarded
 * pages. Found by that test, which is the behaviour it is for. */

function varianceClass(variance: number) {
  if (variance < 0) return "text-red-400";
  if (variance > 0) return "text-green-400";
  return "text-ink-body";
}

/** "$1,200 over" / "$800 under" / "on budget" — the sign spelled out,
 * because a bare negative number in a money column is read as a credit by
 * half the people who see it and as an overrun by the other half. */
function varianceLabel(variance: number) {
  if (variance === 0) return "on budget";
  return `${money(Math.abs(variance))} ${variance < 0 ? "over" : "under"}`;
}

function jobsLabel(count: number) {
  if (count === 0) return "—";
  return count === 1 ? "1 job" : `${count} jobs`;
}

const cell = "px-3 py-2 text-sm";
const numeric = `${cell} text-right tabular-nums`;

function Row({ row, uncoded = false }: { row: PhaseCodeRollupRow; uncoded?: boolean }) {
  return (
    <tr className={uncoded ? "border-t-2 border-line-card bg-tag-amber/20" : "border-t border-line-row"}>
      <td className={cell}>
        {uncoded ? (
          <span className="font-medium text-tag-amber-ink">Not coded to a phase</span>
        ) : (
          <span className="font-medium text-ink">
            {row.phase?.code}
            {row.phase && !row.phase.isActive && (
              <span className="ml-2 rounded bg-tag-amber px-1.5 py-0.5 text-xs text-tag-amber-ink">
                Retired
              </span>
            )}
          </span>
        )}
      </td>
      <td className={`${cell} text-ink-body`}>
        {uncoded ? (
          <>
            {row.lineCount === 1 ? "1 line item" : `${row.lineCount} line items`} with no phase code
            on them
          </>
        ) : (
          <>
            {row.phase?.name}
            {row.phase?.unit ? <span className="text-ink-muted"> · {row.phase.unit}</span> : null}
          </>
        )}
      </td>
      <td className={`${numeric} text-ink-body`}>{jobsLabel(row.jobCount)}</td>
      <td className={`${numeric} text-ink`}>
        {money(row.budgetedCost)}
        {/* A line with no budgeted unit cost contributes nothing to the
            number on its left, so the number on its left is understated.
            Said here rather than folded into a footnote nobody reads. */}
        {row.linesWithoutBudget > 0 && (
          <span
            className="ml-1 text-xs text-tag-amber-ink"
            title={`${row.linesWithoutBudget} line${row.linesWithoutBudget === 1 ? " has" : "s have"} no budgeted cost entered, so this total is lower than the real budget for this phase.`}
          >
            +{row.linesWithoutBudget} unbudgeted
          </span>
        )}
      </td>
      <td className={`${numeric} text-ink`}>
        {money(row.actualCost)}
        {/* #287: actual cost now includes the crew's burdened time. Hours
            that no wage schedule could price added NOTHING to the figure on
            the left, and "we had no rate for it" and "it cost nothing" read
            identically in a variance — which on a phase flagged tracksLabor
            is the likeliest misreading on this page. */}
        {row.unpricedLaborHours > 0 && (
          <span
            className="ml-1 text-xs text-tag-amber-ink"
            title={`${row.unpricedLaborHours} hour${row.unpricedLaborHours === 1 ? "" : "s"} logged against this phase have no wage rate behind them, so this total is lower than what the work really cost. Add a fringe rate schedule for that craft and those dates.`}
          >
            +{row.unpricedLaborHours} hrs unpriced
          </span>
        )}
      </td>
      <td className={`${numeric} ${varianceClass(row.variance)}`}>{varianceLabel(row.variance)}</td>
    </tr>
  );
}

export default async function PhaseCodesPage() {
  const { context, allowed } = await requireCapability("VIEW_COMPANY_FINANCIALS");
  if (!allowed) return <NoAccess capability="VIEW_COMPANY_FINANCIALS" />;

  const rollup = await loadPhaseCodeRollup(context.company.id);
  const hasUncoded = rollup.uncoded.lineCount > 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Phase codes</h1>
      <p className="mb-6 max-w-3xl text-sm text-ink-body">
        Budget against actual for each of your own cost codes, totalled across every job you run.
        Your codes and their names come from{" "}
        <Link href="/settings#phase-codes" className="text-link hover:text-link-hover">
          Settings
        </Link>
        ; a line item is counted here once somebody codes it to one.
      </p>

      {rollup.rows.length === 0 ? (
        /* The empty state, and it explains the thing before offering the
           button: "phase code" is a term this product is asking somebody
           to adopt, and a page that says "none yet" to a reader who does
           not know what one is has told them nothing. */
        <div className="rounded-lg border border-line-card bg-surface p-6" data-tour="phase-codes-empty">
          <h2 className="mb-2 text-sm font-semibold text-ink-label">
            You haven&apos;t set up any phase codes yet
          </h2>
          <p className="mb-3 max-w-2xl text-sm text-ink-body">
            A phase code is your own name for a bucket of work — a number and a description, the way
            you already write them on your budget: <span className="text-ink-label">04112</span> for{" "}
            <span className="text-ink-label">Plywood - SF</span>. They are your words, not a
            standard list, so nothing is checked against MasterFormat and you can call them whatever
            your estimates already call them.
          </p>
          <p className="mb-4 max-w-2xl text-sm text-ink-body">
            Once line items carry one, this page totals what you budgeted against what the work has
            actually cost — the same phase across every job at once, which a single job&apos;s line
            items can never tell you.
            {hasUncoded && (
              <>
                {" "}
                Right now all {rollup.totals.lineCount === 1
                  ? "1 line item"
                  : `${rollup.totals.lineCount} line items`}{" "}
                you have — {money(rollup.totals.budgetedCost)} of budgeted cost — are uncoded, so
                none of it can be grouped.
              </>
            )}
          </p>
          <Link
            href="/settings#phase-codes"
            data-tour="phase-codes-set-up"
            className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
          >
            Set up your first phase code
          </Link>
        </div>
      ) : (
        <>
          {/* The coverage line, above the numbers rather than under them,
              in the same shape lib/wip.ts's costCoverage is reported on
              the job page: a figure drawn from part of the money is not
              the same claim as a figure drawn from all of it, and the
              reader has to know which one they are looking at BEFORE they
              read it. */}
          <div
            data-tour="phase-codes-coverage"
            className={`mb-6 rounded-lg border p-4 ${
              rollup.budgetCoverage < 1
                ? "border-amber-700 bg-tag-amber/20"
                : "border-line-card bg-surface"
            }`}
          >
            <p className="text-sm text-ink">
              <span className="font-semibold">
                {formatCoveragePercent(rollup.budgetCoverage)} of your budgeted cost
              </span>{" "}
              is coded to a phase
              {rollup.totals.actualCost > 0 && (
                <>
                  , and {formatCoveragePercent(rollup.actualCoverage)} of what you have actually
                  spent
                </>
              )}
              .
            </p>
            {rollup.budgetCoverage < 1 || rollup.actualCoverage < 1 ? (
              <p className="mt-1 text-sm text-ink-body">
                The rest is in the <span className="text-tag-amber-ink">Not coded to a phase</span>{" "}
                row at the bottom of the table. It is not missing and it is not spread across the
                phases above — nothing here guesses which phase an uncoded line belongs to, because
                a wrong guess would file somebody&apos;s money under a code they never chose.
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-body">
                Every line item on every job carries a phase code, so the totals below are the whole
                picture.
              </p>
            )}
            {/* Coding is one question; whether the actual column is complete
                is another, and coverage above cannot answer it. */}
            {rollup.totals.unpricedLaborHours > 0 && (
              <p className="mt-1 text-sm text-tag-amber-ink">
                {rollup.totals.unpricedLaborHours} logged{" "}
                {rollup.totals.unpricedLaborHours === 1 ? "hour has" : "hours have"} no wage rate
                behind {rollup.totals.unpricedLaborHours === 1 ? "it" : "them"}, so every actual
                and variance below is lower than what the work really cost. Add a fringe rate
                schedule covering the craft and dates those hours were worked.
              </p>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-line-card bg-surface" data-tour="phase-codes-table">
            <table className="w-full min-w-[42rem] border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-body">
                  <th className={cell}>Code</th>
                  <th className={cell}>Phase</th>
                  <th className={`${cell} text-right`}>Appears on</th>
                  <th className={`${cell} text-right`}>Budgeted</th>
                  <th className={`${cell} text-right`}>Actual to date</th>
                  <th className={`${cell} text-right`}>Variance</th>
                </tr>
              </thead>
              <tbody>
                {rollup.rows.map((row) => (
                  <Row key={row.phase?.id} row={row} />
                ))}
                {/* ALWAYS rendered, including at zero. A row that vanishes
                    when it is empty is a row nobody can trust when it is
                    not, because its absence and its non-existence look the
                    same on screen. */}
                <Row row={rollup.uncoded} uncoded />
                <tr className="border-t-2 border-line-card font-semibold">
                  <td className={`${cell} text-ink`}>Total</td>
                  <td className={`${cell} text-ink-body`}>
                    {rollup.totals.lineCount === 1
                      ? "1 line item"
                      : `${rollup.totals.lineCount} line items`}
                    , coded and not
                  </td>
                  <td className={`${numeric} text-ink-body`}>{jobsLabel(rollup.totals.jobCount)}</td>
                  <td className={`${numeric} text-ink`}>{money(rollup.totals.budgetedCost)}</td>
                  <td className={`${numeric} text-ink`}>{money(rollup.totals.actualCost)}</td>
                  <td className={`${numeric} ${varianceClass(rollup.totals.variance)}`}>
                    {varianceLabel(rollup.totals.variance)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-4 max-w-3xl text-xs text-ink-muted">
            Budgeted is quantity × the budgeted unit cost captured when the line was priced; actual
            is every cost entry booked against the line. Lines removed by a change order are in
            neither. Nothing on this page is stored — it is totalled from the line items each time
            you open it, so it cannot drift from them.
          </p>
        </>
      )}
    </div>
  );
}

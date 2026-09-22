import { money } from "@/lib/money";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";
import {
  lineItemCostToDate,
  NO_EMPLOYER_BURDEN,
  unassignedLaborCost,
  type CostEntryCostRow,
  type TimeEntryCostRow,
} from "@/lib/labor-job-cost";
import { jobEarnedRevenue, jobOverUnderBilling } from "@/lib/company-financials";
import {
  calculateJobWip,
  calculateLineItemWip,
  formatCoveragePercent,
  formatLoggedHours,
  formatPercentComplete,
} from "@/lib/wip";
import { DEMO_JOB, PanelFrame, Tile, utcDay } from "./panelChrome";

/**
 * Job costing on one job, as the "Job costing & WIP" section of
 * `app/(app)/jobs/[id]/(tabs)/estimate/page.tsx` renders it: the six job
 * tiles ("Contract value", "Actual cost to date", "% complete", "Earned
 * revenue", "Billed to date", "Over / under billed"), the amber caveats the
 * page prints under them, then one row per line item with that page's six
 * figures — Contract, Budget, Current est., Actual, % complete, Earned — and
 * its trade tag.
 *
 * COMPUTED THE WAY THE PAGE COMPUTES IT, helper for helper. Each line's cost
 * to date is `lineItemCostToDate` (lib/labor-job-cost.ts): its manual cost
 * entries PLUS the burdened labor on the time entries that name it, priced
 * from the craft's fringe rate schedule — the fix for issue #287, where job
 * cost was materials alone for months while every screen looked complete.
 * Hours logged to no line go through `unassignedLaborCost` into the job's
 * total and no line's. `calculateLineItemWip` / `calculateJobWip`
 * (lib/wip.ts) then do the cost-to-cost percentage of completion a surety
 * expects: % complete = actual ÷ estimated cost at completion, earned =
 * % × contract value, over/under = billed − earned. The inputs are the
 * fields a JobLineItem, a CostEntry and a TimeEntry actually carry. The
 * job-cost census (lib/jobCostCensus.test.ts) holds this file to the same
 * composition as every other caller, on purpose.
 *
 * WHAT THE PRODUCT DOES NOT DO, and this panel therefore does not draw: a
 * per-line "estimated hours vs actual hours" comparison. `JobLineItem.laborHours`
 * is a bid-time estimate that the estimate form prices to dollars
 * (`estimateBurdenedLaborCost`, "≈ $X labor"), and logged hours reach a line
 * as burdened DOLLARS inside "Actual". No screen puts the two hour figures
 * side by side, so neither does this. Hours appear where the app shows them:
 * the caveat naming how many logged hours carry no wage rate and sit in the
 * figure at $0 — the product refusing to quote a number it cannot stand
 * behind, which is drawn on purpose.
 *
 * The job is the same one the pay application beside this is billed on:
 * "Billed to date" is that application's cumulative total.
 */

const EFFECTIVE_FROM = utcDay("2026-06-01");
/** The day the illustrative hours are dated — inside every schedule. */
const WORKED_ON = utcDay("2026-08-14");

function schedule(baseWage: number, pension: number, vacation: number, hw: number, training: number): FringeRateScheduleInput[] {
  return [
    {
      baseWage,
      pensionRate: pension,
      vacationRate: vacation,
      healthWelfareRate: hw,
      trainingRate: training,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
    },
  ];
}

/** The same three crafts and rates as the WH-347 panel, so a dollar here and
 * a dollar there come from one schedule. */
const SCHEDULES_BY_CRAFT: ReadonlyMap<string, FringeRateScheduleInput[]> = new Map([
  ["jm", schedule(46.1, 9.85, 3.9, 11.2, 0.8)],
  ["fm", schedule(49.1, 9.85, 3.9, 11.2, 0.8)],
  ["ap3", schedule(27.66, 5.91, 2.34, 11.2, 0.8)],
]);

/** [craft id — null for hours logged with no craft tag, which no schedule
 * can price; hours] */
type Hours = [string | null, number];

type LineSpec = {
  id: string;
  description: string;
  /** TRADE_SCOPE_OPTIONS label, as the row's tag. */
  trade: string;
  quantity: number;
  unitPrice: number;
  budgetedUnitCost: number;
  currentEstimatedUnitCost: number;
  /** Manual "log a cost" entries — materials, a rental, a sub invoice. */
  costEntries: CostEntryCostRow[];
  /** Hours the crew booked to this line. */
  hours: Hours[];
};

/** Quantity × unit price is the scheduled value on the pay application. The
 * budgeted unit cost is the frozen baseline; the current estimate is the
 * PM's re-forecast. */
const LINES: LineSpec[] = [
  {
    id: "framing-l2",
    description: "Metal stud framing — Level 2",
    trade: "Metal framing / drywall",
    quantity: 18_400,
    unitPrice: 10,
    budgetedUnitCost: 7.12,
    currentEstimatedUnitCost: 7.42,
    costEntries: [{ amount: 31_400 }, { amount: 3_400 }],
    hours: [
      ["jm", 920],
      ["ap3", 300],
      ["fm", 40],
      [null, 24],
    ],
  },
  {
    id: "drywall-l2",
    description: "Drywall hang & finish — Level 2",
    trade: "Metal framing / drywall",
    quantity: 21_250,
    unitPrice: 10,
    budgetedUnitCost: 7.15,
    currentEstimatedUnitCost: 7.45,
    costEntries: [{ amount: 27_600 }, { amount: 2_600 }],
    hours: [
      ["jm", 780],
      ["ap3", 320],
      ["fm", 40],
      [null, 12],
    ],
  },
  {
    id: "ceilings-l2",
    description: "Acoustical ceilings — Level 2",
    trade: "Acoustical ceilings",
    quantity: 9_640,
    unitPrice: 10,
    budgetedUnitCost: 7.4,
    currentEstimatedUnitCost: 7.4,
    costEntries: [{ amount: 5_400 }],
    hours: [
      ["jm", 120],
      ["ap3", 40],
    ],
  },
  {
    id: "shaftwall",
    description: "Fire-rated shaftwall assemblies",
    trade: "Metal framing / drywall",
    quantity: 1_060,
    unitPrice: 70,
    budgetedUnitCost: 49.6,
    currentEstimatedUnitCost: 49.6,
    costEntries: [{ amount: 9_100 }],
    hours: [
      ["jm", 220],
      ["ap3", 60],
    ],
  },
];

/** Hours logged against "No specific line" — the log form's default, so
 * routinely not zero. A foreman's week walking the whole floor. */
const UNASSIGNED_HOURS: Hours[] = [["fm", 120]];

/** SUM(Invoice.amount) on the job — four applications so far, the fourth
 * being the one PayApplicationPanel draws. */
const BILLED_TO_DATE = 369_705;

function timeEntry(lineItemId: string | null, [craftClassificationId, hours]: Hours): TimeEntryCostRow {
  return {
    lineItemId,
    craftClassificationId,
    date: WORKED_ON,
    hours,
    payType: "STRAIGHT",
    perDiemAmount: null,
    travelPayAmount: null,
  };
}

function buildWip() {
  // The job's WHOLE time-entry list, as the page fetches it — lines filter
  // their own rows out of it, and the unattached rows go to the job.
  const jobTimeEntries: TimeEntryCostRow[] = [
    ...LINES.flatMap((line) => line.hours.map((h) => timeEntry(line.id, h))),
    ...UNASSIGNED_HOURS.map((h) => timeEntry(null, h)),
  ];

  const lines = LINES.map((line) => ({
    ...line,
    wip: calculateLineItemWip({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      budgetedUnitCost: line.budgetedUnitCost,
      currentEstimatedUnitCost: line.currentEstimatedUnitCost,
      estimatedCostToComplete: null,
      ...lineItemCostToDate(
        line.id,
        line.costEntries,
        jobTimeEntries,
        SCHEDULES_BY_CRAFT,
        // No company behind this panel, so no recorded employer burden — the
        // same default every real company starts on, and the reason the
        // caption above says "wage and fringes".
        NO_EMPLOYER_BURDEN,
      ),
    }),
  }));

  const job = calculateJobWip(
    lines.map((line) => line.wip),
    BILLED_TO_DATE,
    unassignedLaborCost(jobTimeEntries, SCHEDULES_BY_CRAFT, NO_EMPLOYER_BURDEN),
  );
  return { lines, job };
}

function dash(value: string | null): string {
  return value ?? "—";
}

export function JobCostPanel({ className }: { className?: string }) {
  const { lines, job } = buildWip();
  const loggedHours = job.pricedLaborHours + job.unpricedLaborHours;
  const billingPosition = jobOverUnderBilling(job);
  const earnedRevenue = jobEarnedRevenue(job);

  return (
    <PanelFrame
      title="Job costing & WIP"
      meta={`${DEMO_JOB.name} · Estimate tab`}
      /* "burdened rate" until 2026-09-22, and it was the screen lying about
         the arithmetic rather than the arithmetic being wrong. To a
         contractor "burdened" means fully loaded — employer FICA, FUTA/SUTA
         and workers' comp included — and none of those were in the figure.
         This panel is illustrative and has no company behind it, so it
         records no EmployerBurdenRate and says what it computes. The real
         screen says the same sentence when no rate is recorded and names the
         percentage once one is (lib/employer-burden.ts, laborCostBasisLabel). */
      caption="Cost-to-cost percentage of completion per line item, with logged hours costed at the craft's wage and fringe rates."
      className={className}
    >
      {/* The job tiles: grid-cols-2 sm:grid-cols-4 on the page; here two
          columns, three once the panel is wide enough. The two amber notes
          are the page's own caveats, in its own words. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 [@container(min-width:30rem)]:grid-cols-3">
        <Tile label="Contract value" value={money(job.contractValue)} />
        <Tile
          label="Actual cost to date"
          value={money(job.actualCostToDate)}
          note={
            job.unpricedLaborHours > 0
              ? `${formatLoggedHours(job.unpricedLaborHours)} of ${formatLoggedHours(loggedHours)} logged hours have no craft tag or no effective fringe rate schedule, so they are in this figure at $0 of wages (${formatCoveragePercent(job.laborHourCoverage)} of hours priced).`
              : undefined
          }
        />
        <Tile
          label="% complete"
          value={dash(formatPercentComplete(job.percentComplete))}
          note={
            job.percentComplete != null && (job.estimatedCoverage < 1 || job.costCoverage < 1)
              ? `Over the ${formatCoveragePercent(job.estimatedCoverage)} of contract value that carries a cost forecast${
                  job.costCoverage < 1 ? `, and ${formatCoveragePercent(job.costCoverage)} of cost to date` : ""
                }.`
              : undefined
          }
        />
        <Tile label="Earned revenue" value={earnedRevenue != null ? money(earnedRevenue) : "—"} />
        <Tile label="Billed to date" value={money(job.billedToDate)} />
        {billingPosition === null ? (
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">Over / under billed</p>
            <p className="text-sm text-ink-body">
              Only {formatCoveragePercent(job.earnedCoverage)} of this job&apos;s value has an earned-revenue figure,
              so a billing position would be guesswork. Budget the rest to see where it lands.
            </p>
          </div>
        ) : (
          <Tile
            label="Over / under billed"
            value={
              billingPosition > 0
                ? `Overbilled ${money(billingPosition)}`
                : billingPosition < 0
                  ? `Underbilled ${money(Math.abs(billingPosition))}`
                  : "Even"
            }
            tone={billingPosition > 0 ? "warn" : "good"}
          />
        )}
      </div>

      {/* One row per line item, in the page's own words. A description list
          rather than bare spans so each figure keeps its label for a screen
          reader; visually it is the page's flex-wrap row. */}
      <ul className="mt-4 flex flex-col gap-3 border-t border-line-row pt-3">
        {lines.map(({ id, description, trade, wip }) => (
          <li key={id} className="rounded-lg border border-line-card bg-canvas p-3">
            <p className="text-sm font-medium text-ink">
              {description}
              <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-normal text-ink-body">{trade}</span>
            </p>
            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-ink-body">
              <div>
                <dt className="inline">Contract </dt>
                <dd className="inline">{money(wip.contractValue)}</dd>
              </div>
              <div>
                <dt className="inline">Budget </dt>
                <dd className="inline">{wip.budgetedCost != null ? money(wip.budgetedCost) : "—"}</dd>
              </div>
              <div>
                <dt className="inline">Current est. </dt>
                <dd className="inline">{wip.currentEstimatedCost != null ? money(wip.currentEstimatedCost) : "—"}</dd>
              </div>
              <div>
                <dt className="inline">Actual </dt>
                <dd className="inline text-ink">{money(wip.actualCostToDate)}</dd>
              </div>
              <div>
                <dt className="inline">% complete </dt>
                <dd className="inline text-ink">{dash(formatPercentComplete(wip.percentComplete))}</dd>
              </div>
              <div>
                <dt className="inline">Earned </dt>
                <dd className="inline">{wip.earnedRevenue != null ? money(wip.earnedRevenue) : "—"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}

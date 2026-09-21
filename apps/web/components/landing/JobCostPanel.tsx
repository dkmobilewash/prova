import { money } from "@/lib/money";
import {
  calculateJobWip,
  calculateLineItemWip,
  formatCoveragePercent,
  formatLoggedHours,
  formatPercentComplete,
  type WipLaborCost,
  type WipLineItemInput,
} from "@/lib/wip";
import { DEMO_JOB, PanelFrame, Tile } from "./panelChrome";

/**
 * Job costing on one job, as the "Job costing & WIP" section of
 * `app/(app)/jobs/[id]/(tabs)/estimate/page.tsx` renders it: the six job
 * tiles ("Contract value", "Actual cost to date", "% complete", "Earned
 * revenue", "Billed to date", "Over / under billed"), the amber caveat under
 * actual cost when logged hours could not be priced, then one row per line
 * item with that page's six figures — Contract, Budget, Current est., Actual,
 * % complete, Earned — and its trade tag.
 *
 * COMPUTED BY `calculateLineItemWip` AND `calculateJobWip` from lib/wip.ts,
 * the cost-to-cost percentage-of-completion arithmetic a surety expects on a
 * WIP schedule: % complete = actual cost ÷ estimated cost at completion,
 * earned = % × contract value, over/under = billed − earned. The inputs are
 * the fields a JobLineItem actually carries (quantity, unitPrice,
 * budgetedUnitCost, currentEstimatedUnitCost) plus what has been booked
 * against the line, which since #287 is manual cost entries PLUS the burdened
 * labor on the hours logged to it.
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

type Line = {
  description: string;
  /** TRADE_SCOPE_OPTIONS label, as the row's tag. */
  trade: string;
  input: WipLineItemInput;
};

function labor(wageCost: number, pricedHours: number, unpricedHours: number): WipLaborCost {
  return { wageCost, allowanceCost: 0, total: wageCost, pricedHours, unpricedHours };
}

/** Quantity × unit price is the scheduled value on the pay application. The
 * budgeted unit cost is the frozen baseline; the current estimate is the
 * PM's re-forecast. `actualCostToDate` is cost entries plus burdened labor;
 * `labor` is the labor half, so the caveat can name unpriced hours. */
const LINES: Line[] = [
  {
    description: "Metal stud framing — Level 2",
    trade: "Metal framing / drywall",
    input: {
      quantity: 18_400,
      unitPrice: 10,
      budgetedUnitCost: 7.12,
      currentEstimatedUnitCost: 7.42,
      estimatedCostToComplete: null,
      actualCostToDate: 118_300,
      labor: labor(84_900, 1_240, 24),
    },
  },
  {
    description: "Drywall hang & finish — Level 2",
    trade: "Metal framing / drywall",
    input: {
      quantity: 21_250,
      unitPrice: 10,
      budgetedUnitCost: 7.15,
      currentEstimatedUnitCost: 7.45,
      estimatedCostToComplete: null,
      actualCostToDate: 104_600,
      labor: labor(76_200, 1_180, 12),
    },
  },
  {
    description: "Acoustical ceilings — Level 2",
    trade: "Acoustical ceilings",
    input: {
      quantity: 9_640,
      unitPrice: 10,
      budgetedUnitCost: 7.4,
      currentEstimatedUnitCost: 7.4,
      estimatedCostToComplete: null,
      actualCostToDate: 15_900,
      labor: labor(9_800, 140, 0),
    },
  },
  {
    description: "Fire-rated shaftwall assemblies",
    trade: "Metal framing / drywall",
    input: {
      quantity: 1_060,
      unitPrice: 70,
      budgetedUnitCost: 49.6,
      currentEstimatedUnitCost: 49.6,
      estimatedCostToComplete: null,
      actualCostToDate: 27_800,
      labor: labor(19_300, 290, 0),
    },
  },
];

/** SUM(Invoice.amount) on the job — four applications so far, the fourth
 * being the one PayApplicationPanel draws. */
const BILLED_TO_DATE = 369_705;

function buildWip() {
  const lines = LINES.map((line) => ({ ...line, wip: calculateLineItemWip(line.input) }));
  const job = calculateJobWip(
    lines.map((line) => line.wip),
    BILLED_TO_DATE,
  );
  return { lines, job };
}

function dash(value: string | null): string {
  return value ?? "—";
}

export function JobCostPanel({ className }: { className?: string }) {
  const { lines, job } = buildWip();
  const loggedHours = job.pricedLaborHours + job.unpricedLaborHours;
  const position = job.overUnderBilling;

  return (
    <PanelFrame
      title="Job costing & WIP"
      meta={`${DEMO_JOB.name} · Estimate tab`}
      caption="Cost-to-cost percentage of completion per line item, with logged hours costed at the craft's burdened rate."
      className={className}
    >
      {/* The job tiles: grid-cols-2 sm:grid-cols-4 on the page; here two
          columns, three once the panel is wide enough. */}
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
        <Tile label="% complete" value={dash(formatPercentComplete(job.percentComplete))} />
        <Tile label="Earned revenue" value={money(job.earnedRevenue)} />
        <Tile label="Billed to date" value={money(job.billedToDate)} />
        <Tile
          label="Over / under billed"
          value={
            position > 0 ? `Overbilled ${money(position)}` : position < 0 ? `Underbilled ${money(Math.abs(position))}` : "Even"
          }
          tone={position > 0 ? "warn" : "good"}
        />
      </div>

      {/* One row per line item, in the page's own words. A description list
          rather than bare spans so each figure keeps its label for a screen
          reader; visually it is the page's flex-wrap row. */}
      <ul className="mt-4 flex flex-col gap-3 border-t border-line-row pt-3">
        {lines.map(({ description, trade, wip }) => (
          <li key={description} className="rounded-lg border border-line-card bg-canvas p-3">
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

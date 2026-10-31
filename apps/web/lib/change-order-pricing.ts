// How a change order's cost becomes its sell price — Diego's decision of
// 2026-10-30 (coordination/decisions/2026-10-30-change-order-markup-and-
// burden.md, option A), as code:
//
//   1. LABOR COST IS BURDENED BEFORE ANYTHING IS MARKED UP. An hour costs the
//      craft's base wage (times the pay type's multiplier) plus its fringes,
//      plus the company's employer-burden percent on the WAGE portion — the
//      same arithmetic lib/labor-job-cost.ts books an hour at, from the same
//      three helpers, at the burden in force on the WORK DATE.
//   2. EVERY LINE IS THEN RUN THROUGH THE BID RECAP. Not a copy of its math:
//      `bidRecap` itself, one line at a time, so a change order is priced
//      exactly as the bid was — per-category markup, escalation, tax on
//      material, overhead, profit, bond, contingency, in the recap's own
//      order. Summing per-line sells reproduces `bidRecap` over all the lines
//      to within a cent per step, which the test pins.
//   3. NEVER A DEFAULTED WAGE. A labor line whose craft has no fringe schedule
//      on the work date gets its hours and NO cost and NO price, and the
//      description says why. Equipment is a typed cost at the equipment
//      markup; there is no rate table and this does not invent one.
//
// Pure. The action loads rows and hands this plain values.

import { bidRecap, RECAP_RATE_KEYS, type RecapRates, type RecapStep } from "@/lib/bid-recap";
import type { CostCategory } from "@/lib/cost-category";
import { employerBurdenCents } from "@/lib/employer-burden";
import {
  calculateTimeEntryBaseWage,
  calculateTimeEntryLaborCost,
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
  type TimeEntryPayType,
} from "@/lib/labor-cost";
import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";
import { readTmTicketSnapshot } from "@/lib/tm-ticket-change-order";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The job's own recap, else the company defaults, else nothing — the rule
 * the estimate tab and Ask both apply, written once. */
export function recapRatesFrom(
  source: Partial<Record<keyof RecapRates, { toString(): string } | number | null>> | null | undefined,
): RecapRates {
  return Object.fromEntries(
    RECAP_RATE_KEYS.map((key) => [key, source?.[key] != null ? Number(source[key]) : null]),
  ) as RecapRates;
}

export interface CostLine {
  quantity: number;
  /** Direct cost per unit. Null means no cost is known, and no price follows. */
  unitCost: number | null;
  costCategory: CostCategory | null;
}

export interface PricedLine {
  /** Sell per unit, to the cent, or null when there was no cost to price. */
  unitPrice: number | null;
  /** Sell for the line (quantity × unitPrice as the column will hold it). */
  sellTotal: number | null;
  /** The recap's own steps for this one line: label, rate, amount. */
  steps: RecapStep[];
}

/** One line through the recap. `unitPrice` is the recap total divided back
 * to a two-decimal unit price, so what is stored foots to what the recap
 * said to within the rounding a Decimal(12,2) unit price forces. */
export function priceLine(line: CostLine, rates: RecapRates): PricedLine {
  if (line.unitCost == null || !(line.quantity > 0)) return { unitPrice: null, sellTotal: null, steps: [] };
  const recap = bidRecap(
    [{ id: "line", quantity: line.quantity, unitCost: line.unitCost, unitPrice: null, costCategory: line.costCategory }],
    rates,
  );
  const unitPrice = round2(recap.bidTotal / line.quantity);
  return { unitPrice, sellTotal: round2(unitPrice * line.quantity), steps: recap.steps };
}

export interface LaborHourCost {
  /** Burdened cost of one hour: wage × pay-type multiplier + fringes + burden on the wage. */
  unitCost: number;
  baseRatePerHour: number;
  fringePerHour: number;
  burdenPercent: number;
  burdenPerHour: number;
}

/** What one hour of this craft costs on this day, or null when no schedule
 * covers the day — which is the "never default a wage" case. */
export function laborHourCost(
  payType: TimeEntryPayType,
  schedules: readonly FringeRateScheduleInput[],
  workDate: Date,
  burdenPercent: number | null,
): LaborHourCost | null {
  const schedule = findEffectiveFringeRateSchedule([...schedules], workDate);
  if (!schedule) return null;
  const one = { hours: 1, payType, date: workDate };
  const wageAndFringe = calculateTimeEntryLaborCost(one, schedule);
  const base = calculateTimeEntryBaseWage(one, schedule);
  if (wageAndFringe == null || base == null) return null;
  const percent = burdenPercent ?? 0;
  const burdenPerHour = employerBurdenCents(base, percent) / 100;
  return {
    unitCost: round2(wageAndFringe + burdenPerHour),
    baseRatePerHour: round2(base),
    fringePerHour: round2(wageAndFringe - base),
    burdenPercent: percent,
    burdenPerHour,
  };
}

/** The snapshot's pay type as the labor-cost helpers spell it. The phone
 * writes TimeEntry.payType values; an older or unknown token prices as
 * straight time, and the description carries the raw word so nothing is
 * hidden. */
export function asPayType(raw: string | null | undefined): TimeEntryPayType {
  return raw === "OVERTIME" || raw === "DOUBLE_TIME" || raw === "SHIFT_DIFFERENTIAL" ? raw : "STRAIGHT";
}

/** The basis, in words, for a labor line's hourly cost — goes in the
 * proposal's description so the backup survives into the line item and the
 * document without a column for it. */
export function laborBasisText(cost: LaborHourCost): string {
  const burden =
    cost.burdenPercent > 0 ? ` + ${cost.burdenPercent}% burden on the wage ${money(cost.burdenPerHour)}` : "";
  return `${money(cost.baseRatePerHour)}/h wage + fringes ${money(cost.fringePerHour)}/h${burden} = ${money(cost.unitCost)}/h`;
}

export interface TmTicketPricingLookups {
  /** Fringe schedules by craft classification NAME within the company — the
   * snapshot froze the craft's name, not its id. */
  schedulesByCraftName: ReadonlyMap<string, readonly FringeRateScheduleInput[]>;
  burdenPercent: number | null;
  rates: RecapRates;
  workDate: Date;
}

export interface ProposedAddLine {
  description: string;
  unit: string | null;
  quantity: number;
  costCategory: CostCategory;
  budgetedUnitCost: number | null;
  unitPrice: number | null;
}

/**
 * The ADD proposals a signed T&M ticket turns into. One per labor row and one
 * per material row, from the FROZEN snapshot. Labor is priced when its craft
 * has a schedule on the work date; otherwise the row keeps its hours, no
 * cost, no price, and says so. Materials never carry a cost — a
 * MaterialOrder deliberately has no price — so they land unpriced for the
 * person to cost.
 */
export function tmTicketProposals(snapshot: unknown, lookups: TmTicketPricingLookups): ProposedAddLine[] {
  const snap = readTmTicketSnapshot(snapshot);
  const out: ProposedAddLine[] = [];
  for (const row of snap.labor) {
    const hours = Number(row.hours);
    const quantity = Number.isFinite(hours) && hours > 0 ? hours : 0;
    const payType = asPayType(row.payType);
    const schedules = row.craftLabel ? (lookups.schedulesByCraftName.get(row.craftLabel) ?? []) : [];
    const cost = laborHourCost(payType, schedules, lookups.workDate, lookups.burdenPercent);
    const who = [row.workerName, row.craftLabel, payType.toLowerCase().replace("_", " ")].filter(Boolean).join(", ");
    const head = `Labor — ${who}, ${formatHours(quantity)} h`;
    if (!cost) {
      out.push({
        description: `${head} — UNPRICED: no wage on file for ${row.craftLabel ?? "this craft"} on the work date; enter the rate`,
        unit: "hr",
        quantity: quantity || 1,
        costCategory: "LABOR",
        budgetedUnitCost: null,
        unitPrice: null,
      });
      continue;
    }
    const priced = priceLine({ quantity, unitCost: cost.unitCost, costCategory: "LABOR" }, lookups.rates);
    out.push({
      description: `${head} (${laborBasisText(cost)})`,
      unit: "hr",
      quantity: quantity || 1,
      costCategory: "LABOR",
      budgetedUnitCost: cost.unitCost,
      unitPrice: priced.unitPrice,
    });
  }
  for (const row of snap.materials) {
    out.push({
      description: `Material — ${row.description}${row.vendorName ? ` (${row.vendorName})` : ""} — enter the cost`,
      unit: null,
      quantity: 1,
      costCategory: "MATERIAL",
      budgetedUnitCost: null,
      unitPrice: null,
    });
  }
  return out;
}

/**
 * The backup a GC reads under a priced line: cost, each recap step with its
 * rate, and the sell. Empty when the line has no cost — there is nothing to
 * back up — so a sell-only or unpriced line prints no backup rather than a
 * misleading one.
 */
export function pricingBackupLines(line: CostLine, rates: RecapRates): string[] {
  const priced = priceLine(line, rates);
  if (priced.unitPrice == null || line.unitCost == null) return [];
  const lines = [`Cost ${money(line.unitCost)} × ${line.quantity} = ${money(round2(line.unitCost * line.quantity))}`];
  for (const step of priced.steps) {
    lines.push(`${step.label}${step.ratePercent != null ? ` ${step.ratePercent}%` : ""}: +${money(step.amount)}`);
  }
  lines.push(`Sell ${money(priced.unitPrice)} × ${line.quantity} = ${money(priced.sellTotal ?? 0)}`);
  return lines;
}

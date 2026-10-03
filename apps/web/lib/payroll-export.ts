import type { CertifiedPayrollEmployeeSummary } from "./certified-payroll";
import type { TimeEntryPayType } from "./labor-cost";

/**
 * HOURS OUT, so pay can actually be run.
 *
 * `PayrollRegisterImport` reads a finished register back IN from Gusto, ADP
 * RUN or Sage 100 — gross, deductions, net, after somebody else has run
 * payroll. Nothing went the other way, so the hours a payroll clerk needs
 * were only ever on a screen. This is that file.
 *
 * It is a FORMATTER, not a second source of truth: every figure comes from
 * `buildCertifiedPayrollSummary`, the same core the certified-payroll page
 * renders, so the export and the screen cannot disagree about what somebody
 * worked. Nothing here computes an hour or a rate.
 *
 * TWO THINGS THIS DELIBERATELY REFUSES TO DO.
 *
 * **It never writes 0 for a wage it does not know.** The summary leaves
 * `wageCost` null when an entry has no craft tag or no FringeRateSchedule
 * effective on its date — "never invents a wage" is that core's own first
 * rule. A blank cell in a spreadsheet reads as nothing; a `0` reads as
 * free labour, and it would be imported into a pay run as such. So the
 * cell stays EMPTY and a `Rate known` column says `no` beside it, which is
 * a fact a clerk can act on rather than a hole they have to notice.
 *
 * **It never repeats an employee-level total on a per-craft row.** Per diem
 * and travel pay are totals for the PERSON, not for the classification, and
 * a person who worked two crafts in a week has two rows. Printing their per
 * diem on both would double it — in a file that goes into a pay run. They
 * appear once, on that employee's first row, and the column says so.
 */

/** The pay types, in the order a payroll form asks for them. */
const PAY_TYPES: TimeEntryPayType[] = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

export type PayrollExportRow = {
  employee: string;
  craft: string;
  periodStart: string;
  periodEnd: string;
  straightHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  shiftDifferentialHours: number;
  totalHours: number;
  /** Null when the summary could not compute it. NEVER 0 as a stand-in. */
  wageCost: number | null;
  rateKnown: "yes" | "no";
  /** Employee-level, emitted on that employee's first row only. */
  perDiem: number | null;
  travelPay: number | null;
};

export const PAYROLL_EXPORT_COLUMNS: { key: keyof PayrollExportRow; label: string }[] = [
  { key: "employee", label: "Employee" },
  { key: "craft", label: "Classification" },
  { key: "periodStart", label: "Period start" },
  { key: "periodEnd", label: "Period end" },
  { key: "straightHours", label: "Straight hours" },
  { key: "overtimeHours", label: "Overtime hours" },
  { key: "doubleTimeHours", label: "Double-time hours" },
  { key: "shiftDifferentialHours", label: "Shift differential hours" },
  { key: "totalHours", label: "Total hours" },
  { key: "wageCost", label: "Wage cost" },
  // Named so a blank in the column before it is readable rather than
  // ambiguous: "no" says the rate is missing, not that the work was free.
  { key: "rateKnown", label: "Rate known" },
  { key: "perDiem", label: "Per diem (employee total)" },
  { key: "travelPay", label: "Travel pay (employee total)" },
];

export function buildPayrollExportRows(
  summaries: CertifiedPayrollEmployeeSummary[],
  period: { start: string; end: string },
): PayrollExportRow[] {
  const out: PayrollExportRow[] = [];

  for (const employee of summaries) {
    employee.rows.forEach((row, index) => {
      // Employee-level money rides on the first classification row only.
      // See the header: repeating it per craft would double it in a pay run.
      const first = index === 0;
      const hours = (type: TimeEntryPayType) => row.hoursByPayType[type] ?? 0;
      out.push({
        employee: employee.employeeName,
        craft: row.craftLabel,
        periodStart: period.start,
        periodEnd: period.end,
        straightHours: hours("STRAIGHT"),
        overtimeHours: hours("OVERTIME"),
        doubleTimeHours: hours("DOUBLE_TIME"),
        shiftDifferentialHours: hours("SHIFT_DIFFERENTIAL"),
        totalHours: row.totalHours,
        wageCost: row.wageCost,
        rateKnown: row.wageCost == null ? "no" : "yes",
        perDiem: first ? employee.perDiemTotal : null,
        travelPay: first ? employee.travelPayTotal : null,
      });
    });
  }

  return out;
}

/** Every pay type the export has a column for — exported so a test can
 * hold the columns and the union together rather than trusting both. */
export const PAYROLL_EXPORT_PAY_TYPES = PAY_TYPES;

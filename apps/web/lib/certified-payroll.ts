// Assembles logged TimeEntry rows into a certified-payroll-style summary:
// one row per employee per craft classification for a given week, with
// hours broken out by pay type and a computed wage cost. This mirrors the
// substance of a federal WH-347 (or state equivalent) -- who worked what
// classification, how many hours, at what pay type -- without replicating
// its exact government-form layout, which is a distinct, larger effort.
//
// Never invents a wage: an entry with no craft tag, or no FringeRateSchedule
// effective on its date, contributes hours but leaves wageCost uncomputed
// (hasUncomputedHours flags this rather than silently showing $0).

import {
  calculateTimeEntryLaborCost,
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
  type TimeEntryPayType,
} from "./labor-cost";

export interface CertifiedPayrollTimeEntryInput {
  employeeUserId: string;
  employeeName: string;
  craftClassificationId: string | null;
  craftLabel: string | null;
  date: Date;
  hours: number;
  payType: TimeEntryPayType;
  perDiemAmount: number | null;
  travelPayAmount: number | null;
}

export interface CertifiedPayrollRow {
  craftLabel: string;
  hoursByPayType: Record<TimeEntryPayType, number>;
  totalHours: number;
  wageCost: number | null;
  hasUncomputedHours: boolean;
}

export interface CertifiedPayrollEmployeeSummary {
  employeeUserId: string;
  employeeName: string;
  rows: CertifiedPayrollRow[];
  totalHours: number;
  totalWageCost: number | null;
  hasUncomputedHours: boolean;
  perDiemTotal: number;
  travelPayTotal: number;
}

export function buildCertifiedPayrollSummary(
  entries: CertifiedPayrollTimeEntryInput[],
  fringeSchedulesByCraft: Map<string, FringeRateScheduleInput[]>,
): CertifiedPayrollEmployeeSummary[] {
  const rows = new Map<string, CertifiedPayrollRow & { employeeUserId: string }>();
  const employees = new Map<string, CertifiedPayrollEmployeeSummary>();

  for (const entry of entries) {
    const craftKey = entry.craftClassificationId ?? "none";
    const rowKey = `${entry.employeeUserId}::${craftKey}`;
    const schedules = entry.craftClassificationId ? (fringeSchedulesByCraft.get(entry.craftClassificationId) ?? []) : [];
    const schedule = findEffectiveFringeRateSchedule(schedules, entry.date);
    const cost = calculateTimeEntryLaborCost({ hours: entry.hours, payType: entry.payType, date: entry.date }, schedule);

    let row = rows.get(rowKey);
    if (!row) {
      row = {
        employeeUserId: entry.employeeUserId,
        craftLabel: entry.craftLabel ?? "No craft tag",
        hoursByPayType: { STRAIGHT: 0, OVERTIME: 0, DOUBLE_TIME: 0, SHIFT_DIFFERENTIAL: 0 },
        totalHours: 0,
        wageCost: null,
        hasUncomputedHours: false,
      };
      rows.set(rowKey, row);
    }
    row.hoursByPayType[entry.payType] += entry.hours;
    row.totalHours += entry.hours;
    if (cost != null) {
      row.wageCost = (row.wageCost ?? 0) + cost;
    } else {
      row.hasUncomputedHours = true;
    }

    let employee = employees.get(entry.employeeUserId);
    if (!employee) {
      employee = {
        employeeUserId: entry.employeeUserId,
        employeeName: entry.employeeName,
        rows: [],
        totalHours: 0,
        totalWageCost: null,
        hasUncomputedHours: false,
        perDiemTotal: 0,
        travelPayTotal: 0,
      };
      employees.set(entry.employeeUserId, employee);
    }
    employee.totalHours += entry.hours;
    if (cost != null) {
      employee.totalWageCost = (employee.totalWageCost ?? 0) + cost;
    } else {
      employee.hasUncomputedHours = true;
    }
    employee.perDiemTotal += entry.perDiemAmount ?? 0;
    employee.travelPayTotal += entry.travelPayAmount ?? 0;
  }

  for (const employee of employees.values()) {
    employee.rows = [...rows.values()]
      .filter((r) => r.employeeUserId === employee.employeeUserId)
      .map((r) => ({
        craftLabel: r.craftLabel,
        hoursByPayType: r.hoursByPayType,
        totalHours: r.totalHours,
        wageCost: r.wageCost,
        hasUncomputedHours: r.hasUncomputedHours,
      }));
  }

  return [...employees.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

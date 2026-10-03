import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CertifiedPayrollEmployeeSummary } from "./certified-payroll";
import {
  buildPayrollExportRows,
  PAYROLL_EXPORT_COLUMNS,
  PAYROLL_EXPORT_PAY_TYPES,
} from "./payroll-export";

/**
 * THIS FILE GOES INTO A PAY RUN, so the two assertions that matter are both
 * about money this must NOT invent.
 */

const PERIOD = { start: "2026-09-28", end: "2026-10-04" };

function employee(over: Partial<CertifiedPayrollEmployeeSummary> = {}): CertifiedPayrollEmployeeSummary {
  return {
    employeeUserId: "u1",
    employeeName: "Mike Alvarez",
    rows: [
      {
        craftLabel: "Drywall finisher",
        hoursByPayType: { STRAIGHT: 32, OVERTIME: 6, DOUBLE_TIME: 0, SHIFT_DIFFERENTIAL: 0 },
        totalHours: 38,
        wageCost: 1710,
        hasUncomputedHours: false,
      },
    ],
    totalHours: 38,
    totalWageCost: 1710,
    hasUncomputedHours: false,
    perDiemTotal: 150,
    travelPayTotal: 40,
    ...over,
  };
}

describe("a wage it does not know is never exported as zero", () => {
  it("leaves the cell empty and says the rate is unknown", () => {
    const rows = buildPayrollExportRows(
      [
        employee({
          rows: [
            {
              craftLabel: "Untagged",
              hoursByPayType: { STRAIGHT: 40, OVERTIME: 0, DOUBLE_TIME: 0, SHIFT_DIFFERENTIAL: 0 },
              totalHours: 40,
              // The summary could not price these — no craft tag, or no
              // fringe schedule effective that week.
              wageCost: null,
              hasUncomputedHours: true,
            },
          ],
        }),
      ],
      PERIOD,
    );

    expect(rows).toHaveLength(1);
    // THE REGRESSION, NAMED: a 0 here is forty hours of free labour in a
    // spreadsheet somebody imports into a pay run.
    expect(
      rows[0].wageCost,
      "an unpriced week exported as a number — 0 reads as free labour, not as unknown",
    ).toBeNull();
    expect(rows[0].wageCost).not.toBe(0);
    expect(rows[0].rateKnown).toBe("no");
    // The hours still ship: the person worked them whatever the rate is.
    expect(rows[0].totalHours).toBe(40);
  });

  it("says the rate IS known when it priced the row", () => {
    const rows = buildPayrollExportRows([employee()], PERIOD);
    expect(rows[0].wageCost).toBe(1710);
    expect(rows[0].rateKnown).toBe("yes");
  });
});

describe("employee-level money is not multiplied by their classifications", () => {
  it("emits per diem and travel once, however many crafts they worked", () => {
    const twoCrafts = employee({
      rows: [
        {
          craftLabel: "Drywall finisher",
          hoursByPayType: { STRAIGHT: 20, OVERTIME: 0, DOUBLE_TIME: 0, SHIFT_DIFFERENTIAL: 0 },
          totalHours: 20,
          wageCost: 900,
          hasUncomputedHours: false,
        },
        {
          craftLabel: "Taper",
          hoursByPayType: { STRAIGHT: 18, OVERTIME: 0, DOUBLE_TIME: 0, SHIFT_DIFFERENTIAL: 0 },
          totalHours: 18,
          wageCost: 810,
          hasUncomputedHours: false,
        },
      ],
      perDiemTotal: 150,
      travelPayTotal: 40,
    });
    const rows = buildPayrollExportRows([twoCrafts], PERIOD);

    expect(rows).toHaveLength(2);
    const perDiem = rows.reduce((a, r) => a + (r.perDiem ?? 0), 0);
    const travel = rows.reduce((a, r) => a + (r.travelPay ?? 0), 0);
    // THE REGRESSION, NAMED: per diem on every craft row pays it twice.
    expect(perDiem, "per diem was repeated per classification — that doubles it in a pay run").toBe(150);
    expect(travel, "travel pay was repeated per classification").toBe(40);
    expect(rows[1].perDiem).toBeNull();
    expect(rows[1].travelPay).toBeNull();
  });

  it("keeps each employee's own totals when several are exported", () => {
    const rows = buildPayrollExportRows(
      [
        employee(),
        employee({ employeeUserId: "u2", employeeName: "Dana Reyes", perDiemTotal: 75, travelPayTotal: 0 }),
      ],
      PERIOD,
    );
    expect(rows.map((r) => r.perDiem)).toEqual([150, 75]);
  });
});

describe("every pay type reaches a column", () => {
  it("carries all four through to their own columns", () => {
    const rows = buildPayrollExportRows(
      [
        employee({
          rows: [
            {
              craftLabel: "Drywall finisher",
              hoursByPayType: { STRAIGHT: 8, OVERTIME: 4, DOUBLE_TIME: 2, SHIFT_DIFFERENTIAL: 1 },
              totalHours: 15,
              wageCost: 700,
              hasUncomputedHours: false,
            },
          ],
        }),
      ],
      PERIOD,
    );
    expect(rows[0].straightHours).toBe(8);
    expect(rows[0].overtimeHours).toBe(4);
    expect(rows[0].doubleTimeHours).toBe(2);
    expect(rows[0].shiftDifferentialHours).toBe(1);
  });

  it("has a column for every pay type the app defines", () => {
    // SCOPE, against a source that cannot drift with this file: the union
    // in labor-cost.ts. A fifth pay type added there would otherwise have
    // its hours silently dropped from every payroll file — the hours would
    // simply not appear, and nothing would say so.
    const source = readFileSync(join(__dirname, "labor-cost.ts"), "utf8");
    const match = source.match(/export type TimeEntryPayType\s*=\s*([^;]+);/);
    expect(match, "could not find TimeEntryPayType — this check has gone blind").toBeTruthy();
    const declared = [...(match?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);

    expect(declared.length, "parsed no pay types at all — a vacuous check").toBeGreaterThanOrEqual(4);
    expect([...declared].sort()).toEqual([...PAYROLL_EXPORT_PAY_TYPES].sort());

    const columnKeys = PAYROLL_EXPORT_COLUMNS.map((c) => c.key);
    for (const type of declared) {
      // STRAIGHT -> straightHours, DOUBLE_TIME -> doubleTimeHours
      const camel = type
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      expect(columnKeys, `no column carries ${type} hours`).toContain(`${camel}Hours`);
    }
  });
});

describe("the column spec and the row shape agree", () => {
  it("names a column for every field a row carries, and no others", () => {
    const rows = buildPayrollExportRows([employee()], PERIOD);
    const rowKeys = Object.keys(rows[0]).sort();
    const columnKeys = PAYROLL_EXPORT_COLUMNS.map((c) => c.key).sort();
    // A field with no column is data that silently never ships; a column
    // with no field exports an empty stripe under a confident heading.
    expect(columnKeys).toEqual(rowKeys);
  });

  it("gives every column a human label", () => {
    for (const c of PAYROLL_EXPORT_COLUMNS) {
      expect(c.label.length, `${c.key} has no label`).toBeGreaterThan(2);
    }
  });
});

describe("an empty week", () => {
  it("exports no rows rather than a row of zeroes", () => {
    expect(buildPayrollExportRows([], PERIOD)).toEqual([]);
    // An employee with no classifications contributes nothing either.
    expect(buildPayrollExportRows([employee({ rows: [] })], PERIOD)).toEqual([]);
  });
});

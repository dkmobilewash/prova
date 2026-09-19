import { describe, expect, it } from "vitest";
import {
  crewNameKeys,
  parseMoneyCents,
  planPayrollRegisterImport,
  registerNameKey,
  type ExistingRegisterEntry,
  type RegisterCrew,
} from "./payroll-register-import";

/**
 * planPayrollRegisterImport — the pure planner behind the payroll-register
 * import, both on the browser (preview) and inside the confirm transaction
 * (lib/actions/payrollRegister.ts).
 *
 * Every guard here is stated as the wrong behaviour it exists to catch,
 * following wh347.test.ts's own convention, because these numbers land on
 * a federal filing.
 */

const CREW: RegisterCrew[] = [
  {
    id: "crew_maria",
    legalFirstName: "Maria",
    legalMiddleName: "Elena",
    legalLastName: "Lopez",
    employeeNumber: "E-100",
    identifyingNumberLast4: null,
  },
  {
    id: "crew_zeke",
    legalFirstName: "Zeke",
    legalMiddleName: null,
    legalLastName: "Warren",
    employeeNumber: null,
    identifyingNumberLast4: "9876",
  },
];

function row(...cells: string[]): string {
  return cells.join(",");
}

describe("parseMoneyCents", () => {
  it("reads plain dollars and cents as integer cents, never a float", () => {
    expect(parseMoneyCents("1234.56")).toEqual({ ok: true, cents: 123456 });
    expect(parseMoneyCents("$1,234.56")).toEqual({ ok: true, cents: 123456 });
    expect(parseMoneyCents("1234")).toEqual({ ok: true, cents: 123400 });
    expect(parseMoneyCents("1234.5")).toEqual({ ok: true, cents: 123450 });
  });

  it("reads accounting-style negatives in parens", () => {
    expect(parseMoneyCents("(123.45)")).toEqual({ ok: true, cents: -12345 });
    expect(parseMoneyCents("-123.45")).toEqual({ ok: true, cents: -12345 });
  });

  it("treats a blank cell as present-but-absent, not zero", () => {
    expect(parseMoneyCents("")).toEqual({ ok: true, cents: null });
    expect(parseMoneyCents(undefined)).toEqual({ ok: true, cents: null });
  });

  it("refuses a third decimal place rather than truncate a mill", () => {
    const result = parseMoneyCents("12.345");
    expect(result.ok).toBe(false);
  });

  it("refuses text that is not a number", () => {
    expect(parseMoneyCents("N/A").ok).toBe(false);
    expect(parseMoneyCents("forty dollars").ok).toBe(false);
  });

  it("refuses an implausible pay-period amount rather than silently accept it", () => {
    expect(parseMoneyCents("999999999999").ok).toBe(false);
  });
});

describe("name matching", () => {
  it("matches 'Last, First' and 'First Last' to the same crew member", () => {
    expect(registerNameKey("Lopez, Maria Elena")).toBe(registerNameKey("Maria Elena Lopez"));
  });

  it("matches a middle initial with a period to the full middle name", () => {
    const keys = crewNameKeys({ legalFirstName: "Maria", legalMiddleName: "Elena", legalLastName: "Lopez" });
    expect(keys).toContain(registerNameKey("Maria E. Lopez"));
  });
});

describe("column reading", () => {
  it("auto-maps a generic export by header name, case-insensitively", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.problems).toEqual([]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].grossCents).toBe(100000);
    expect(plan.create[0].netCents).toBe(80000);
    expect(plan.source).toBe("generic");
  });

  it("reads Gusto's own documented column spellings and labels the source", () => {
    const text = [
      row(
        "Employee First Name",
        "Employee Last Name",
        "Pay Period Start",
        "Pay Period End",
        "Gross Earnings",
        "Net Pay",
        "Employee Federal Income Tax",
        "Employee Social Security Tax",
        "Employee Medicare Tax",
      ),
      row("Maria", "Lopez", "2026-08-23", "2026-08-29", "1000.00", "780.00", "100.00", "62.00", "14.50"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.problems).toEqual([]);
    expect(plan.source).toBe("gusto");
    expect(plan.create[0].deductionsDetail?.federalTaxCents).toBe(10000);
  });

  it("finds the header row below Sage/Foundation-style report preamble", () => {
    const text = [
      "Ridgeline Drywall Inc — Certified Payroll Report",
      "Criteria: Week ending 08/29/2026",
      row("Employee", "Period start", "Period end", "Gross", "Net"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.problems).toEqual([]);
    expect(plan.headerLine).toBe(3);
    expect(plan.notes.some((n) => n.includes("skipped"))).toBe(true);
    expect(plan.create).toHaveLength(1);
  });

  it("never reads a bank account or routing column, and says so", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Bank account number", "Routing number"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "000111222", "021000021"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.mapping).not.toHaveProperty("bankAccount");
    expect(plan.notes.some((n) => n.includes("Bank columns"))).toBe(true);
  });

  it("lists every field the register is missing rather than guess", () => {
    const text = [row("Name", "Notes"), row("Maria Lopez", "n/a")].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).toMatch(/Period start/);
  });

  it("honours a manual column-mapping override over the auto-match", () => {
    // "Wages" would not auto-match "gross" by any alias; the override says
    // column 3 (0-indexed) is gross anyway.
    const text = [
      row("Employee", "Period start", "Period end", "Wages", "Net"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
    ].join("\n");
    const withoutOverride = planPayrollRegisterImport(text, CREW, []);
    expect(withoutOverride.create).toEqual([]);
    const withOverride = planPayrollRegisterImport(text, CREW, [], { gross: 3 });
    expect(withOverride.create).toHaveLength(1);
    expect(withOverride.create[0].grossCents).toBe(100000);
  });

  it("a null override clears an auto-matched column, treating the field as absent", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Total deductions"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "200.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, [], { deductionsTotal: null });
    expect(plan.create[0].deductionsDerived).toBe(true);
    expect(plan.create[0].deductionsCents).toBe(20000); // gross - net, not the ignored column
  });
});

describe("Social Security numbers", () => {
  it("refuses a row carrying a whole SSN in the last-4 column, and never echoes it", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Last 4 of SSN"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "123-45-6789"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).not.toContain("123-45-6789");
    expect(plan.problems[0].message).not.toContain("6789");
    expect(plan.problems[0].message).toMatch(/whole Social Security number/);
  });

  it("refuses a row with a whole SSN in ANY column, not only the SSN column", () => {
    // Sage can print a full SSN, and it can land in a column this mapping
    // never claims as ssnLast4 — the sweep must still catch it. The cell
    // itself IS the SSN (the sweep is anchored, matching a structured
    // spreadsheet cell — the same rule the crew importer's WHOLE_SSN uses),
    // just typed into an unmapped column instead of the SSN one.
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Notes"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "123-45-6789"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).not.toContain("123-45-6789");
  });

  it("refuses a bare nine-digit SSN with no separators, in an unmapped column", () => {
    // A dash lost to a spreadsheet re-save, or typed straight through —
    // WHOLE_SSN alone requires the 3-2-4 grouping and misses this. Same
    // 9-digit form the crew importer's looksLikeSsn already refuses.
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Notes"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "123456789"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).not.toContain("123456789");
  });

  it("accepts exactly four digits as a last-4, and records it once for the crew member", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Last 4 of SSN"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "4321"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.problems).toEqual([]);
    expect(plan.create[0].last4ToRecord).toBe("4321");
  });

  it("does not re-record a last-4 already on the crew record", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Last 4 of SSN"),
      row("Zeke Warren", "2026-08-23", "2026-08-29", "1000.00", "800.00", "9876"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create[0].last4ToRecord).toBeNull();
  });

  it("refuses a row whose last-4 contradicts the crew member's recorded last-4", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Last 4 of SSN"),
      row("Zeke Warren", "2026-08-23", "2026-08-29", "1000.00", "800.00", "1111"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems[0].message).toMatch(/different person/);
  });
});

describe("matching a row to a crew member", () => {
  it("matches by employee number ahead of name, refusing collision-free", () => {
    const text = [
      row("Employee number", "Employee", "Period start", "Period end", "Gross", "Net"),
      row("E-100", "Maria X Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create[0].crewMemberId).toBe("crew_maria");
  });

  it("refuses a name with no match on the crew list", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net"),
      row("Nobody Here", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems[0].message).toMatch(/no crew member with this name/);
  });

  it("refuses an ambiguous name shared by two crew members", () => {
    const dupCrew: RegisterCrew[] = [
      ...CREW,
      { id: "crew_maria2", legalFirstName: "Maria", legalMiddleName: "Elena", legalLastName: "Lopez", employeeNumber: null, identifyingNumberLast4: null },
    ];
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, dupCrew, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems[0].message).toMatch(/two or more crew members share this name/);
  });
});

describe("deductions arithmetic", () => {
  it("derives deductions as gross minus net when there is no total-deductions column", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "780.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create[0].deductionsCents).toBe(22000);
    expect(plan.create[0].deductionsDerived).toBe(true);
  });

  it("uses the register's own total-deductions column when present, over deriving one", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Total deductions"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "780.00", "220.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create[0].deductionsCents).toBe(22000);
    expect(plan.create[0].deductionsDerived).toBe(false);
  });

  it("refuses when net exceeds gross and there is nothing to derive deductions from", () => {
    const text = [
      row("Employee", "Period start", "Period end", "Gross", "Net"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "800.00", "1000.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems[0].message).toMatch(/net is larger than gross/);
  });
});

describe("re-import: create vs update vs unchanged", () => {
  const text = [
    row("Employee", "Period start", "Period end", "Gross", "Net"),
    row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
  ].join("\n");

  it("plans a create when nothing is stored for this person and period", () => {
    const plan = planPayrollRegisterImport(text, CREW, []);
    expect(plan.create).toHaveLength(1);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toEqual([]);
  });

  it("plans nothing — an unchanged row — when re-importing an identical register", () => {
    const existing: ExistingRegisterEntry[] = [
      {
        crewMemberId: "crew_maria",
        periodStart: "2026-08-23",
        periodEnd: "2026-08-29",
        grossCents: 100000,
        deductionsCents: 20000,
        netCents: 80000,
        hours: null,
        payDate: null,
        deductionsDetail: null,
      },
    ];
    const plan = planPayrollRegisterImport(text, CREW, existing);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toHaveLength(1);
  });

  it("still reads as unchanged when the stored hours dropped a trailing zero a Prisma Decimal strips", () => {
    // decimal.js normalises "40.00" -> "40" on the round trip through the
    // database. A held row of "40" against a freshly-read register cell of
    // "40.00" must compare EQUAL, or every re-import of a register that
    // prints two decimal places reads as changed forever.
    const withHours = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Hours"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "40.00"),
    ].join("\n");
    const existing: ExistingRegisterEntry[] = [
      {
        crewMemberId: "crew_maria",
        periodStart: "2026-08-23",
        periodEnd: "2026-08-29",
        grossCents: 100000,
        deductionsCents: 20000,
        netCents: 80000,
        hours: "40",
        payDate: null,
        deductionsDetail: null,
      },
    ];
    const plan = planPayrollRegisterImport(withHours, CREW, existing);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toHaveLength(1);
  });

  it("plans an update when the itemised deductions breakdown changes, even though the total does not", () => {
    // A corrected register that re-categorises the same total deductions
    // between withholding and other must not read as unchanged just
    // because deductionsCents matches.
    const withBreakdown = [
      row("Employee", "Period start", "Period end", "Gross", "Net", "Total deductions", "Federal tax", "Other deductions"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00", "200.00", "150.00", "50.00"),
    ].join("\n");
    const existing: ExistingRegisterEntry[] = [
      {
        crewMemberId: "crew_maria",
        periodStart: "2026-08-23",
        periodEnd: "2026-08-29",
        grossCents: 100000,
        deductionsCents: 20000,
        netCents: 80000,
        hours: null,
        payDate: null,
        // Same total (20000), different split: was all "other" last time.
        deductionsDetail: { otherCents: 20000 },
      },
    ];
    const plan = planPayrollRegisterImport(withBreakdown, CREW, existing);
    expect(plan.create).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].changed).toMatch(/deductions breakdown/);
  });

  it("plans an update, not a duplicate create, when the same person+period comes back with different figures", () => {
    const existing: ExistingRegisterEntry[] = [
      {
        crewMemberId: "crew_maria",
        periodStart: "2026-08-23",
        periodEnd: "2026-08-29",
        grossCents: 90000,
        deductionsCents: 18000,
        netCents: 72000,
        hours: null,
        payDate: null,
        deductionsDetail: null,
      },
    ];
    const plan = planPayrollRegisterImport(text, CREW, existing);
    expect(plan.create).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].changed).toMatch(/gross/);
  });

  it("dedupes two rows for the same person and period WITHIN one file, refusing the second", () => {
    const dupText = [
      row("Employee", "Period start", "Period end", "Gross", "Net"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
      row("Maria Lopez", "2026-08-23", "2026-08-29", "1000.00", "800.00"),
    ].join("\n");
    const plan = planPayrollRegisterImport(dupText, CREW, []);
    expect(plan.create).toHaveLength(1);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).toMatch(/same person and period as line/);
  });
});

describe("row cap", () => {
  it("caps rows that WOULD be saved at MAX_IMPORT_ROWS and says so", () => {
    // Same convention as catalog-import.ts's cap: it bounds rows destined
    // to be written, not the raw line count — a file of garbage rows that
    // all fail to match a crew member is a separate (unbounded) concern,
    // the "no crew member" problem per row, not this cap.
    const bigCrew: RegisterCrew[] = Array.from({ length: 510 }, (_, i) => ({
      id: `crew_${i}`,
      legalFirstName: `Worker${i}`,
      legalMiddleName: null,
      legalLastName: "Test",
      employeeNumber: null,
      identifyingNumberLast4: null,
    }));
    const header = row("Employee", "Period start", "Period end", "Gross", "Net");
    const lines = [header];
    for (let i = 0; i < 510; i++) {
      lines.push(row(`Worker${i} Test`, "2026-08-23", "2026-08-29", "1000.00", "800.00"));
    }
    const plan = planPayrollRegisterImport(lines.join("\n"), bigCrew, []);
    expect(plan.create).toHaveLength(500);
    expect(plan.problems.some((p) => p.message.includes("Only the first"))).toBe(true);
  });
});

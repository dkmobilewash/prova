import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "./catalog-import";
import {
  FULL_SSN_REFUSAL,
  MAX_IMPORT_ROWS,
  dateFromDay,
  parseContactType,
  parseJobStatus,
  parseLast4,
  parseSheetDate,
  planClientImport,
  planCrewImport,
  planJobImport,
} from "./spreadsheet-import";

/**
 * The half of the spreadsheet import that decides what a file SAYS, and
 * what would happen to each row — before anything is written.
 *
 * Every "nothing is wrong" assertion here is paired with a positive one on
 * the same plan (a count, a named line), because a plan that came back
 * empty would pass every `not.toContain` in this file.
 */

describe("parseCsvRecords — the catalog parser, now with line numbers", () => {
  it("gives parseCsv exactly the records it gave before", () => {
    const text = 'a,b\n\n"x, y",2\r\n5/8" board,3\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x, y", "2"],
      ['5/8" board', "3"],
    ]);
  });

  it("numbers records by the physical line they start on, across blank lines and quoted line breaks", () => {
    const text = 'h1,h2\n\nfirst,1\n"two\nlines",2\r\nlast,3';
    expect(parseCsvRecords(text).map((r) => r.line)).toEqual([1, 3, 4, 6]);
  });
});

describe("dates", () => {
  it("reads both formats a US spreadsheet exports, and stores UTC midnight", () => {
    expect(parseSheetDate("2026-03-01")).toEqual({ ok: true, value: "2026-03-01" });
    expect(parseSheetDate("3/1/2026")).toEqual({ ok: true, value: "2026-03-01" });
    expect(parseSheetDate(" 03/01/2026 ")).toEqual({ ok: true, value: "2026-03-01" });
    expect(parseSheetDate("")).toEqual({ ok: true, value: null });
    expect(dateFromDay("2026-03-01").toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("refuses impossible dates rather than rolling them over", () => {
    for (const bad of ["2026-02-30", "2/30/2026", "2027-02-29", "13/1/2026", "2026-00-10", "4/31/2026"]) {
      expect(parseSheetDate(bad).ok, bad).toBe(false);
    }
    expect(parseSheetDate("2028-02-29")).toEqual({ ok: true, value: "2028-02-29" });
  });

  it("refuses shapes it would have to guess at", () => {
    for (const bad of ["1/3/26", "01.03.2026", "March 1", "45123"]) {
      expect(parseSheetDate(bad).ok, bad).toBe(false);
    }
  });
});

describe("clients", () => {
  it("matches headers regardless of case, spacing and punctuation", () => {
    const plan = planClientImport(" CLIENT_NAME ,Contact-Type,E-mail,Phone Number\nAcme,gc,a@b.co,555", []);
    expect(plan.problems).toEqual([]);
    expect(plan.create).toEqual([
      expect.objectContaining({ name: "Acme", accountType: "GENERAL_CONTRACTOR", email: "a@b.co", phone: "555" }),
    ]);
  });

  it("maps the words a person types to a contact type", () => {
    const cases: [string, string][] = [
      ["GC", "GENERAL_CONTRACTOR"],
      ["general contractor", "GENERAL_CONTRACTOR"],
      ["GENERAL_CONTRACTOR", "GENERAL_CONTRACTOR"],
      ["Developer", "DEVELOPER"],
      ["owner", "DEVELOPER"],
      ["vendor", "VENDOR"],
      ["Supplier", "VENDOR"],
      ["sub", "SUBCONTRACTOR"],
      ["Sub-contractor", "SUBCONTRACTOR"],
    ];
    for (const [word, value] of cases) expect(parseContactType(word), word).toBe(value);
    expect(parseContactType("architect")).toBeUndefined();
  });

  it("defaults a blank type to General contractor and says so; refuses an unknown one by line", () => {
    const plan = planClientImport("Name,Type\nAcme,\nBeta,architect\nGamma,vendor", []);
    expect(plan.create.map((r) => [r.name, r.accountType, r.typeDefaulted])).toEqual([
      ["Acme", "GENERAL_CONTRACTOR", true],
      ["Gamma", "VENDOR", false],
    ]);
    expect(plan.problems).toEqual([{ line: 3, message: expect.stringContaining('type "architect"') }]);
  });

  it("splits create / already here / problems, case-insensitively, and adds a repeated name once", () => {
    const plan = planClientImport(
      "Name,Email\nACME  builders,\nNew Co,\n,orphan@x.co\nnew co,\nBad,not-an-email",
      ["Acme Builders"],
    );
    expect(plan.create.map((r) => r.name)).toEqual(["New Co"]);
    expect(plan.existing).toEqual([{ line: 2, label: "ACME builders" }]);
    expect(plan.problems.map((p) => p.line)).toEqual([4, 5, 6]);
    expect(plan.problems[1].message).toContain("same name as line 3");
  });

  it("skips blank rows and keeps the line numbers true", () => {
    const plan = planClientImport("Name,Type\n\nAcme,gc\n,,\n\nBeta,nonsense\n", []);
    expect(plan.create.map((r) => r.line)).toEqual([3]);
    expect(plan.problems).toEqual([{ line: 6, message: expect.stringContaining("Beta") }]);
  });

  it("refuses a file with no name column on line 1", () => {
    const plan = planClientImport("Email,Phone\na@b.co,555", []);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toEqual([{ line: 1, message: expect.stringContaining("No name column") }]);
  });

  it(`caps the import at ${MAX_IMPORT_ROWS} rows and names the first one left out`, () => {
    const lines = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) => `Client ${i + 1}`);
    const plan = planClientImport(`Name\n${lines.join("\n")}`, []);
    expect(plan.create).toHaveLength(MAX_IMPORT_ROWS);
    expect(plan.problems).toEqual([
      { line: MAX_IMPORT_ROWS + 2, message: expect.stringContaining("3 more were left out") },
    ]);
  });
});

describe("jobs", () => {
  const header = "Job Name,Client,Status,Start Date,End Date,Scope";

  it("maps status words, and imports every job as an estimate while showing what the sheet said", () => {
    const cases: [string, string][] = [
      ["bid", "ESTIMATE"],
      ["Contracted", "CONTRACTED"],
      ["awarded", "CONTRACTED"],
      ["In Progress", "IN_PROGRESS"],
      ["in_progress", "IN_PROGRESS"],
      ["active", "IN_PROGRESS"],
      ["Done", "COMPLETE"],
      ["complete", "COMPLETE"],
    ];
    for (const [word, value] of cases) expect(parseJobStatus(word), word).toBe(value);

    const plan = planJobImport(`${header}\nA,Acme,In progress,,,\nB,Acme,,,,\nC,Acme,paused,,,`, [], []);
    expect(plan.create.map((r) => [r.name, r.sheetStatus])).toEqual([
      ["A", "IN_PROGRESS"],
      ["B", null],
    ]);
    expect(plan.problems).toEqual([{ line: 4, message: expect.stringContaining('status "paused"') }]);
  });

  it("reads both date formats and refuses impossible ones and a backwards range, by line", () => {
    const plan = planJobImport(
      `${header}\nA,Acme,,2026-03-01,4/15/2026,\nB,Acme,,2026-02-30,,\nC,Acme,,5/1/2026,4/1/2026,`,
      [],
      [],
    );
    expect(plan.create).toEqual([
      expect.objectContaining({ name: "A", startDate: "2026-03-01", endDate: "2026-04-15" }),
    ]);
    expect(plan.problems.map((p) => p.line)).toEqual([3, 4]);
    expect(plan.problems[0].message).toContain("isn't a real date");
    expect(plan.problems[1].message).toContain("before the start date");
  });

  it("resolves each client to an existing one, one created by this file, or one created by an earlier row", () => {
    const plan = planJobImport(
      `${header}\nTower,acme builders,,,,\nHarbor,Brand New GC,,,,\nPier,brand new gc,,,,\nDock,,,,,`,
      ["Acme Builders"],
      [],
    );
    expect(plan.create.map((r) => r.client)).toEqual([
      { kind: "existing", name: "acme builders" },
      { kind: "new", name: "Brand New GC" },
      { kind: "new-earlier", name: "brand new gc", line: 3 },
    ]);
    expect(plan.newClients).toEqual(["Brand New GC"]);
    expect(plan.problems).toEqual([{ line: 5, message: expect.stringContaining("no client") }]);
  });

  it("treats a job as already here by name AND client, so one job name can serve two GCs", () => {
    const plan = planJobImport(
      `${header}\ntower,ACME BUILDERS,,,,\nTower,Other GC,,,,\nTower,Other GC,,,,`,
      ["Acme Builders", "Other GC"],
      [{ name: "Tower", clientName: "Acme Builders" }],
    );
    expect(plan.existing).toEqual([{ line: 2, label: "tower — ACME BUILDERS" }]);
    expect(plan.create.map((r) => [r.line, r.clientName])).toEqual([[3, "Other GC"]]);
    expect(plan.problems).toEqual([{ line: 4, message: expect.stringContaining("same job as line 3") }]);
  });

  it("never reads a money column, and names it", () => {
    const plan = planJobImport("Job,Client,Contract Value,Notes\nTower,Acme,$250000,framing", [], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).not.toHaveProperty("contractValue");
    expect(JSON.stringify(plan.create[0])).not.toContain("250000");
    expect(plan.moneyColumns).toEqual(["Contract Value"]);
  });

  it("needs both a job name and a client column", () => {
    const plan = planJobImport("Job,Status\nTower,bid", [], []);
    expect(plan.problems).toEqual([{ line: 1, message: expect.stringContaining("No Client column") }]);
  });
});

describe("crew — and never more than four SSN digits", () => {
  const header = "First Name,Middle Name,Last Name,Employee #,Last 4 of SSN,Hire Date";

  it("keeps exactly four digits, and accepts a masked number with only four in it", () => {
    expect(parseLast4("1234")).toEqual({ ok: true, value: "1234" });
    expect(parseLast4("0042")).toEqual({ ok: true, value: "0042" });
    expect(parseLast4("XXX-XX-1234")).toEqual({ ok: true, value: "1234" });
    expect(parseLast4("***-**-5678")).toEqual({ ok: true, value: "5678" });
    expect(parseLast4("")).toEqual({ ok: true, value: null });
  });

  it("refuses a whole SSN in any spelling, without repeating it back", () => {
    for (const full of ["123-45-6789", "123456789", "123 45 6789", " 123-45-6789 "]) {
      const cell = parseLast4(full);
      expect(cell, full).toEqual({ ok: false, message: FULL_SSN_REFUSAL });
    }
    expect(FULL_SSN_REFUSAL).not.toMatch(/\d{5}/);
  });

  it("refuses anything that isn't exactly four digits, and names the dropped-leading-zero case", () => {
    expect(parseLast4("123")).toEqual({ ok: false, message: expect.stringContaining("leading zero") });
    for (const bad of ["12345", "12a4", "1234567"]) expect(parseLast4(bad).ok, bad).toBe(false);
  });

  it("drops a row carrying a whole SSN entirely — nothing from it reaches the plan", () => {
    const plan = planCrewImport(`${header}\nMaria,,Lopez,E-1,123-45-6789,\nJuan,,Diaz,E-2,6789,`, []);
    expect(plan.create.map((r) => r.legalLastName)).toEqual(["Diaz"]);
    expect(plan.problems).toEqual([{ line: 2, message: `Maria Lopez — ${FULL_SSN_REFUSAL}` }]);
    expect(JSON.stringify(plan)).not.toContain("123-45");
    for (const row of plan.create) expect(row.identifyingNumberLast4 ?? "0000").toMatch(/^\d{4}$/);
  });

  it("refuses an employee number shaped like an SSN", () => {
    const plan = planCrewImport(`${header}\nMaria,,Lopez,123-45-6789,,\nJuan,,Diaz,987654321,,`, []);
    expect(plan.create).toEqual([]);
    expect(plan.problems.map((p) => p.line)).toEqual([2, 3]);
    expect(JSON.stringify(plan)).not.toContain("6789");
  });

  it("refuses a whole SSN in ANY column it would store, not only the last-4 one", () => {
    // Phone, address and zip are free text; a sheet with its columns one
    // off, or a clerk who typed the number into the wrong cell, would
    // otherwise store it verbatim on the crew record.
    const wide = "First Name,Middle Name,Last Name,Phone,Address,Address 2,City,State,Zip";
    const plan = planCrewImport(
      [
        wide,
        "Maria,,Lopez,123-45-6789,,,,,",
        "Juan,,Diaz,,123-45-6789,,,,",
        "Ana,,Ruiz,,,,,,123 45 6789",
        "Bo,123-45-6789,Ng,,,,,,",
        "Eve,,Park,555-201-4400,12 Oak Ave,,Reno,NV,89501-1234",
      ].join("\n"),
      [],
    );
    expect(plan.create.map((r) => r.legalLastName)).toEqual(["Park"]);
    expect(plan.problems.map((p) => p.line)).toEqual([2, 3, 4, 5]);
    for (const problem of plan.problems) expect(problem.message).toContain("Social Security number");
    expect(JSON.stringify(plan)).not.toContain("45-6789");
    expect(JSON.stringify(plan)).not.toContain("45 6789");
  });

  it("never carries a column it does not use, so a whole SSN under an unknown header goes nowhere", () => {
    const plan = planCrewImport("First Name,Last Name,Social Security Number\nMaria,Lopez,123-45-6789", []);
    expect(plan.create.map((r) => r.legalLastName)).toEqual(["Lopez"]);
    expect(plan.ignoredColumns).toEqual(["Social Security Number"]);
    expect(JSON.stringify(plan)).not.toContain("6789");
  });

  it("needs separate first and last name columns rather than splitting one", () => {
    const plan = planCrewImport("Name,Phone\nMaria Lopez,555", []);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toEqual([{ line: 1, message: expect.stringContaining("First name column") }]);
  });

  it("matches existing crew by legal name, and treats different employee numbers as different people", () => {
    const plan = planCrewImport(
      `${header}\nmaria,,LOPEZ,,,\nJohn,,Smith,E-7,,\nAna,,Ruiz,E-1,,\nPeta,,Ng,,,3/2/2024\nPeta,,Ng,,,`,
      [
        { legalFirstName: "Maria", legalMiddleName: null, legalLastName: "Lopez", employeeNumber: null },
        { legalFirstName: "John", legalMiddleName: null, legalLastName: "Smith", employeeNumber: "E-5" },
        { legalFirstName: "Bea", legalMiddleName: null, legalLastName: "Cole", employeeNumber: "E-1" },
      ],
    );
    expect(plan.existing).toEqual([{ line: 2, label: "maria LOPEZ" }]);
    expect(plan.create.map((r) => [r.line, r.legalLastName, r.hiredOn])).toEqual([
      [3, "Smith", null],
      [5, "Ng", "2024-03-02"],
    ]);
    expect(plan.problems).toEqual([
      { line: 4, message: expect.stringContaining("already belongs to Bea Cole") },
      { line: 6, message: expect.stringContaining("same person as line 5") },
    ]);
  });

  it("refuses an impossible hire date by line", () => {
    const plan = planCrewImport(`${header}\nMaria,,Lopez,,,2/30/2024`, []);
    expect(plan.problems).toEqual([{ line: 2, message: expect.stringContaining("isn't a real date") }]);
  });
});

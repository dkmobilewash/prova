import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { importFileProblem, XLS_MESSAGE } from "./import-files";
import { serialDateToIso, workbookToCsvText } from "./xlsx-import";
import { parseCsvRecords } from "./catalog-import";
import {
  FULL_SSN_REFUSAL,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  TOO_LARGE_MESSAGE,
  planClientImport,
  planCrewImport,
  planJobImport,
} from "./spreadsheet-import";

/**
 * The Excel path, proven on REAL .xlsx BYTES — every test builds a genuine
 * workbook with the same library the browser uses, writes it to a buffer,
 * and reads that buffer back through `workbookToCsvText`. No fixture is a
 * hand-written string pretending to be a workbook.
 *
 * The claims that matter, each pinned below:
 *   - the converted text round-trips through `parseCsvRecords` to the same
 *     cells, and through the full preview planners to the same rows a CSV
 *     of the sheet would produce;
 *   - a date-formatted cell comes out as YYYY-MM-DD, never its serial —
 *     45123 must import as 2023-07-16, not refuse every date column;
 *   - every refusal on the text path still fires AFTER conversion: the
 *     whole-SSN sweep, the 500-row cap. Format support must never become a
 *     way around a guard.
 */

type Cell = string | number | boolean | null | { serial: number; z: string };

/** A real workbook, as bytes, from rows of cells. `{ serial, z }` writes a
 * number carrying that number format — how Excel stores a date. */
function workbookBytes(rows: Cell[][], extraSheet?: { name: string; rows: Cell[][] }): Uint8Array {
  const toSheet = (data: Cell[][]) => {
    const sheet = XLSX.utils.aoa_to_sheet(
      data.map((row) => row.map((cell) => (cell !== null && typeof cell === "object" ? cell.serial : cell))),
    );
    data.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell !== null && typeof cell === "object") {
          const at = XLSX.utils.encode_cell({ r, c });
          (sheet[at] as XLSX.CellObject).z = cell.z;
        }
      }),
    );
    return sheet;
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, toSheet(rows), "First");
  if (extraSheet) XLSX.utils.book_append_sheet(workbook, toSheet(extraSheet.rows), extraSheet.name);
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true }));
}

/** Serial for a calendar day, from the same arithmetic Excel uses. */
function serialFor(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 86_400_000 + 25569;
}

describe("workbookToCsvText", () => {
  it("round-trips a clients sheet through the full preview, quoting only what the parser needs", () => {
    const bytes = workbookBytes([
      ["Name", "Type", "Email", "Phone", "Address"],
      ["Acme Builders, Inc", "GC", "pm@acme.com", "555-201-4400", "100 Main St, Reno NV"],
      ['Sierra 5/8" Drywall', "Sub", "", "555-201-4401", ""],
    ]);
    const text = workbookToCsvText(bytes);

    // The text itself parses back to the same cells.
    const records = parseCsvRecords(text);
    expect(records[1].cells.slice(0, 2)).toEqual(["Acme Builders, Inc", "GC"]);
    expect(records[2].cells[0]).toBe('Sierra 5/8" Drywall');

    // And the untouched server planner reads it exactly as a pasted CSV.
    const plan = planClientImport(text, []);
    expect(plan.problems).toEqual([]);
    expect(plan.create.map((row) => row.name)).toEqual(["Acme Builders, Inc", 'Sierra 5/8" Drywall']);
    expect(plan.create[0].accountType).toBe("GENERAL_CONTRACTOR");
    expect(plan.create[0].address).toBe("100 Main St, Reno NV");
  });

  it("emits a date-formatted serial as YYYY-MM-DD, which the jobs planner then accepts", () => {
    const bytes = workbookBytes([
      ["Job name", "Client", "Start date", "End date"],
      ["Riverside TI", "Acme", { serial: 45123, z: "m/d/yy" }, { serial: serialFor(2026, 3, 1), z: "mm/dd/yyyy" }],
    ]);
    const text = workbookToCsvText(bytes);
    expect(text).toContain("2023-07-16"); // 45123, the serial itself, must not appear
    expect(text).not.toMatch(/(^|,)45123(,|$)/m);

    const plan = planJobImport(text, [], []);
    expect(plan.problems).toEqual([]);
    expect(plan.create[0].startDate).toBe("2023-07-16");
    expect(plan.create[0].endDate).toBe("2026-03-01");
  });

  it("stringifies plain numbers without display formatting or float noise", () => {
    const bytes = workbookBytes([
      ["Name", "Phone"],
      ["Acme", 5552014400],
      ["Best", 0.1 + 0.2],
    ]);
    const text = workbookToCsvText(bytes);
    expect(text).toContain("5552014400"); // never "5,552,014,400" — a thousands
    expect(text).toContain("0.3"); // separator would split the field
    expect(text).not.toContain("0.30000000000000004");
  });

  it("reads the FIRST worksheet only", () => {
    const bytes = workbookBytes([["Name"], ["From sheet one"]], {
      name: "Second",
      rows: [["Name"], ["From sheet two"]],
    });
    const text = workbookToCsvText(bytes);
    expect(text).toContain("From sheet one");
    expect(text).not.toContain("From sheet two");
  });

  it("keeps Excel row numbers as line numbers across blank rows and in-cell line breaks", () => {
    const bytes = workbookBytes([
      ["Name", "Address"],
      [null, null], // blank row 2
      ["Acme", "100 Main St\nReno NV"], // a multi-line cell must not shift row 4
      ["", "no name on row 4"],
    ]);
    const plan = planClientImport(workbookToCsvText(bytes), []);
    expect(plan.create[0].address).toBe("100 Main St Reno NV");
    expect(plan.problems).toEqual([{ line: 4, message: "No name — skipped." }]);
  });

  it("still refuses a whole SSN in a cell after conversion — format support is not a way around the sweep", () => {
    const bytes = workbookBytes([
      ["First name", "Last name", "Phone"],
      ["Maria", "Lopez", "123-45-6789"],
    ]);
    const plan = planCrewImport(workbookToCsvText(bytes), []);
    expect(plan.create).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).toContain(FULL_SSN_REFUSAL);
    expect(plan.problems[0].message).not.toContain("6789");
  });

  it("still caps at the same 500 rows after conversion", () => {
    const rows: Cell[][] = [["Name"]];
    for (let i = 1; i <= MAX_IMPORT_ROWS + 2; i++) rows.push([`Client ${i}`]);
    const plan = planClientImport(workbookToCsvText(workbookBytes(rows)), []);
    expect(plan.create).toHaveLength(MAX_IMPORT_ROWS);
    expect(plan.problems.map((p) => p.message).join(" ")).toContain(`Only the first ${MAX_IMPORT_ROWS} rows`);
  });
});

describe("serialDateToIso", () => {
  it("converts the 1900 and 1904 epochs", () => {
    expect(serialDateToIso(45123)).toBe("2023-07-16");
    expect(serialDateToIso(25569)).toBe("1970-01-01");
    expect(serialDateToIso(45123 - 1462, true)).toBe("2023-07-16");
    // A time-of-day fraction stays on its day.
    expect(serialDateToIso(45123.75)).toBe("2023-07-16");
  });
});

describe("importFileProblem", () => {
  it("refuses .xls with a sentence pointing at .xlsx, and oversized files before any parse", () => {
    expect(importFileProblem("crew.xls", 1000)).toBe(XLS_MESSAGE);
    expect(XLS_MESSAGE).toContain(".xlsx");
    expect(importFileProblem("crew.xlsx", MAX_IMPORT_BYTES + 1)).toBe(TOO_LARGE_MESSAGE);
    // Size outranks format: an oversized .xls is refused for size first,
    // and either way nothing is parsed.
    expect(importFileProblem("crew.xls", MAX_IMPORT_BYTES + 1)).toBe(TOO_LARGE_MESSAGE);
  });

  it("passes .xlsx, .csv and .vcf files under the cap", () => {
    expect(importFileProblem("crew.xlsx", 1000)).toBeNull();
    expect(importFileProblem("crew.csv", 1000)).toBeNull();
    expect(importFileProblem("contacts.vcf", 1000)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, parseCatalogImport, parseCsv, splitAgainstExisting } from "./catalog-import";

describe("parseCsv", () => {
  it("keeps a comma that lives inside quotes", () => {
    // "2x4, 8ft" is one field, not two. Getting this wrong shifts every
    // later column on the row — price becomes cost, cost becomes hours.
    expect(parseCsv('a,"2x4, 8ft",c')).toEqual([["a", "2x4, 8ft", "c"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('"5/8"" board",x')).toEqual([['5/8" board', "x"]]);
  });

  it("treats CRLF as one line break", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips the BOM Excel writes", () => {
    expect(parseCsv("﻿description,price")).toEqual([["description", "price"]]);
  });

  it("treats a mid-field quote as an inch mark, not an opening quote", () => {
    // 5/8" and 1/2" are on nearly every line of a drywall price list. Opening
    // a quoted field here would swallow the rest of the row.
    expect(parseCsv('5/8" board,SF,2.85')).toEqual([['5/8" board', "SF", "2.85"]]);
    expect(parseCsv('3/4" x 10\' bead,LF,1.20')).toEqual([["3/4\" x 10' bead", "LF", "1.20"]]);
  });

  it("keeps a newline that lives inside quotes", () => {
    expect(parseCsv('"line one\nline two",x')).toEqual([["line one\nline two", "x"]]);
  });

  it("drops blank lines instead of reporting them as broken rows", () => {
    expect(parseCsv("a,b\n\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("accepts tab-separated text, which is what pasting from a spreadsheet gives", () => {
    expect(parseCsv("a\tb\tc")).toEqual([["a", "b", "c"]]);
  });
});

describe("parseCatalogImport", () => {
  it("reads a plain price list", () => {
    const { rows, problems } = parseCatalogImport(
      ["Description,Unit,Unit Price,Cost,Hours,Trade", '5/8" Type X board,SF,2.85,1.90,0.012,drywall'].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        description: '5/8" Type X board',
        unit: "SF",
        unitPrice: 2.85,
        budgetedUnitCost: 1.9,
        laborHours: 0.012,
        tradeScope: "METAL_FRAMING_DRYWALL",
      },
    ]);
  });

  it("matches headers a real export would actually use", () => {
    // Nobody's price list is already named the way our schema is.
    const { rows } = parseCatalogImport(["Item,UOM,Rate,Material Cost", "Corner bead,LF,1.20,0.60"].join("\n"));
    expect(rows[0]).toMatchObject({
      description: "Corner bead",
      unit: "LF",
      unitPrice: 1.2,
      budgetedUnitCost: 0.6,
    });
  });

  it("reads money the way exports write it", () => {
    const { rows } = parseCatalogImport(
      ['Description,Price,Cost', 'Framing,"$1,234.50",(4.00)'].join("\n"),
    );
    expect(rows[0].unitPrice).toBe(1234.5);
    expect(rows[0].budgetedUnitCost).toBe(-4);
  });

  it("refuses a row it cannot read rather than importing a wrong number", () => {
    // "call for pricing" must never become 0 — a zero price silently
    // under-bids every job built from that catalog entry.
    const { rows, problems } = parseCatalogImport(
      ["Description,Price", "Special order,call for pricing", "Board,2.85"].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("Board");
    expect(problems[0].line).toBe(2);
    expect(problems[0].message).toContain("call for pricing");
  });

  it("treats an empty cell as no value, not as an unreadable one", () => {
    const { rows, problems } = parseCatalogImport(["Description,Price,Cost", "Board,,"].join("\n"));
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ unitPrice: null, budgetedUnitCost: null });
  });

  it("accepts trade names as people write them", () => {
    const scopes = ["EIFS", "lath & plaster", "Acoustical Ceilings", "fireproofing", "METAL_FRAMING_DRYWALL"];
    const text = ["Description,Trade", ...scopes.map((s, i) => `Item ${i},"${s}"`)].join("\n");
    expect(parseCatalogImport(text).rows.map((r) => r.tradeScope)).toEqual([
      "EIFS",
      "LATH_PLASTER",
      "ACOUSTICAL_CEILINGS",
      "FIREPROOFING",
      "METAL_FRAMING_DRYWALL",
    ]);
  });

  it("reports a trade it doesn't recognise instead of dropping the tag", () => {
    const { rows, problems } = parseCatalogImport(["Description,Trade", "Item,plumbing"].join("\n"));
    expect(rows).toHaveLength(0);
    expect(problems[0].message).toContain("plumbing");
  });

  it("needs a header row, and says so plainly", () => {
    const { rows, problems } = parseCatalogImport("Board,SF,2.85\nBead,LF,1.20");
    expect(rows).toHaveLength(0);
    expect(problems[0].message).toContain("description column");
  });

  it("names the columns it ignored, so a mis-mapped price is visible", () => {
    const { ignoredColumns } = parseCatalogImport(
      ["Description,Price,Vendor SKU,Notes", "Board,2.85,ABC-1,x"].join("\n"),
    );
    expect(ignoredColumns).toEqual(["vendor sku", "notes"]);
  });

  it("skips a row with no description and says which line", () => {
    const { rows, problems } = parseCatalogImport(["Description,Price", ",2.85", "Board,1.00"].join("\n"));
    expect(rows).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 2 });
  });

  it("caps very large files and says how many it left out", () => {
    const many = ["Description,Price", ...Array.from({ length: MAX_IMPORT_ROWS + 20 }, (_, i) => `Item ${i},1`)];
    const { rows, problems } = parseCatalogImport(many.join("\n"));
    expect(rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(problems.at(-1)!.message).toContain("20 more");
  });

  it("has nothing to say about empty input except that it's empty", () => {
    expect(parseCatalogImport("").rows).toHaveLength(0);
    expect(parseCatalogImport("   \n  ").rows).toHaveLength(0);
  });
});

describe("splitAgainstExisting", () => {
  const row = (description: string, line = 2) => ({
    line,
    description,
    unit: null,
    unitPrice: null,
    budgetedUnitCost: null,
    laborHours: null,
    tradeScope: null,
  });

  it("separates new items from ones already in the catalog", () => {
    const result = splitAgainstExisting([row("Board"), row("Bead", 3)], ["Board"]);
    expect(result.fresh.map((r) => r.description)).toEqual(["Bead"]);
    expect(result.duplicatesOfExisting.map((r) => r.description)).toEqual(["Board"]);
  });

  it("matches regardless of case and surrounding space", () => {
    // "the same item" is what a person means, not what the string equals.
    const result = splitAgainstExisting([row("  BOARD ")], ["board"]);
    expect(result.fresh).toHaveLength(0);
    expect(result.duplicatesOfExisting).toHaveLength(1);
  });

  it("catches a file that repeats itself", () => {
    const result = splitAgainstExisting([row("Board", 2), row("board", 3)], []);
    expect(result.fresh).toHaveLength(1);
    expect(result.duplicatesWithinFile.map((r) => r.line)).toEqual([3]);
  });

  it("counts a repeat within the file once, even when it also already exists", () => {
    const result = splitAgainstExisting([row("Board", 2), row("Board", 3)], ["Board"]);
    expect(result.fresh).toHaveLength(0);
    expect(result.duplicatesOfExisting).toHaveLength(1);
    expect(result.duplicatesWithinFile).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  CslbHeaderError,
  classCodes,
  cslbRows,
  cslbRowsForLicences,
  displayPhone,
  splitCsvLine,
} from "./masterFile";

/**
 * Every licence number here is a fixture value this repo already uses
 * (`lib/sales-licence.ts` cites 884201, 61234/061234, 91594 and 102 as shapes,
 * not as any particular contractor). Every name and phone is synthetic. No row
 * of the real CSLB file appears in this test, per the fixture rule.
 *
 * The header below carries the file's REAL column names, including the trap:
 * the classification column is literally `Classifications(s)`, and good standing
 * is `CLEAR`. Extra columns sit either side so the reader has to find columns by
 * name rather than position.
 */
const HEADER =
  'LicenseNo,LastUpdate,BusinessName,BusinessPhone,City,PrimaryStatus,Classifications(s),County';

const ROWS = [
  '884201,2026-09-01,"Valley Interior Systems, Inc.",9165550100,Sacramento,CLEAR,C9 | C-35,Sacramento',
  '61234,2026-09-01,Summit Acoustics LLC,(909) 555-0134 ext 2,Fontana,CLEAR,C-2,San Bernardino',
  '91594,2026-09-01,Baker Plastering,,Fresno,CLEAR,C35,Fresno',
  '102,2026-09-01,Western Fireproofing Co.,5305550199,Chico,SUSPENDED,C-35 | C61/D-50,Butte',
  'na,2026-09-01,Not A Licence,5305550111,Chico,CLEAR,B,Butte',
];

const FILE = [HEADER, ...ROWS].join("\r\n") + "\r\n";

async function all<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("one CSV line into fields", () => {
  it.each([
    ["a,b,c", ["a", "b", "c"]],
    ['"Valley Interior, Inc.",x', ["Valley Interior, Inc.", "x"]],
    ['"He said ""hi""",x', ['He said "hi"', "x"]],
    ["a,,c", ["a", "", "c"]],
  ])("reads %s", (line, expected) => {
    expect(splitCsvLine(line)).toEqual(expected);
  });
});

describe("classification codes in both spellings", () => {
  it("collapses C-9 and C9 to one form and keeps both halves of a pair", () => {
    expect(classCodes("C9 | C-35")).toEqual(["C9", "C35"]);
    expect(classCodes("C-35 | C61/D-50")).toEqual(["C35", "C61", "D50"]);
    expect(classCodes("B")).toEqual(["B"]);
    expect(classCodes("")).toEqual([]);
  });
});

describe("the phone as a person will read it", () => {
  it("formats ten digits and keeps anything else as printed", () => {
    expect(displayPhone("9165550100")).toBe("916-555-0100");
    expect(displayPhone("(909) 555-0134 ext 2")).toBe("(909) 555-0134 ext 2");
    expect(displayPhone("   ")).toBeNull();
  });
});

describe("reading the master file", () => {
  it("finds columns by name and reads every row that has a licence", async () => {
    const rows = await all(cslbRows([FILE]));
    expect(rows.map((row) => row.licence)).toEqual(["884201", "61234", "91594", "102"]);
    expect(rows[0]).toEqual({
      licence: "884201",
      name: "Valley Interior Systems, Inc.",
      phone: "916-555-0100",
      status: "CLEAR",
      classes: ["C9", "C35"],
      city: "Sacramento",
      county: "Sacramento",
    });
    expect(rows[2]!.phone).toBeNull();
    expect(rows[3]!.status).toBe("SUSPENDED");
  });

  /**
   * THE SIZE ASSERTION. A chunk boundary can land anywhere, and a reader that
   * dropped the line straddling it would return one row fewer and pass every
   * other test here. So the file is cut at EVERY byte offset and the row count
   * must equal the number of licensed fixture rows every time.
   */
  it("reads the same rows however the stream is chunked", async () => {
    const whole = await all(cslbRows([FILE]));
    for (let cut = 1; cut < FILE.length; cut++) {
      const rows = await all(cslbRows([FILE.slice(0, cut), FILE.slice(cut)]));
      expect(rows, `cut at ${cut}`).toEqual(whole);
    }
    expect(whole).toHaveLength(4);
  });

  it("keeps a quoted field with a line break inside it as one row", async () => {
    const file = [HEADER, '884201,x,"Two\nLine Name",9165550100,x,CLEAR,C9,x'].join("\n");
    const rows = await all(cslbRows([file]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Two\nLine Name");
  });

  it("refuses a file whose header has lost the phone column, naming it", async () => {
    const file = [HEADER.replace("BusinessPhone", "Telephone"), ...ROWS].join("\n");
    await expect(all(cslbRows([file]))).rejects.toThrow(CslbHeaderError);
    await expect(all(cslbRows([file]))).rejects.toThrow(/BusinessPhone/);
  });

  it("refuses an empty file rather than returning no rows", async () => {
    await expect(all(cslbRows([""]))).rejects.toThrow(CslbHeaderError);
  });
});

describe("the rows for the licences a lead holds", () => {
  it("returns only the wanted licences and says how many rows it read", async () => {
    const { rows, rowsRead } = await cslbRowsForLicences([FILE], new Set(["884201", "102", "999"]));
    expect(rowsRead).toBe(4);
    expect([...rows.keys()].sort()).toEqual(["102", "884201"]);
    expect(rows.get("102")!.status).toBe("SUSPENDED");
  });
});

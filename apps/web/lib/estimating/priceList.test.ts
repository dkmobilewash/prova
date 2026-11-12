import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chosenRows, contactEmailIn, convert, guessColumns, materialLabelFor, planPriceList, priceFrom, priceListTable, readRow, type Need } from "./priceList";
import { materialGroup, materialKey } from "./materialKey";

const text = readFileSync(new URL("../../e2e/fixtures/supplier-price-list.csv", import.meta.url), "utf8");
const table = priceListTable(text);
const map = guessColumns(table.header)!;
const rows = table.rows.map((r) => readRow(r, map, 500));
const row = (re: RegExp) => rows.find((r) => re.test(`${r.description} ${r.unit}`))!;

// What Baker's three legend types leave unpriced (the #1091 walk's "Price these 10 materials").
const BAKER: Need[] = [
  ["6in metal stud", "EA"], ["6in track, top and bottom", "LF"], ["drywall screws, Type S, per 1,000", "M"], ["joint tape, 500 ft rolls", "RL"],
  ["joint compound", "LB"], ["5/8in gypsum board, 4x8 sheets", "SHT"], ["cavity insulation", "SF"], ["6in metal stud, 25 ga", "EA"],
  ["6in track, bottom, 25 ga", "LF"], ["6in deflection track, top, 25 ga", "LF"], ["5/8in type X gypsum board, 4x8 sheets", "SHT"],
].map(([label, unit]) => ({ group: materialGroup({ description: label, unit }), label, unit }));

describe("reading a supplier's price list", () => {
  it("finds the header under the quote's letterhead and takes the UNIT price, not the extended one", () => {
    expect(table.header).toContain("Unit Price");
    expect(table.header[map.price]).toBe("Unit Price");
    expect(table.header[map.item]).toBe("Description");
    expect(table.header[map.size!]).toBe("Size");
    expect(table.header[map.unit!]).toBe("U/M");
    expect(rows).toHaveLength(23);
  });
  it("reads prices the way quotes print them", () => {
    expect(priceFrom("$1,240.50")).toBe(1240.5);
    expect(priceFrom("12.40/ea")).toBe(12.4);
    expect(priceFrom("call")).toBeNull();
    expect(priceFrom("0")).toBeNull();
  });
  it("converts only from what the row states, and says how", () => {
    expect(row(/Type X/).ourPrice).toBe(16.32); // $510 per MSF x 32 sf
    expect(row(/Type X/).how).toMatch(/per MSF = \$16\.32 per 4x8 sheet/);
    expect(row(/Fine Thread/).ourPrice).toBe(8.5); // $42.50 a box of 5,000
    expect(row(/Joint Tape/).ourPrice).toBe(6.95);
    expect(row(/^All Purpose/).ourPrice).toBe(0.35); // $21.40 / 61.7 lb
    expect(row(/^Track 25 GA 6/).ourPrice).toBe(0.64); // $6.40 a 10 ft piece
    expect(row(/R-19/).ourPrice).toBe(0.83); // $62.90 / 75.8 sf
    expect(row(/Lightweight/).ourPrice).toBeNull();
    expect(row(/Lightweight/).how).toMatch(/weight is not stated/);
    expect(row(/Delivery/).key).toBeNull();
  });
  it("a sheet of another size is priced per 4x8 by its area, and an unstated size is refused", () => {
    expect(convert({ description: '5/8" x 4\' x 12\' Type X', unit: "EA", price: 24 }, "board|0.625|x", 500).price).toBe(16);
    expect(convert({ description: '5/8" Type X board', unit: "EA", price: 24 }, "board|0.625|x", 500).price).toBeNull();
  });
});

describe("matching rows to what Baker's estimate needs", () => {
  const plan = planPriceList(rows, BAKER);
  it("prices a material on its own only when exactly one row offers it", () => {
    const keys = plan.matched.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["board|0.625|regular", "board|0.625|x", "tape", "compound", "track|6|25", "deflection|6|25", "insulation|r19"]));
    expect(keys).not.toContain("screws"); // two screw rows
    expect(keys.some((k) => k.startsWith("stud|"))).toBe(false); // studs are priced by length
  });
  it("asks for a pick where several rows offer one material, or a stud length is stated", () => {
    expect(plan.choose.find((c) => c.key === "screws")!.lines).toHaveLength(2);
    expect(plan.choose.find((c) => c.key === "stud|metal|6|25")!.lines).toHaveLength(3);
    expect(plan.choose.find((c) => c.key === "stud|metal|6|25")!.why).toMatch(/length/);
  });
  it("offers rows for a need the drawing left imprecise — no gauge, no R-value — and nothing else", () => {
    const pick = (label: string) => plan.needsPick.find((n) => n.label === label)?.lines.length;
    expect(pick("6in metal stud")).toBe(5); // every 6in stud row, 20 and 25 ga
    expect(pick("6in track, top and bottom")).toBe(2);
    expect(pick("cavity insulation")).toBe(2);
    expect(pick("joint compound")).toBeUndefined(); // already precise: a match, not a pick
  });
  it("keeps everything it cannot price for reference, with the reason", () => {
    const why = (re: RegExp) => plan.reference.find((r) => r.line === row(re).line)?.why;
    expect(why(/Lightweight/)).toMatch(/weight/);
    expect(why(/Delivery/)).toMatch(/not a material/);
    expect(why(/Powder/)).toMatch(/not a material/);
  });
  it("a pick must be one of the offered rows", () => {
    const studs = plan.choose.find((c) => c.key === "stud|metal|6|25")!;
    expect(chosenRows(plan, { byKey: { "stud|metal|6|25": studs.lines[2] }, byGroup: {} })).toEqual(expect.arrayContaining([{ key: "stud|metal|6|25", line: studs.lines[2] }]));
    expect(chosenRows(plan, { byKey: { "stud|metal|6|25": row(/Delivery/).line }, byGroup: {} })).toMatch(/not one of the choices/);
  });
  it("names a priced material so the estimate's own parts find it", () => {
    for (const key of ["board|0.625|x", "track|6|25", "deflection|6|25", "stud|metal|6|25", "insulation|r19", "screws", "tape", "compound"]) {
      expect(materialKey(materialLabelFor(key, 500)), key).toBe(key);
    }
  });
});

describe("the supplier's email for orders, read off their list", () => {
  it("is the address the list prints for orders", () => {
    expect(contactEmailIn(text)).toBe("orders@northgate-supply.example");
  });
  it("is never the buyer's own address, nor one inside the price table", () => {
    expect(contactEmailIn("Acme Supply,,\nCustomer: buyer@sub.example,,\nItem #,Description,Unit Price\nA1,Stud rep@acme.example,4.00")).toBeNull();
    expect(contactEmailIn("Bill to: ap@sub.example\nSales: Lee <lee@acme.example>\nItem,Price\n")).toBe("lee@acme.example");
  });
  it("is nothing when the list prints none", () => {
    expect(contactEmailIn("Item #,Description,Unit Price\nA1,Stud,4.00")).toBeNull();
  });
});

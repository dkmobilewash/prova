import { describe, expect, it } from "vitest";
import { readPartitionAssembly } from "@/lib/takeoff/partitionAssembly";
import { componentRunQuantity } from "@/lib/wall-assemblies";
import { itemGeometry } from "./takeoff-item-lines";
import { completeAssembly } from "./assemblyAccessories";
import { DEFAULT_ASSEMBLY_STANDARDS as STD, standardsFrom } from "./assemblyStandards";
import { catalogByMaterial, catalogFor, materialKey, unpricedMaterials } from "./materialKey";

/** A wall's material lines the way `syncDecidedItems` writes them: the real geometry and the real per-part arithmetic. */
function linesFor(words: string[], wall: { lf: number; heightFt: number; sides: 1 | 2 }, says: { text: string; source: string; part: "board" | "framing" }[] = []) {
  const read = readPartitionAssembly({ lines: words, where: "test" });
  const spacing = read.read.studSpacingIn ?? STD.studSpacingIn;
  const done = completeAssembly({ components: read.components, lines: words, says, standards: STD, spacingFromStandard: read.read.studSpacingIn === null });
  const geometry = itemGeometry({
    id: "i", name: "T", type: "LINEAR", heightFt: wall.heightFt, sides: wall.sides, wastePercent: null, depthIn: null, wallTypeId: "t", studSpacingIn: spacing,
    measurements: [{ id: "m", pageNumber: 1, kind: "LINEAR", xs: [0, wall.lf / 1000], ys: [0, 0], feetPerPageWidth: 1000 }],
  });
  const out: Record<string, number> = {};
  for (const c of done.components) {
    const raw = componentRunQuantity({ id: "c", description: c.description, unit: c.unit, basis: c.basis, factor: c.factor, wastePercent: c.wastePercent, roundUp: c.roundUp, productionRate: null }, geometry);
    out[c.description] = c.roundUp ? Math.ceil(raw) : Math.round(raw * 100) / 100;
  }
  return { out, done, geometry };
}
const find = (out: Record<string, number>, re: RegExp) => Object.entries(out).find(([k]) => re.test(k))?.[1];

describe("an invented single-layer partition, checked by hand", () => {
  // 3-5/8in metal studs, no spacing printed, one layer of 5/8 type X each side; 100 LF at 9 ft.
  const words = ['3-5/8" METAL STUD FRAMING', '(1) LAYER 5/8" TYPE X GYPSUM BOARD EACH SIDE'];
  const { out, geometry } = linesFor(words, { lf: 100, heightFt: 9, sides: 2 });
  it("reads the wall the hand check assumes", () => {
    expect(geometry.linearFt).toBeCloseTo(100, 6);
    expect(geometry.boardedSqFt).toBeCloseTo(1800, 6);
  });
  // By hand: studs ceil(100 / (16/12)) + 1 = 76, +5% = 79.8 → 80. Track 2 x 100 = 200, +5% = 210.
  // Board 1800 sf / 32 = 56.25 sheets, +10% = 61.875 → 62. Screws 1800 x 1, +5% = 1890 = 1.89 per thousand.
  // Tape 1800 x 0.37 = 666, +5% = 699.3 → 700. Compound 1800 x 0.14 = 252, +5% = 264.6 → 265.
  const hand: [RegExp, number][] = [[/metal stud/, 80], [/track/, 210], [/gypsum board/, 62], [/screws/, 1.89], [/tape/, 700], [/compound/, 265]];
  for (const [re, want] of hand) it(`${re.source} is ${want}`, () => expect(find(out, re)).toBe(want));
  it("says the spacing is the company's standard, not the drawing's", () => {
    expect(Object.keys(out).find((k) => /metal stud/.test(k))).toMatch(/16in o\.c\. \(your standard; not on the drawing\)/);
  });
  it("changing the height changes every board-driven quantity", () => {
    const taller = linesFor(words, { lf: 100, heightFt: 10, sides: 2 }).out;
    // 2000 sf / 32 x 1.1 = 68.75 → 69 sheets; screws 2,100 = 2.1 M; compound 280 x 1.05 = 294.
    expect(find(taller, /gypsum board/)).toBe(69);
    expect(find(taller, /screws/)).toBe(2.1);
    expect(find(taller, /compound/)).toBe(294);
    expect(find(taller, /metal stud/)).toBe(80); // studs follow length, not height
  });
});

describe("what the legend leaves out, from the spec", () => {
  const words = ['6" METAL STUD', '5/8" GYPSUM BOARD EACH SIDE', "EXTEND TO UNDERSIDE OF DECK"];
  it("fills the gauge, Type X and Level 5 from the spec and says where each came from", () => {
    const { done } = linesFor(words, { lf: 10, heightFt: 10, sides: 2 }, [
      { text: "20 ga studs", source: "09 22 16", part: "framing" },
      { text: "Type X board", source: "09 29 00", part: "board" },
      { text: "Level 5 finish", source: "09 29 00", part: "board" },
    ]);
    const d = done.components.map((c) => c.description);
    expect(d.find((x) => /stud/.test(x) && !/track/.test(x))).toMatch(/20 ga \(spec 09 22 16\)/);
    expect(d.find((x) => /gypsum/.test(x))).toMatch(/type X gypsum board \(spec 09 29 00\)/);
    expect(d.find((x) => /compound/.test(x))).toMatch(/Level 5 skim/);
    expect(done.conflicts).toEqual([]);
  });
  it("a wall to the deck gets a bottom track and a deflection track, not two plain tracks", () => {
    const { out } = linesFor(words, { lf: 10, heightFt: 10, sides: 2 });
    expect(find(out, /deflection track, top/)).toBeCloseTo(10.5, 6);
    expect(find(out, /track, bottom/)).toBeCloseTo(10.5, 6);
    expect(find(out, /track, top and bottom/)).toBeUndefined();
  });
  it("a legend lighter than the spec keeps the legend and is flagged", () => {
    const { done } = linesFor(['6" 25 GA METAL STUD @ 16" O.C.', '5/8" GYPSUM BOARD EACH SIDE'], { lf: 10, heightFt: 10, sides: 2 }, [{ text: "20 ga studs", source: "09 22 16", part: "framing" }]);
    expect(done.components.find((c) => /stud/.test(c.description))!.description).toMatch(/25 ga/);
    expect(done.conflicts[0]).toMatch(/legend says 25 ga.*spec \(09 22 16\) says 20 ga/);
  });
  it("names corner bead as a person's job rather than guessing it", () => {
    expect(linesFor(words, { lf: 10, heightFt: 10, sides: 2 }).done.needsPerson.join(" ")).toMatch(/Corner bead/);
  });
});

describe("prices come only from the company's own catalog", () => {
  it("a part takes the entry for the same material in the same unit, and nothing else", () => {
    const catalog = catalogByMaterial([
      { id: "x58", description: '5/8" Type X Gypsum Board 4x8', unit: "sheet" },
      { id: "r58", description: '5/8" Gypsum Board 4x8', unit: "SHT" },
      { id: "sf", description: '1/2" Gypsum Board', unit: "SF" },
      { id: "stud", description: '6" metal stud 20 ga', unit: "EA" },
    ]);
    expect(catalogFor(catalog, { description: "5/8in type X gypsum board, 4x8 sheets", unit: "SHT" })).toBe("x58");
    expect(catalogFor(catalog, { description: "5/8in gypsum board, 4x8 sheets", unit: "SHT" })).toBe("r58");
    expect(catalogFor(catalog, { description: "1/2in gypsum board, 4x8 sheets", unit: "SHT" })).toBeNull(); // priced per SF, not per sheet
    expect(catalogFor(catalog, { description: "6in metal stud, 25 ga", unit: "EA" })).toBeNull(); // another gauge
    expect(catalogFor(catalog, { description: "6in metal stud", unit: "EA" })).toBeNull(); // gauge unknown: never a guess
  });
  it("two entries for one material price neither", () => {
    const catalog = catalogByMaterial([
      { id: "a", description: "Drywall screws 1-1/4 (1000)", unit: "M" },
      { id: "b", description: "Type S screws per thousand", unit: "m" },
    ]);
    expect(catalogFor(catalog, { description: "drywall screws, Type S, per 1,000", unit: "M" })).toBeNull();
  });
  it("reads the materials a legend and a price book write", () => {
    expect(materialKey("3-5/8in metal stud, 20 ga at 16in o.c.")).toBe("stud|metal|3.625|20");
    expect(materialKey('6" deflection track, top, 20 ga')).toBe("deflection|6");
    expect(materialKey("cavity insulation, R-19")).toBe("insulation|r19");
  });
  it("lists each unpriced material once, however many walls use it", () => {
    const rows = unpricedMaterials([
      { id: "1", description: "S6B — 5/8in type X gypsum board, 4x8 sheets", unit: "SHT", quantity: 83 },
      { id: "2", description: "S8C — 5/8in type X gypsum board, 2 layers per side, 4x8 sheets", unit: "SHT", quantity: 40 },
      { id: "3", description: "S6B — joint tape", unit: "LF", quantity: 933 },
    ]);
    expect(rows.map((r) => [r.lineIds.join(","), r.quantity])).toEqual([["1,2", 123], ["3", 933]]);
  });
});

it("stored standards: missing or out-of-range values take the default; board waste follows the company's own figure", () => {
  const s = standardsFrom({ wastePercent: { studs: 3, tape: 99 }, screwsPerSqFt: 1.2, studSpacingIn: 13 }, 12);
  expect(s.wastePercent).toMatchObject({ studs: 3, tape: 5, board: 12 });
  expect(s.screwsPerSqFt).toBe(1.2);
  expect(s.studSpacingIn).toBe(16);
});

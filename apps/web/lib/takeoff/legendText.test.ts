import { describe, expect, it } from "vitest";
import { readLegendFromText, textLines, wallTagCodes } from "./legendText";
import { readPartitionAssembly } from "./partitionAssembly";

/** A text item at (x, baseline y), width from its length — the shape the page reader returns. */
const t = (str: string, x: number, y: number, h = 7) => ({ str, x, y, width: str.length * h * 0.6, height: h });
const PAGE = { widthPt: 2592, heightPt: 1728 };

describe("text lines are cells, not page rows", () => {
  it("joins words on one baseline and keeps a neighbouring detail's words apart", () => {
    const lines = textLines([t("5/8\"", 100, 200), t("GYP. BD.", 122, 200), t("6\" MTL. STUDS", 900, 200)]);
    expect(lines.map((l) => l.text)).toEqual(["5/8\" GYP. BD.", "6\" MTL. STUDS"]);
  });
});

describe("a legend of details: each code with the words around its section (Green Bay's shape)", () => {
  // Three details side by side, the code under each, its notes above.
  const detail = (code: string, x: number, stud: string) => [
    t("5/8\" GYPSUM BOARD, EACH SIDE", x, 300),
    t(`${stud} 20 GA. MTL. STUD FRAMING @ 16" O.C.`, x, 312),
    t("ASSEMBLY WIDTH 4 7/8\"", x, 324),
    t(code, x + 20, 380, 10),
  ];
  const items = [...detail("IW-1", 200, "3 5/8\""), ...detail("IW-2", 650, "6\""), ...detail("IW-3", 1100, "3 5/8\""), t("PARTITIONS ARE TYPE IW-1 UNLESS OTHERWISE INDICATED.", 200, 900)];
  const read = readLegendFromText({ items, ...PAGE });

  it("reads every code, each with its own words and none of its neighbour's", () => {
    expect(read.types.map((x) => x.code)).toEqual(["IW-1", "IW-2", "IW-3"]);
    const iw2 = read.types.find((x) => x.code === "IW-2")!;
    expect(iw2.lines).toEqual(["5/8\" GYPSUM BOARD, EACH SIDE", "6\" 20 GA. MTL. STUD FRAMING @ 16\" O.C.", "ASSEMBLY WIDTH 4 7/8\""]);
  });
  it("the assembly reads off those words as off the model's", () => {
    const r = readPartitionAssembly({ lines: read.types[1]!.lines, where: "test" }).read;
    expect(r).toMatchObject({ studWidthIn: 6, studGauge: 20, studSpacingIn: 16, boardThicknessIn: 0.625 });
  });
  it("the page's U.N.O. names the default", () => {
    expect(read.uno).toEqual([{ code: "IW-1", note: expect.stringMatching(/^PARTITIONS ARE TYPE IW-1 UNLESS/) }]);
  });
});

describe("a key: the code, then its words on the same row (K-4's plan margin)", () => {
  const items = [
    t("S1", 2000, 100), t("3 5/8\" STL. STUD WALL CONSTRUCTION", 2040, 100), t("WITH ONE LAYER GWB ON ONE SIDE.", 2040, 110),
    t("S2", 2000, 130), t("6\" STL. STUD WALL CONSTRUCTION WITH", 2040, 130), t("(2) LAYERS GWB EACH SIDE.", 2040, 140),
    t("M8", 2000, 160), t("8\" CMU WALL CONSTRUCTION WITH GYP BD FURRING.", 2040, 160),
  ];
  it("each code owns its row and its wrapped line", () => {
    const read = readLegendFromText({ items, ...PAGE });
    expect(read.types.map(({ at: _at, evidence: _evidence, ...type }) => type)).toEqual([
      { code: "S1", name: null, lines: ["3 5/8\" STL. STUD WALL CONSTRUCTION", "WITH ONE LAYER GWB ON ONE SIDE."] },
      { code: "S2", name: null, lines: ["6\" STL. STUD WALL CONSTRUCTION WITH", "(2) LAYERS GWB EACH SIDE."] },
      { code: "M8", name: null, lines: ["8\" CMU WALL CONSTRUCTION WITH GYP BD FURRING."] },
    ]);
  });
});

describe("a schedule: rated codes in a column (ELEVEN03's TAG | UL# | RATING)", () => {
  const items = ["MA", "MB", "MC", "WA"].flatMap((code, i) => [t(code, 2100, 300 + i * 40, 10), t(`U4${60 + i}`, 2213, 300 + i * 40, 10), t(i % 2 ? "NR" : "1 HR", 2280, 300 + i * 40, 10)]);
  it("reads a two-letter code only as a schedule row", () => {
    const read = readLegendFromText({ items, ...PAGE });
    expect(read.types.map((x) => [x.code, x.lines.join(" | ")])).toEqual([
      ["MA", "U460 | 1 HR"],
      ["MB", "U461 | NR"],
      ["MC", "U462 | 1 HR"],
      ["WA", "U463 | NR"],
    ]);
  });
});

describe("what is not a type", () => {
  const legend = [
    t("WALL TYPE 1 - NON-RATED", 200, 300), t("3 5/8\" MTL. STUDS @ 16\" O.C.", 200, 320), t("5/8\" GYP. BD. EACH SIDE", 200, 332),
    t("WALL TYPE 2 - FURRING", 700, 300), t("1 5/8\" MTL. STUD FURRING", 700, 320), t("5/8\" GYP. BD. ONE SIDE", 700, 332),
    t("WALL TYPE 3 - SOUND", 1200, 300), t("6\" MTL. STUDS @ 16\" O.C.", 1200, 320), t("BATT INSULATION, 5/8\" GYP. BD.", 1200, 332),
  ];
  it("a labelled number is a code, with its name", () => {
    const read = readLegendFromText({ items: legend, ...PAGE });
    expect(read.types.map((x) => [x.code, x.name])).toEqual([["1", "NON-RATED"], ["2", "FURRING"], ["3", "SOUND"]]);
  });
  it("a bare number beside assembly words is a section bubble, not a type", () => {
    const read = readLegendFromText({ items: [...legend, t("4", 1600, 300, 12), t("6\" MTL. STUDS", 1600, 320), t("5/8\" GYP. BD.", 1600, 332)], ...PAGE });
    expect(read.types.map((x) => x.code)).toEqual(["1", "2", "3"]);
  });
  it("a page with fewer than three types is a plan or a detail sheet, read as none", () => {
    const read = readLegendFromText({ items: legend.slice(0, 6), ...PAGE });
    expect(read.types).toEqual([]);
  });
});

describe("Joplin's U.N.O., the sentence written the other way round", () => {
  const items = [
    t("A", 200, 380, 10), t("3 5/8\" MTL. STUDS @ 16\" O.C.", 200, 300), t("5/8\" GYP. BD. EACH SIDE", 200, 312),
    t("B", 700, 380, 10), t("8\" CMU", 700, 300), t("MASONRY PARTITION, GYP BD FURRING", 700, 312),
    t("C", 1200, 380, 10), t("6\" MTL. STUDS @ 16\" O.C.", 1200, 300), t("5/8\" GYP. BD. EACH SIDE", 1200, 312),
    t("UNLESS NOTED OTHERWISE ON THE FLOOR PLAN, ALL INTERIOR DRYWALL PARTITIONS", 200, 900),
    t("INDICATED ON THE FLOOR PLAN DRAWING ARE TYPE 'A' PARTITIONS.", 200, 912),
  ];
  // Joplin boxes its letters; a box is the symbol `tagSymbols` finds.
  const symbols = [{ x: 203, y: 376, radius: 9 }, { x: 703, y: 376, radius: 9 }, { x: 1203, y: 376, radius: 9 }];
  it("names A, and three boxed letters are the types", () => {
    const read = readLegendFromText({ items, ...PAGE, symbols });
    expect(read.types.map((x) => x.code)).toEqual(["A", "B", "C"]);
    expect(read.uno.map((u) => u.code)).toEqual(["A"]);
  });
  it("without the boxes a letter is a grid line, and nothing is read", () => {
    expect(readLegendFromText({ items, ...PAGE }).types).toEqual([]);
  });
});

describe("v2 layouts", () => {
  it("INLINE: the code starts a line that describes its assembly (Wendell's partition legend)", () => {
    const items = [
      t("S4 3 5/8\" MTL STUD & GYP BD TO DECK (STC 43-45)", 1500, 400),
      t("S6 6\" MTL STUD & GYP BD TO DECK (STC 45-47)", 1500, 430),
      t("F2 2 1/2\" FURRING & GYP BD TO DECK", 2100, 400),
      t("NOTES: 1. BRACE METAL STUDS AS PER MANUFACTURER", 1500, 470),
    ];
    const read = readLegendFromText({ items, ...PAGE });
    expect(read.types.map((x) => [x.code, x.evidence?.how])).toEqual([["S4", "inline"], ["F2", "inline"], ["S6", "inline"]]);
    expect(read.types[0]!.lines).toEqual(["3 5/8\" MTL STUD & GYP BD TO DECK (STC 43-45)"]);
  });
  it("a digit-led code with letters inside (cmb's 0SF1B) and a dash-numbered one (SW2-1) are codes", () => {
    const items = ["0SF1B", "1SW4", "SW2-1"].flatMap((code, i) => [t(code, 2000, 100 + i * 30), t("3 5/8\" MTL STUDS @ 16\" O.C. W/ 5/8\" GYP BD", 2040, 100 + i * 30)]);
    expect(readLegendFromText({ items, ...PAGE }).types.map((x) => x.code)).toEqual(["0SF1B", "1SW4", "SW2-1"]);
  });
});

describe("the guard: a text-read code types walls only where the sheet prints it as a wall tag (`wallTagCodes`)", () => {
  // Page-width units for walls; points for text and strokes; 2592 pt wide, 1/8" scale (288 ft per unit).
  const W = 2592, fpu = 288;
  const wall = { x1: 0.2, y1: 0.3, x2: 0.4, y2: 0.3 };
  const at = (str: string, x: number, y: number) => ({ str, x: x - 6, y: y + 3.5, width: 12, height: 7 });
  const circle = (cx: number, cy: number, r = 10) => Array.from({ length: 16 }, (_, k) => {
    const a = (2 * Math.PI * k) / 16, b = (2 * Math.PI * (k + 1)) / 16;
    return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b) };
  });
  const run = (text: ReturnType<typeof at>[], segments: { x1: number; y1: number; x2: number; y2: number }[] = []) =>
    [...wallTagCodes({ text, segments, walls: [wall], widthPt: W, feetPerUnit: fpu, codes: ["S6B", "A1", "B3"] })].sort();
  it("a code printed beside a wall is a tag; the same code beside a sheet number (a callout) is not", () => {
    const y = 0.3 * W - 4; // a foot or two off the wall
    expect(run([at("S6B", 0.3 * W, y)])).toEqual(["S6B"]);
    expect(run([at("A1", 0.3 * W, y), at("A-501", 0.3 * W, y + 14)])).toEqual([]);
  });
  it("a code far from every wall (a note, the legend itself) is not a tag", () => {
    expect(run([at("S6B", 0.9 * W, 0.9 * W)])).toEqual([]);
  });
  it("a code in a circle a grid line runs into is a grid bubble, not a tag", () => {
    const cx = 0.3 * W, cy = 0.3 * W - 4;
    const gridLine = { x1: cx, y1: cy + 10, x2: cx, y2: cy + 400 };
    expect(run([at("B3", cx, cy)], [...circle(cx, cy), gridLine])).toEqual([]);
    expect(run([at("B3", cx, cy)], circle(cx, cy))).toEqual(["B3"]);
  });
});

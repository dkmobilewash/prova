import { describe, expect, it } from "vitest";
import { readLegendFromText, textLines } from "./legendText";
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
    expect(read.types).toEqual([
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

import { describe, expect, it } from "vitest";
import { symbolTagSentence, tagsFromSymbols } from "./symbolTagging";
import type { TagSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";

/**
 * Camp Bow Wow's numbers throughout: its legend defines A–E in SQUARE symbols,
 * and its A101 carries 133 symbols that could be tags — most of them door
 * marks (`101A`, `103`, `116`) drawn in the same square. The shape cannot
 * separate them; the legend's vocabulary can.
 */
const WIDTH_PT = 2592;
const FEET_PER_UNIT = 288;

function symbol(text: string, over: Partial<TagSymbol> = {}): TagSymbol {
  return {
    x: 100,
    y: 100,
    radius: 15,
    corners: 4,
    shape: "square",
    text,
    parts: [text],
    split: false,
    leader: null,
    rejected: null,
    ...over,
  };
}

/** A run whose midpoint sits where the tag does, in page-width units. */
function runAt(xPt: number, yPt: number, lengthFeet = 20): WallCandidate {
  const x = xPt / WIDTH_PT;
  const y = yPt / WIDTH_PT;
  const half = lengthFeet / 2 / FEET_PER_UNIT;
  return {
    x1: x - half,
    y1: y,
    x2: x + half,
    y2: y,
    lengthFeet,
    thicknessFeet: 0.5,
  } as WallCandidate;
}

describe("turning symbols into wall-type tags", () => {
  it("keeps a code the legend defines and drops one it does not", () => {
    const got = tagsFromSymbols({
      symbols: [symbol("A"), symbol("REF.", { x: 400 }), symbol("101A", { x: 800 })],
      legendCodes: ["A", "B", "C", "D", "E"],
      shape: "square",
      walls: [],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.tags.map((t) => t.name)).toEqual(["A"]);
    expect(got.unknownCodes.map((u) => u.code)).toEqual(expect.arrayContaining(["REF.", "101A"]));
  });

  it("matches a tag to the run beneath it", () => {
    const wall = runAt(100, 100);
    const got = tagsFromSymbols({
      symbols: [symbol("A")],
      legendCodes: ["A"],
      shape: "square",
      walls: [wall],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.byRun.get(wall)).toBe("A");
    expect(got.counts.matchedToRun).toBe(1);
  });

  it("reports an odd-shaped symbol rather than hiding it", () => {
    // A set that legends in squares and tags one wall in a hexagon has done
    // something a reader should see. Filtering it away chooses silence over a
    // question.
    const got = tagsFromSymbols({
      symbols: [symbol("B", { shape: "hexagon", corners: 6 })],
      legendCodes: ["A", "B"],
      shape: "square",
      walls: [],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.tags).toHaveLength(0);
    expect(got.oddShape).toEqual([{ code: "B", shape: "hexagon" }]);
    expect(got.counts.ambiguous).toBeGreaterThan(0);
  });

  it("uses no shape at all when the legend taught none", () => {
    // `shapeFromLegend` returns null where nothing dominated, and a null must
    // mean "do not filter" rather than "filter against null".
    const got = tagsFromSymbols({
      symbols: [symbol("A", { shape: "hexagon" }), symbol("B", { x: 400, shape: "circle" })],
      legendCodes: ["A", "B"],
      shape: null,
      walls: [],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.tags.map((t) => t.name).sort()).toEqual(["A", "B"]);
    expect(got.oddShape).toEqual([]);
  });

  it("ignores a symbol the detector already rejected", () => {
    const got = tagsFromSymbols({
      symbols: [symbol("A", { rejected: "code-too-long" }), symbol("A", { x: 400, rejected: "sheet-reference" })],
      legendCodes: ["A"],
      shape: "square",
      walls: [],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.tags).toHaveLength(0);
    expect(got.counts.couldBeTags).toBe(0);
  });

  it("matches a code case-insensitively", () => {
    const got = tagsFromSymbols({
      symbols: [symbol("a")],
      legendCodes: ["A"],
      shape: "square",
      walls: [],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.tags.map((t) => t.name)).toEqual(["A"]);
  });

  it("counts a legend tag that labelled no run as left over", () => {
    // 35 tags naming a legend type and 7 matched to a run is the real
    // measurement on A101. The gap is the number worth watching, so it has to
    // be reported rather than implied by two other figures.
    const got = tagsFromSymbols({
      symbols: [symbol("A"), symbol("A", { x: 2000, y: 2000 })],
      legendCodes: ["A"],
      shape: "square",
      walls: [runAt(100, 100)],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.counts.knownToLegend).toBe(2);
    expect(got.counts.matchedToRun).toBe(1);
    expect(got.counts.ambiguous).toBe(1);
  });

  it("says so plainly when a sheet has no symbols at all", () => {
    const got = tagsFromSymbols({
      symbols: [],
      legendCodes: ["A"],
      shape: "square",
      walls: [],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(symbolTagSentence(got)).toBe("No tag symbols were found on this sheet.");
  });

  it("reads as an estimator would say it", () => {
    const got = tagsFromSymbols({
      symbols: [symbol("A"), symbol("REF.", { x: 900 })],
      legendCodes: ["A"],
      shape: "square",
      walls: [runAt(100, 100)],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(symbolTagSentence(got)).toBe(
      "2 symbols, 2 could be tags, 1 name a type the legend defines, 1 were matched to a run.",
    );
  });
});

describe("split codes and leaders", () => {
  it("names the tag by whichever half the legend knows", () => {
    // ELEVEN03: `MC` over `1 HR` in one box. The legend defines MC.
    const got = tagsFromSymbols({
      symbols: [symbol("MC 1 HR", { parts: ["MC", "1 HR"], split: true })],
      legendCodes: ["MA", "MC", "WS"],
      shape: null,
      walls: [runAt(100, 100 + 2.5 * (WIDTH_PT / FEET_PER_UNIT))],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(got.tags.map((t) => t.name)).toEqual(["MC"]);
    expect(got.counts.matchedToRun).toBe(1);
  });

  it("anchors a tag at its leader's end, which picks the wall the drafter pointed at", () => {
    // Two parallel runs, 2.5 ft and 3.5 ft from the symbol's centre — a coin
    // flip by distance, which the clear-margin rule refuses. The leader lands
    // on the farther one.
    const ftPt = WIDTH_PT / FEET_PER_UNIT;
    const nearRun = runAt(100, 100 - 2.5 * ftPt);
    const farRun = runAt(100, 100 + 3.5 * ftPt);
    const without = tagsFromSymbols({
      symbols: [symbol("A")],
      legendCodes: ["A"],
      shape: null,
      walls: [nearRun, farRun],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(without.counts.matchedToRun).toBe(0);
    const withLeader = tagsFromSymbols({
      symbols: [symbol("A", { leader: { x: 100, y: 100 + 3.5 * ftPt } })],
      legendCodes: ["A"],
      shape: null,
      walls: [nearRun, farRun],
      feetPerUnit: FEET_PER_UNIT,
      widthPt: WIDTH_PT,
    });
    expect(withLeader.counts.matchedToRun).toBe(1);
    expect(withLeader.byRun.get(farRun)).toBe("A");
    expect(withLeader.counts.matchedByLeader).toBe(1);
    expect(symbolTagSentence(withLeader)).toContain("1 by their leader");
  });
});

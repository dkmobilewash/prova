import { describe, expect, it } from "vitest";
import { isPropagatedTag, plainTag, planTextTagByRun, propagatedTag } from "./planTextTags";
import { sameDesignation } from "./wallTypeMatch";
import { wallTypeTags } from "./wallTags";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

const W = 1000; // points across the sheet
const FPU = 100; // feet per page width: 0.01 = 1 ft = 10 pt

function square(cx: number, cy: number, half: number): StrokeSegment[] {
  const c = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
  return c.map(([x1, y1], i) => {
    const [x2, y2] = c[(i + 1) % 4];
    return { x1, y1, x2, y2, width: 0.5 };
  });
}
const run = (x1: number, y1: number, x2: number, y2: number): WallCandidate => ({
  x1,
  y1,
  x2,
  y2,
  thicknessFeet: 0.4,
  lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU,
});

describe("the propagation marker", () => {
  it("survives sameDesignation, so a propagated group still prices as its code", () => {
    expect(sameDesignation("IW-2", propagatedTag("IW-2"))).toBe(true);
    expect(isPropagatedTag(propagatedTag("A"))).toBe(true);
    expect(isPropagatedTag("A")).toBe(false);
    expect(plainTag(propagatedTag("P08"))).toBe("P08");
  });
});

describe("the run-to-type map from the drawing's own symbols", () => {
  // A wall along y=500pt (0.5 page-width) in three runs; a square symbol
  // holding `A` sits 1 ft above the middle run; the legend defines A and B.
  const walls = [run(0.1, 0.5, 0.3, 0.5), run(0.3, 0.5, 0.5, 0.5), run(0.5, 0.5, 0.7, 0.5)];
  const text = [{ str: "A", x: 395, y: 494, width: 10, height: 8 }];
  const segments = square(400, 490, 9);

  it("tags the run under the symbol and carries the type along the wall, marked", () => {
    const got = planTextTagByRun({ segments, text, widthPt: W, walls, feetPerUnit: FPU, legendCodes: ["A", "B"], textTags: [], wallTypes: [] });
    expect(got.byRun.get(walls[1])).toBe("A");
    expect(got.byRun.get(walls[0])).toBe(propagatedTag("A"));
    expect(got.byRun.get(walls[2])).toBe(propagatedTag("A"));
    expect(got.report).toMatchObject({ coded: 1, direct: 1, propagated: 2, conflicts: 0, shape: "square" });
  });

  it("offers nothing for a symbol whose code the legend does not define", () => {
    const got = planTextTagByRun({ segments, text, widthPt: W, walls, feetPerUnit: FPU, legendCodes: ["B"], textTags: [], wallTypes: [] });
    expect(got.byRun.size).toBe(0);
  });

  it("still takes a bare code beside a run, and the company's text tags", () => {
    const bare = [{ str: "B", x: 595, y: 494, width: 10, height: 8 }];
    const got = planTextTagByRun({
      segments: [],
      text: bare,
      widthPt: W,
      walls: [walls[2]],
      feetPerUnit: FPU,
      legendCodes: ["B"],
      textTags: [{ name: "EXT-1", x: 0.2, y: 0.5 }],
      wallTypes: [],
    });
    expect(got.byRun.get(walls[2])).toBe("B");
    expect(got.report.bareText).toBe(1);
  });
});

describe("a detail callout is not a wall tag", () => {
  it("drops a text tag that sits inside a symbol the symbol pass rejected as a sheet reference", () => {
    // A 10 ft wall along y = 100 pt, and "A3" printed inside a split circle
    // with "A-621" under it, 2 ft off the wall — detail A3 on sheet A-621.
    const W = 1000;
    const walls = [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.1, thicknessFeet: 0.4, lengthFeet: 10 }];
    const circle = (cx: number, cy: number, r: number) => Array.from({ length: 32 }, (_, i) => {
      const a0 = (i / 32) * 2 * Math.PI, a1 = ((i + 1) / 32) * 2 * Math.PI;
      return { x1: cx + r * Math.cos(a0), y1: cy + r * Math.sin(a0), x2: cx + r * Math.cos(a1), y2: cy + r * Math.sin(a1) };
    });
    const segments = [...circle(150, 120, 12), { x1: 138, y1: 120, x2: 162, y2: 120 }];
    const text = [
      { str: "A3", x: 144, y: 118, width: 12, height: 6 },
      { str: "A-621", x: 140, y: 129, width: 20, height: 6 },
    ];
    const types = [{ id: "a3", code: "A3", name: "A3", hasParts: true, thicknessIn: null }];
    const textTags = wallTypeTags(text, W);
    expect(textTags.map((t) => t.name)).toContain("A3");
    const got = planTextTagByRun({ segments, text, widthPt: W, walls, feetPerUnit: 100, legendCodes: ["A3"], textTags, wallTypes: types });
    expect(got.byRun.size).toBe(0);
    // The same text printed loose beside the wall is a tag.
    const loose = planTextTagByRun({ segments: [], text: [text[0]!], widthPt: W, walls, feetPerUnit: 100, legendCodes: ["A3"], textTags: wallTypeTags([text[0]!], W), wallTypes: types });
    expect(loose.byRun.get(walls[0]!)).toBe("A3");
    // A section marker with no shape at all: "B4/" and "A-621" side by side is a callout too.
    const marker = [{ str: "B4/", x: 144, y: 118, width: 14, height: 6 }, { str: "A-621", x: 160, y: 118, width: 20, height: 6 }];
    const section = planTextTagByRun({ segments: [], text: marker, widthPt: W, walls, feetPerUnit: 100, legendCodes: ["B4"], textTags: wallTypeTags(marker, W), wallTypes: [{ ...types[0]!, code: "B4" }] });
    expect(section.byRun.size).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { insideBoxes, titleBlockRegions } from "./titleBlock";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * prereg-not-drawing-v2.md, on invented geometry. A 1000 x 700 pt sheet: a border frame, a
 * full-height rule at x = 800 dividing off a title column with title words, and a plan to the left.
 */
const W = 1000;
const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2, width: 0.7, gray: 0 });
const word = (str: string, x: number, y: number, height = 6) => ({ str, x, y, width: str.length * height * 0.6, height });
const frame = [seg(5, 5, 995, 5), seg(5, 695, 995, 695), seg(5, 5, 5, 695), seg(995, 5, 995, 695)];
const divider = seg(800, 8, 800, 692);
const titleWords = [word("Drawn: AH", 810, 100), word('SCALE: 3/16" = 1\'-0"', 810, 300), word("Sheet #", 810, 600), word("A105", 820, 640, 12)];

describe("the title block is read off the sheet's own ruled boundary", () => {
  it("finds the strip right of the leftmost qualifying full-height rule", () => {
    const boxes = titleBlockRegions([...frame, divider], titleWords, W);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].from).toBeCloseTo(0.8, 5);
    expect(boxes[0].to).toBe(1);
  });

  it("a rule with no title words beyond it, or too short a rule, is not a boundary", () => {
    expect(titleBlockRegions([...frame, divider], [word("KITCHEN", 810, 100)], W)).toHaveLength(0);
    expect(titleBlockRegions([...frame, seg(800, 200, 800, 650)], titleWords, W), "spans half the page, not 0.85").toHaveLength(0);
  });

  it("SCALE and DATE are not title words: two of them alone qualify nothing", () => {
    const ambient = [word('SCALE: 1/4" = 1\'-0"', 810, 100), word("DATE 4.25.18", 810, 300)];
    expect(titleBlockRegions([...frame, divider], ambient, W)).toHaveLength(0);
  });

  it("stacked panel borders at one x chain into one boundary (Old Town Hall's shape)", () => {
    const pieces = [seg(800, 8, 800, 150), seg(800, 155, 800, 400), seg(800, 404, 800, 690)];
    expect(titleBlockRegions([...frame, ...pieces], titleWords, W)).toHaveLength(1);
    const gappy = [seg(800, 8, 800, 150), seg(800, 300, 800, 690)];
    expect(titleBlockRegions([...frame, ...gappy], titleWords, W), "a 150 pt hole is not a chain").toHaveLength(0);
  });

  it("the RIGHTMOST qualified chain wins: a plan's own full-height line left of the words is not the boundary (K-4's shape)", () => {
    // Two qualifying chains: the plan's long vertical at 720 and the title divider at 880. Title
    // words sit right of both; the strip must start at 880 so the plan tail (720-880) stays.
    const planChain = seg(720, 8, 720, 692);
    const divider = seg(880, 8, 880, 692);
    const words = [word("Drawn: AH", 890, 100), word("Sheet A3.10", 890, 600)];
    const boxes = titleBlockRegions([...frame, planChain, divider], words, W);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].from).toBeCloseTo(0.88, 5);
  });

  it("a bottom title band: the highest qualifying full-width rule in the bottom 15%", () => {
    const band = seg(8, 620, 992, 620);
    const below = [word("PROJECT NO. 22034", 100, 650), word("REVISIONS", 400, 650)];
    const boxes = titleBlockRegions([...frame, band], below, W);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].fromY).toBeCloseTo(0.62, 5);
  });

  it("insideBoxes needs BOTH ends inside", () => {
    const boxes = [{ from: 0.8, to: 1, fromY: 0, toY: 0.7 }];
    expect(insideBoxes(boxes, 0.85, 0.1, 0.95, 0.1)).toBe(true);
    expect(insideBoxes(boxes, 0.75, 0.1, 0.95, 0.1), "one end on the plan side").toBe(false);
  });
});

describe("behind NOT_DRAWING, runs in the title block are set aside on the customer list — and text-block boxes are NOT (v3)", () => {
  const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate => ({ x1, y1, x2, y2, thicknessFeet: 0.5, lengthFeet: (Math.hypot(x2 - x1, y2 - y1) * 100) }) as WallCandidate;
  const plan = wall(0.1, 0.3, 0.4, 0.3);
  const inTitle = wall(0.82, 0.2, 0.95, 0.2);
  const inNotes = wall(0.62, 0.1, 0.74, 0.1);
  const sheet = (textBlocks: { from: number; to: number; fromY: number; toY: number }[]) => ({
    walls: [plan, inTitle, inNotes],
    segments: [] as StrokeSegment[],
    pageSegments: [...frame, divider],
    widthPt: W,
    feetPerUnit: 100,
    planBoxes: null,
    textBlocks,
    textItems: titleWords,
  });
  const blocks = [{ from: 0.6, to: 0.76, fromY: 0.05, toY: 0.5 }];

  it("flag on: the title run goes, the text-block run STAYS (rule B removed, Joplin's 732 ft); flag off: today", async () => {
    vi.stubEnv("NEXT_PUBLIC_TAKEOFF_NOT_DRAWING", "1");
    vi.resetModules();
    const on = (await import("./offeredCandidates")).offeredCandidates(sheet(blocks));
    vi.unstubAllEnvs();
    vi.resetModules();
    expect(on.offeredRuns).toEqual([plan, inNotes]);
    expect(on.setAsideLines.filter((l) => l.kind === "title-block")).toHaveLength(1);
    expect(on.setAsideLines.filter((l) => l.kind === "notes-column")).toHaveLength(0);
    const off = (await import("./offeredCandidates")).offeredCandidates(sheet(blocks));
    expect(off.offeredRuns).toEqual([plan, inTitle, inNotes]);
  });
});

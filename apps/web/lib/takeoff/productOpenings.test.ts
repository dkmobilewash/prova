import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openingInputs, sheetIsRenovation } from "./productOpenings";

/**
 * ── DOOR AND WINDOW TRAINING ROWS ARE BUILT ON THE PRODUCT'S INPUTS (METHOD v2 parity, permanent) ──
 * The door model's rows were built on `detectForSheet` bare, over the finder's raw walls, while the
 * product finds doors against the stage's stored runs on the page's strokes (`rooms.ts`). Both now
 * build their inputs through `productOpenings.ts`, and the table eval fails a set whose kept doors
 * differ from the product's. Real sheets are not in CI, so this pins the wiring; comments stripped.
 */
const read = (f: string) => readFileSync(`${process.cwd()}/lib/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("openings: training and the product build their inputs one way", () => {
  it("the product (rooms.ts) builds every opening input through openingInputs, never by hand", () => {
    const src = read("plan-ingest/rooms.ts");
    expect(src.match(/\bopeningInputs\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).not.toMatch(/lengthFeet: Math\.hypot/);
    expect(src).not.toMatch(/\.\.\.s, x1: s\.x1 \/ W/);
  });
  it("the training table uses the product's detection, kept runs and opening inputs, and no finder directly", () => {
    const src = read("takeoff/realplan/zzOpeningFeatureTable.eval.ts");
    for (const call of ["productDetection(", "sampledSheetsFor(", "productSheetRuns(", "openingInputs(", "productDoorRows("]) expect(src).toContain(call);
    for (const bare of [/\bdetectForSheet\(/, /\bfindWallsOnSheet\(/, /\bdoorSymbols\(/, /\bdoorArcCandidates\(/, /\bdoorFeatureRows\(/]) expect(src).not.toMatch(bare);
    expect(src).toMatch(/expect\(parity\.differ/);
  });
  it("every product door path hands the existing-door evidence in, and the training table sets the same doors aside", () => {
    // The viewer's Run takeoff and the whole-set rooms step post doors; each passes `existing` (`existingDoors.ts`).
    const call = (src: string) => [...src.matchAll(/doorsAndWindowsForSheet\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]!);
    const viewer = readFileSync(`${process.cwd()}/components/TakeoffPlanViewer.tsx`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(call(viewer)).toHaveLength(1);
    expect(call(viewer)[0]).toMatch(/\bexisting:/);
    const rooms = read("plan-ingest/rooms.ts");
    const roomsCalls = [...rooms.matchAll(/doorsAndWindowsForSheet\(\{[^\n]*\}\)/g)].map((m) => m[0]);
    // The rooms step posts doors; the windows-only count does not, and needs no evidence.
    expect(roomsCalls.filter((c) => /existing\b/.test(c))).toHaveLength(1);
    const table = read("takeoff/realplan/zzOpeningFeatureTable.eval.ts");
    expect(table).toMatch(/productDoorRows\(\{[^}]*existing/);
    expect(table).toMatch(/doorsAndWindowsForSheet\(\{[^\n]*existing \}\)/);
  });
  it("page strokes come into page-width units, and the stored runs carry their length at this scale", () => {
    const got = openingInputs({ runs: [{ x1: 0, y1: 0, x2: 0.3, y2: 0.4, thicknessFeet: 0.5 }], feetPerUnit: 100, widthPt: 200, segmentsPt: [{ x1: 20, y1: 40, x2: 100, y2: 40 }] as never });
    expect(got.segments[0]).toMatchObject({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 });
    expect(got.segmentsPt[0]).toMatchObject({ x1: 20, y1: 40 });
    expect((got.walls[0] as unknown as { lengthFeet: number }).lengthFeet).toBeCloseTo(50);
    // The whole-set run's own detection: the strokes it measured, in points for the mark symbols.
    const boundary = openingInputs({ runs: [], feetPerUnit: 100, widthPt: 200, segmentsInUnits: [{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 }] as never });
    expect(boundary.segmentsPt[0]).toMatchObject({ x1: 20, y1: 40, x2: 100, y2: 40 });
  });
  it("a renovation is read off the sheet's words", () => {
    expect(sheetIsRenovation([{ str: "(E) WALL TO REMAIN" }])).toBe(true);
    expect(sheetIsRenovation([{ str: "TENANT IMPROVEMENT" }])).toBe(true);
    expect(sheetIsRenovation([{ str: "NEW 2HR WALL" }])).toBe(false);
  });
});

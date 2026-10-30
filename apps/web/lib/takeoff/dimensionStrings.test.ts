import { describe, expect, it } from "vitest";
import { dimensionsBetween, dimensionStringOrGridLine, runsMeeting, ticksPerTenFeet } from "./dimensionStrings";
import { offeredCandidates } from "./offeredCandidates";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// 100 ft per page-width unit, 1000 pt wide: 1 ft = 0.01 units = 10 pt.
const FPU = 100;
const W = 1000;
const ft = (n: number) => n / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number, thicknessFeet = 1): WallCandidate =>
  ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet }) as WallCandidate;
/** A word centred at (xFt, yFt), page-width units. */
const word = (str: string, xFt: number, yFt: number) => ({ str, x: ft(xFt), y: ft(yFt) });
/** A text item in points with its BASELINE at yFt, as offeredCandidates takes them. */
const item = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10 + 4, width: 40, height: 8 });
/** A 1 ft tick across the run at xFt. */
const tick = (xFt: number, yFt: number): StrokeSegment => ({ x1: ft(xFt), y1: ft(yFt - 0.5), x2: ft(xFt), y2: ft(yFt + 0.5) });

// A 40 ft string along y = 50, 1 ft "thick" (the two dimension lines a foot apart), with 12'-0" and 28'-0" between them.
const string = wall(10, 50, 50, 50);
const texts = [word("12'-0\"", 16, 50), word("28'-0\"", 36, 50)];
// A wider room below it (x 0..60, so the 40 ft string spans two thirds of the drawing, not the whole of it)
// with two partitions meeting its top wall and never reaching the string.
const room = [wall(0, 60, 60, 60, 0.5), wall(0, 60, 0, 90, 0.5), wall(60, 60, 60, 90, 0.5), wall(0, 90, 60, 90, 0.5), wall(20, 60, 20, 90, 0.5), wall(40, 60, 40, 90, 0.5)];

describe("a dimension string: dimensions between the lines and nothing meeting them", () => {
  it("counts the feet-inches words between the faces, and only those", () => {
    expect(dimensionsBetween(string, [...texts, word("OFFICE", 30, 50), word("12'-0\"", 30, 56)], FPU)).toBe(2);
  });
  it("two dimensions between, nothing meets: a dimension string", () => {
    const v = dimensionStringOrGridLine(string, room, texts, [], FPU);
    expect(v?.kind).toBe("dimension-string");
    expect(v?.why).toBe("2 dimensions written between the two lines and nothing meeting them — a dimension string, not a wall");
  });
  it("the same lines with two partitions meeting them are a wall, whatever is written across it", () => {
    const met = [...room, wall(20, 50, 20, 60, 0.5), wall(40, 50, 40, 60, 0.5)];
    expect(runsMeeting(string, met, FPU)).toBe(2);
    expect(dimensionStringOrGridLine(string, met, texts, [], FPU)).toBeNull();
  });
  it("one dimension between is a string only with witness ticks across it", () => {
    const one = [texts[0]];
    expect(dimensionStringOrGridLine(string, room, one, [], FPU)).toBeNull();
    const ticks = [10, 22, 34, 46].map((x) => tick(x, 50));
    expect(ticksPerTenFeet(string, ticks, FPU)).toBe(1);
    expect(dimensionStringOrGridLine(string, room, one, ticks, FPU)?.kind).toBe("dimension-string");
  });
});

describe("a grid line: across the whole drawing, met by at most one run", () => {
  it("a horizontal pair spanning the room and more, which nothing meets, is a grid line; the room's own top wall, met by its two partitions, is not", () => {
    const grid = wall(0, 40, 60, 40, 0.5);
    expect(dimensionStringOrGridLine(grid, room, [], [], FPU)?.kind).toBe("grid-line");
    expect(dimensionStringOrGridLine(room[0], [grid, ...room], [], [], FPU)).toBeNull();
  });
  it("a long wall met by two partitions stays a wall, however far it reaches", () => {
    const long = wall(0, 60, 60, 60, 0.5);
    const partitions = [wall(20, 60, 20, 90, 0.5), wall(40, 60, 40, 90, 0.5)];
    expect(dimensionStringOrGridLine(long, partitions, [], [], FPU)).toBeNull();
  });
});

describe("offeredCandidates: the `dimension-string` and `grid-line` kinds", () => {
  it("sets the string aside under its kind with the reason, keeps the room, and offers the string when there is no text at all", () => {
    const sheet = (textItems?: ReturnType<typeof item>[]) => ({ walls: [string, ...room], segments: [], widthPt: W, feetPerUnit: FPU, planBoxes: null, textItems });
    const got = offeredCandidates(sheet([item("12'-0\"", 16, 50), item("28'-0\"", 36, 50)]));
    expect(got.candidates).toHaveLength(6);
    expect(got.setAside.map((a) => [a.kind, a.n])).toEqual([["dimension-string", 1]]);
    expect(got.setAsideLines.map((l) => [l.kind, Math.round(l.lengthFeet)])).toEqual([["dimension-string", 40]]);
    expect(offeredCandidates(sheet()).candidates).toHaveLength(7);
  });
});

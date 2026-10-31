import { describe, expect, it } from "vitest";
import { subtractRect, suggestedWorkArea } from "./suggestedWorkArea";
import { clipToWorkArea } from "./userExclusions";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// 100 ft per page-width unit, 1000 pt wide: 1 ft = 0.01 units = 10 pt.
const FPU = 100;
const W = 1000;
const ft = (n: number) => n / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate =>
  ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet: 0.5 }) as WallCandidate;
const word = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10 + 4, width: 40, height: 8 });
const c = 0.25;
// Two 10 x 10 ft rooms sharing a wall.
const rooms = [wall(-c, -c, 10 + c, -c), wall(-c, 10 + c, 10 + c, 10 + c), wall(-c, -c, -c, 10 + c), wall(10 + c, -c, 10 + c, 10 + c), wall(10 + c, -c, 20 + 3 * c, -c), wall(10 + c, 10 + c, 20 + 3 * c, 10 + c), wall(20 + 3 * c, -c, 20 + 3 * c, 10 + c)].map((w) => ({ ...w, x1: w.x1 + 0.1, x2: w.x2 + 0.1, y1: w.y1 + 0.1, y2: w.y2 + 0.1 }));
const base = { segments: [] as StrokeSegment[], widthPt: W, feetPerUnit: FPU };

describe("a suggested work area", () => {
  it("a sheet with nothing to say suggests nothing, whatever its walls", () => {
    expect(suggestedWorkArea({ ...base, runs: rooms, textItems: [word("OFFICE", 15, 15)] })).toBeNull();
    expect(suggestedWorkArea({ ...base, runs: [], textItems: [word("NIC", 15, 15)] })).toBeNull();
  });
  it("subtracting a hole leaves the rectangles round it, and a hole elsewhere leaves the rectangle", () => {
    const r = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(subtractRect(r, { x0: 4, y0: 4, x1: 6, y1: 6 })).toHaveLength(4);
    expect(subtractRect(r, { x0: 20, y0: 20, x1: 30, y1: 30 })).toEqual([r]);
  });
  it("uses the demolition extent, padded, when there is enough of it; a little demolition says nothing", () => {
    const removed = [{ x1: ft(10), y1: ft(10), x2: ft(50), y2: ft(10), lengthFeet: 40 }];
    const got = suggestedWorkArea({ ...base, runs: [wall(0, 0, 80, 0)], textItems: [], demoRemoved: removed });
    expect(got?.sources).toEqual(["demolition plan extent"]);
    expect(got?.polygons[0].xs[1]).toBeCloseTo(ft(55), 6);
    expect(suggestedWorkArea({ ...base, runs: [wall(0, 0, 80, 0)], textItems: [], demoRemoved: [{ ...removed[0], lengthFeet: 12 }] })).toBeNull();
  });
  it("cuts out a room marked NIC and keeps the walls round it, the shared wall included", () => {
    const got = suggestedWorkArea({ ...base, runs: rooms, textItems: [word("NIC", 15, 15)] });
    expect(got?.sources).toEqual(["rooms marked NIC or existing"]);
    expect(clipToWorkArea(rooms, got!.polygons, FPU).outside).toHaveLength(0);
    const inside = wall(15, 13, 15, 17);
    const clipped = clipToWorkArea([...rooms, inside], suggestedWorkArea({ ...base, runs: rooms, textItems: [word("NIC", 15, 15)] })!.polygons, FPU);
    expect(clipped.outside).toEqual([inside]);
  });
  it("NIC, TYP ALL is an item, not an area; a (E) COLUMN is not a room", () => {
    expect(suggestedWorkArea({ ...base, runs: rooms, textItems: [word("NIC, TYP ALL", 15, 15)] })).toBeNull();
    expect(suggestedWorkArea({ ...base, runs: rooms, textItems: [word("(E) COLUMN", 15, 15)] })).toBeNull();
  });
  it("a dashed line labelled LIMIT OF WORK sets the base", () => {
    const dashes = (x0: number, y0: number, x1: number, y1: number): StrokeSegment[] => {
      const n = 12;
      return Array.from({ length: n }, (_, i) => {
        const a = i / n, b = (i + 0.6) / n;
        return { x1: (x0 + (x1 - x0) * a) * 10, y1: (y0 + (y1 - y0) * a) * 10, x2: (x0 + (x1 - x0) * b) * 10, y2: (y0 + (y1 - y0) * b) * 10, width: 1 };
      });
    };
    const segments = [...dashes(20, 20, 32, 20), ...dashes(32, 20, 32, 32)];
    const got = suggestedWorkArea({ ...base, segments, runs: [wall(0, 0, 80, 0)], textItems: [word("LIMIT OF WORK", 25, 21)] });
    expect(got?.sources).toEqual(["limit-of-work line"]);
    expect(got?.polygons[0].xs[0]).toBeCloseTo(ft(20), 2);
  });
});

import { describe, expect, it } from "vitest";
import { compareSheets, measurementsNearChanges, type Seg } from "./sheetCompare";

// A plan's worth of walls: a 12 x 8 grid of rooms, the edited copy of it in each test.
const grid: Seg[] = [];
for (let i = 0; i <= 12; i += 1) grid.push({ x1: 0.1 + i * 0.06, y1: 0.1, x2: 0.1 + i * 0.06, y2: 0.58 });
for (let j = 0; j <= 8; j += 1) grid.push({ x1: 0.1, y1: 0.1 + j * 0.06, x2: 0.82, y2: 0.1 + j * 0.06 });
const shift = (s: Seg, dx: number, dy: number) => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
const near = (a: Seg, b: Seg) => Math.max(Math.abs(a.x1 - b.x1), Math.abs(a.y1 - b.y1), Math.abs(a.x2 - b.x2), Math.abs(a.y2 - b.y2)) < 0.002;

describe("compareSheets", () => {
  it("finds nothing between a sheet and itself", () => {
    const c = compareSheets(grid, grid, 0.7);
    expect([c.added.length, c.removed.length, c.agreement]).toEqual([0, 0, 1]);
  });
  it("finds the wall taken out and the one put in, on a re-plotted copy", () => {
    const wall: Seg = { x1: 0.13, y1: 0.16, x2: 0.13, y2: 0.22 };
    const dx = 0.0031, dy = -0.0022; // re-plotted a little off
    const edited = [...grid.filter((_, i) => i !== 5), wall].map((s) => shift(s, dx, dy));
    const c = compareSheets(grid, edited, 0.7);
    expect(c.offset.dx).toBeCloseTo(-dx, 3);
    expect(c.offset.dy).toBeCloseTo(-dy, 3);
    expect(c.removed).toHaveLength(1);
    expect(near(c.removed[0]!, shift(grid[5]!, dx, dy))).toBe(true);
    expect(c.added).toHaveLength(1);
    expect(near(c.added[0]!, shift(wall, dx, dy))).toBe(true);
  });
  it("ignores line ends a re-plot nudged by a hair", () => {
    // Three thousandths of a page, past the slack but not a piece worth reporting.
    const edited = grid.map((s, i) => (i >= 13 ? { ...s, x2: s.x2 + 0.0012 } : s));
    const c = compareSheets(grid, edited, 0.7);
    expect([c.added.length, c.removed.length]).toEqual([0, 0]);
  });
  it("reports only the new piece of a wall that was extended", () => {
    const edited = grid.map((s, i) => (i === 13 ? { ...s, x2: 0.95 } : s));
    const c = compareSheets(grid, edited, 0.7);
    expect(c.removed).toEqual([]);
    expect(c.added).toHaveLength(1);
    expect(c.added[0]!.x1).toBeGreaterThan(0.815);
    expect(c.added[0]!.x2).toBeCloseTo(0.95, 3);
  });
});

describe("measurementsNearChanges", () => {
  it("names the measurement that runs along a change and not the one across the sheet", () => {
    const change: Seg = { x1: 0.4, y1: 0.2, x2: 0.4, y2: 0.3 };
    const hit = measurementsNearChanges([
      { id: "along", xs: [0.4, 0.4], ys: [0.1, 0.5], closed: false },
      { id: "room", xs: [0.38, 0.46, 0.46, 0.38], ys: [0.22, 0.22, 0.28, 0.28], closed: true },
      { id: "away", xs: [0.7, 0.8], ys: [0.5, 0.5], closed: false },
      { id: "count", xs: [0.401], ys: [0.25], closed: false },
    ], [change], 0.7, 0.003);
    expect([...hit].sort()).toEqual(["along", "count", "room"]);
  });
});

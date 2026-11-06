import { describe, expect, it } from "vitest";
import { liesAlong, sameRunAs } from "./runMatch";

describe("sameRunAs", () => {
  const run = { x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 };
  it("the same run, exactly, either way round", () => {
    expect(sameRunAs(run, [0.1, 0.5], [0.3, 0.3])).toBe(true);
    expect(sameRunAs(run, [0.5, 0.1], [0.3, 0.3])).toBe(true);
  });
  it("a re-run a hair off is the same wall", () => {
    expect(sameRunAs(run, [0.1003, 0.4998], [0.3004, 0.2997])).toBe(true);
  });
  it("the next wall over, or a run sharing one end, is not", () => {
    expect(sameRunAs(run, [0.1, 0.5], [0.305, 0.305])).toBe(false);
    expect(sameRunAs(run, [0.1, 0.3], [0.3, 0.3])).toBe(false);
    expect(sameRunAs(run, [0.1], [0.3])).toBe(false);
  });
});

describe("liesAlong", () => {
  const wall = { xs: [0.1, 0.5], ys: [0.3, 0.3] };
  it("a piece of the wall, where a new wall now meets it, lies along it", () => {
    expect(liesAlong({ x1: 0.1, y1: 0.3, x2: 0.3, y2: 0.3 }, wall.xs, wall.ys)).toBe(true);
    expect(liesAlong({ x1: 0.3, y1: 0.3002, x2: 0.5, y2: 0.2999 }, wall.xs, wall.ys)).toBe(true);
  });
  it("the wall lengthened lies along it", () => {
    expect(liesAlong({ x1: 0.1, y1: 0.3, x2: 0.6, y2: 0.3 }, wall.xs, wall.ys)).toBe(true);
  });
  it("a wall in line but beyond it, one next to it, or one across it, does not", () => {
    expect(liesAlong({ x1: 0.6, y1: 0.3, x2: 0.9, y2: 0.3 }, wall.xs, wall.ys)).toBe(false);
    expect(liesAlong({ x1: 0.1, y1: 0.31, x2: 0.5, y2: 0.31 }, wall.xs, wall.ys)).toBe(false);
    expect(liesAlong({ x1: 0.3, y1: 0.3, x2: 0.3, y2: 0.5 }, wall.xs, wall.ys)).toBe(false);
  });
});

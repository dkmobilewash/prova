import { describe, expect, it } from "vitest";
import { offeredCandidates } from "./offeredCandidates";
import { alignPrior, onPriorPlan } from "./planCompare";
import type { WallCandidate } from "./wallVectors";

const FPU = 100;
const ft = (n: number) => n / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate =>
  ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet: 0.5 }) as WallCandidate;
// An irregular plan, so one translation is the only one the walls agree on.
const plan = [wall(0, 0, 40, 0), wall(0, 0, 0, 30), wall(40, 0, 40, 17), wall(0, 30, 26, 30), wall(13, 0, 13, 22), wall(26, 12, 26, 30)];
const moved = (dx: number, dy: number) => plan.map((w) => ({ x1: w.x1 + ft(dx), y1: w.y1 + ft(dy), x2: w.x2 + ft(dx), y2: w.y2 + ft(dy) }));

describe("plan comparison", () => {
  it("aligns a prior plan drawn elsewhere on its page and returns it on this sheet", () => {
    const aligned = alignPrior(plan, moved(9, 7), FPU);
    expect(aligned).not.toBeNull();
    expect(aligned![0].x1).toBeCloseTo(plan[0].x1, 6);
    expect(aligned![0].y1).toBeCloseTo(plan[0].y1, 6);
  });
  it("two plans that share nothing do not align, so nothing is set aside", () => {
    expect(alignPrior(plan, [wall(0, 0, 9, 0), wall(50, 50, 59, 50)], FPU)).toBeNull();
  });
  it("a wall the prior plan draws is on it; a wall it does not is new; a wall it draws for a third of its length is new", () => {
    const prior = [wall(0, 0, 40, 0), wall(0, 20, 10, 20)];
    expect(onPriorPlan(wall(5, 0, 35, 0), prior, FPU)).toBe(true);
    expect(onPriorPlan(wall(5, 8, 35, 8), prior, FPU)).toBe(false);
    expect(onPriorPlan(wall(0, 20, 30, 20), prior, FPU)).toBe(false);
  });
  it("same place but another thickness is a new wall: a 12 in prior wall does not claim a 6 in one", () => {
    const thick = { ...wall(0, 0, 40, 0), thicknessFeet: 1 };
    expect(onPriorPlan(wall(0, 0, 40, 0), [thick], FPU)).toBe(false);
    expect(onPriorPlan(wall(0, 0, 40, 0), [{ ...thick, thicknessFeet: 0.55 }], FPU)).toBe(true);
  });
  it("raw faces: both faces at the wall's thickness match; one face alone, or faces a foot apart, do not", () => {
    const line = (y: number) => ({ x1: ft(0), y1: ft(y), x2: ft(40), y2: ft(y) });
    expect(onPriorPlan(wall(0, 10, 40, 10), [line(9.75), line(10.25)], FPU)).toBe(true);
    expect(onPriorPlan(wall(0, 10, 40, 10), [line(9.75)], FPU)).toBe(false);
    expect(onPriorPlan({ ...wall(0, 10, 40, 10), thicknessFeet: 0.5 }, [line(8), line(12)], FPU)).toBe(false);
  });
  it("offeredCandidates sets it aside under its own kind and offers the new wall", () => {
    const existing = wall(0, 0, 40, 0), fresh = wall(0, 20, 40, 20);
    const got = offeredCandidates({ walls: [existing, fresh], segments: [], widthPt: 1000, feetPerUnit: FPU, planBoxes: null, priorPlan: [{ ...wall(0, 0, 40, 0) }] });
    expect(got.offeredRuns).toEqual([fresh]);
    expect(got.setAside.map((a) => [a.kind, a.n])).toEqual([["on-prior-plan", 1]]);
  });
});

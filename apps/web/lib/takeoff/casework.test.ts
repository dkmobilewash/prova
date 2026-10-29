import { describe, expect, it } from "vitest";
import { isCaseworkFront } from "./casework";
import type { WallCandidate } from "./wallVectors";

// 1 ft per unit keeps the arithmetic readable.
const FPU = 1;
const run = (x1: number, y1: number, x2: number, y2: number, thIn: number): WallCandidate =>
  ({ x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet: thIn / 12 }) as WallCandidate;

describe("a thin run two feet off a wall is the casework front", () => {
  // a 6 in wall along y = 0, from x = 0 to 20; the cabinet front is a 2 in pair whose
  // near face sits 24 in from the wall's face: centre at 0.25 + 2 + 1/12
  const wall = run(0, 0, 20, 0, 6);
  const front = run(2, 0.25 + 2 + 1 / 12, 18, 0.25 + 2 + 1 / 12, 2);

  it("SETS THE FRONT ASIDE AND KEEPS THE WALL IT FACES", () => {
    expect(isCaseworkFront(front, [wall, front], FPU)).toBe(true);
    expect(isCaseworkFront(wall, [wall, front], FPU)).toBe(false);
  });

  it("keeps a thin run that is not two feet off anything", () => {
    const far = run(2, 4, 18, 4, 2);
    expect(isCaseworkFront(far, [wall, far], FPU)).toBe(false);
    const near = run(2, 0.75, 18, 0.75, 2);
    expect(isCaseworkFront(near, [wall, near], FPU)).toBe(false);
  });

  it("keeps a wall-thickness run two feet off a wall — a corridor's other side is not casework", () => {
    const other = run(2, 0.25 + 2 + 0.25, 18, 0.25 + 2 + 0.25, 6);
    expect(isCaseworkFront(other, [wall, other], FPU)).toBe(false);
  });

  it("asks the run to lie alongside the wall for most of its length", () => {
    const stub = run(18, 0.25 + 2 + 1 / 12, 30, 0.25 + 2 + 1 / 12, 2);
    expect(isCaseworkFront(stub, [wall, stub], FPU)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { alignViews } from "./viewAlign";

const FPU = 288;
const plan = [
  { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1 },
  { x1: 0.1, y1: 0.1, x2: 0.1, y2: 0.25 },
  { x1: 0.3, y1: 0.1, x2: 0.3, y2: 0.25 },
  { x1: 0.1, y1: 0.25, x2: 0.3, y2: 0.25 },
  { x1: 0.2, y1: 0.1, x2: 0.2, y2: 0.25 },
];
describe("alignViews", () => {
  it("finds the shift between the same plan drawn twice, through the legend's ruled lines", () => {
    const shifted = plan.map((l) => ({ x1: l.x1 + 0.02, y1: l.y1 + 0.33, x2: l.x2 + 0.02, y2: l.y2 + 0.33 }));
    const legend = [{ x1: 0.02, y1: 0.02, x2: 0.08, y2: 0.02 }, { x1: 0.02, y1: 0.05, x2: 0.08, y2: 0.05 }];
    const out = alignViews([...shifted, ...legend], plan, FPU);
    expect(out).not.toBeNull();
    expect(out!.dx).toBeCloseTo(0.02, 4);
    expect(out!.dy).toBeCloseTo(0.33, 4);
  });
  it("refuses when fewer than three walls agree", () => {
    expect(alignViews([{ x1: 0.5, y1: 0.5, x2: 0.7, y2: 0.5 }], plan, FPU)).toBeNull();
  });
});

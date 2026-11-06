import { describe, expect, it } from "vitest";
import { WHEEL_NOTCH, wheelZoomFactor } from "./takeoff-plan-view";

describe("one wheel notch zooms one step (Chrome's re-test: 3 notches went 25% → 31%)", () => {
  it("a notch is 12% in or out whatever delta the browser reports for it", () => {
    for (const dy of [4, 33, 100, 120]) {
      expect(wheelZoomFactor(-dy, 0, true)).toBeCloseTo(WHEEL_NOTCH);
      expect(wheelZoomFactor(dy, 0, true)).toBeCloseTo(1 / WHEEL_NOTCH);
    }
    // Three notches from 25%: about 35%, not 31%.
    expect(25 * wheelZoomFactor(-4, 0, true) ** 3).toBeGreaterThan(34);
  });
  it("a pinch stays continuous, at most 25% per event", () => {
    expect(wheelZoomFactor(-2, 0, false)).toBeCloseTo(Math.exp(0.02));
    expect(wheelZoomFactor(-1000, 0, false)).toBe(1.25);
    expect(wheelZoomFactor(0, 0, true)).toBe(1);
  });
});

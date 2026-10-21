import { describe, expect, it } from "vitest";
import { roomBoundary } from "./roomBoundary";

describe("roomBoundary", () => {
  it("keeps long pairings, every kept run and every hand-drawn line, and drops hatch pairs and areas", () => {
    const out = roomBoundary({
      pairings: [
        { x1: 0, y1: 0, x2: 0.1, y2: 0, lengthFeet: 10, thicknessFeet: 0.5 },
        { x1: 0, y1: 0, x2: 0.005, y2: 0, lengthFeet: 0.67, thicknessFeet: 0.3 },
      ],
      runs: [{ x1: 0, y1: 0.1, x2: 0.1, y2: 0.1, thicknessFeet: 0.4 }],
      drawn: [
        { kind: "LINEAR", xs: [0, 0.1, 0.1], ys: [0.2, 0.2, 0.3] },
        { kind: "AREA", xs: [0, 1, 1], ys: [0, 0, 1] },
      ],
    });
    expect(out).toHaveLength(4);
    expect(out[0].thicknessFeet).toBe(0.5);
    expect(out[2]).toEqual({ x1: 0, y1: 0.2, x2: 0.1, y2: 0.2 });
    expect(out[3].thicknessFeet).toBeUndefined();
  });
});

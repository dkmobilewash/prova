import { describe, expect, it } from "vitest";
import { propagateTypes } from "./typePropagation";
import type { WallCandidate } from "./wallVectors";

/** Page-width units; FPU 100 makes 0.01 one foot. */
const FPU = 100;
function run(x1: number, y1: number, x2: number, y2: number, thicknessFeet = 0.5): WallCandidate {
  return { x1, y1, x2, y2, thicknessFeet, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU };
}

describe("propagating a type along a wall", () => {
  it("carries the tag along touching collinear runs of the same thickness, both ways", () => {
    const a = run(0, 0, 0.1, 0);
    const b = run(0.1, 0, 0.2, 0);
    const c = run(0.2, 0, 0.3, 0);
    const got = propagateTypes({ walls: [a, b, c], tagged: new Map([[b, "A"]]), feetPerUnit: FPU, defaultCode: null });
    expect(got.byRun.get(a)).toEqual({ code: "A", source: "propagated", via: b });
    expect(got.byRun.get(c)?.code).toBe("A");
    expect(got.feet).toEqual({ tagged: 10, propagated: 20, default: 0, untyped: 0 });
  });

  it("stops at a thickness change, ROUNDS A CORNER that is the only way on, and runs past a T", () => {
    const a = run(0, 0, 0.1, 0);
    const thick = run(0.1, 0, 0.2, 0, 1.0);
    const corner = run(0, 0, 0, 0.1);
    const tee = run(0.05, 0, 0.05, 0.1);
    const got = propagateTypes({ walls: [a, thick, corner, tee], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null });
    expect(got.byRun.get(thick)).toBeUndefined();
    // The room's next wall starts where the tagged one ends: same type.
    expect(got.byRun.get(corner)).toEqual({ code: "A", source: "propagated", via: a });
    // A partition meeting the wall's middle is not reached from it.
    expect(got.byRun.get(tee)).toBeUndefined();
    // Two walls leaving the endpoint — a stem meeting a split crossing wall — is a question, not a corner.
    const left = run(0.1, 0, 0.1, -0.1);
    const right = run(0.1, 0, 0.1, 0.1);
    const fork = propagateTypes({ walls: [a, left, right], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null });
    expect(fork.byRun.get(left)).toBeUndefined();
    expect(fork.byRun.get(right)).toBeUndefined();
    // A corner into a thicker wall is not taken either.
    const thickCorner = run(0.1, 0, 0.1, 0.1, 1.0);
    expect(propagateTypes({ walls: [a, thickCorner], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null }).byRun.get(thickCorner)).toBeUndefined();
    // The straight wall continues past the partition that meets it.
    const past = run(0.1, 0, 0.2, 0);
    const again = propagateTypes({ walls: [a, past, tee], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null });
    expect(again.byRun.get(past)?.code).toBe("A");
  });

  it("leaves the run between two different tags untyped and reports it", () => {
    const a = run(0, 0, 0.1, 0);
    const mid = run(0.1, 0, 0.2, 0);
    const c = run(0.2, 0, 0.3, 0);
    const got = propagateTypes({ walls: [a, mid, c], tagged: new Map([[a, "A"], [c, "B"]]), feetPerUnit: FPU, defaultCode: "X" });
    expect(got.byRun.get(mid)).toBeUndefined();
    expect(got.conflicts).toEqual([{ run: mid, codes: ["A", "B"] }]);
    expect(got.feet.untyped).toBe(10);
  });

  it("gives the U.N.O. default to what nothing reached, marked default", () => {
    const a = run(0, 0, 0.1, 0);
    const far = run(0.5, 0.5, 0.6, 0.5);
    const got = propagateTypes({ walls: [a, far], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: "P1" });
    expect(got.byRun.get(far)).toEqual({ code: "P1", source: "default" });
    expect(got.byRun.get(a)?.source).toBe("tagged");
  });

  it("crosses a door-sized gap on the same line, and not a wider one or an offset one", () => {
    const a = run(0, 0, 0.1, 0);
    const pastDoor = run(0.14, 0, 0.2, 0); // 4 ft gap
    const got = propagateTypes({ walls: [a, pastDoor], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null });
    expect(got.byRun.get(pastDoor)?.code).toBe("A");
    const tooFar = run(0.25, 0, 0.3, 0); // 15 ft gap
    const offset = run(0.14, 0.02, 0.2, 0.02); // 2 ft to the side
    const none = propagateTypes({ walls: [a, tooFar, offset], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null });
    expect(none.byRun.size).toBe(1);
    const touching = propagateTypes({ walls: [a, pastDoor], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null, gapFeet: 0.75 });
    expect(touching.byRun.size).toBe(1);
  });

  it("stops where two runs continue in the same direction rather than guess", () => {
    const a = run(0, 0, 0.1, 0);
    const b1 = run(0.1, 0, 0.2, 0);
    const b2 = run(0.1, 0.001, 0.2, 0.001);
    const got = propagateTypes({ walls: [a, b1, b2], tagged: new Map([[a, "A"]]), feetPerUnit: FPU, defaultCode: null });
    expect(got.byRun.size).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { arcDash } from "./progress-arc";

/**
 * THE ONE THING THIS RING MUST DO THAT THE REFERENCE'S DOES NOT: change
 * shape when the number changes.
 *
 * The design this was ported from draws its donut with
 * `border-left-color` — a fixed quarter-ring at every value, with the
 * percentage printed in the middle. A ring like that passes every test
 * you could write about it except this one, which is the only one that
 * matters, so it is the first assertion in the file.
 */
describe("the arc encodes the value", () => {
  it("sweeps a different length for every value", () => {
    const lengths = [0, 0.12, 0.25, 0.5, 0.58, 0.94, 1].map(
      (v) => Number(arcDash(v, 58, 8).filled.toFixed(4)),
    );
    // THE REGRESSION, NAMED: a fixed-geometry ring returns the same
    // number here every time, and `new Set` collapses to one entry.
    expect(
      new Set(lengths).size,
      "every value drew the same arc — that is the reference's fake donut, not a measurement",
    ).toBe(lengths.length);
  });

  it("is monotonic — more never draws less", () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const { filled } = arcDash(v, 58, 8);
      expect(filled, `${v} drew less than the value below it`).toBeGreaterThanOrEqual(prev);
      prev = filled;
    }
  });

  it("covers nothing at 0 and the whole circumference at 1", () => {
    const { filled, gap, circumference } = arcDash(0, 58, 8);
    expect(filled).toBe(0);
    expect(gap).toBeCloseTo(circumference, 6);

    const full = arcDash(1, 58, 8);
    expect(full.filled).toBeCloseTo(full.circumference, 6);
    expect(full.gap).toBeCloseTo(0, 6);
  });

  it("puts the halfway mark at exactly half the circumference", () => {
    const { filled, circumference } = arcDash(0.5, 58, 8);
    expect(filled).toBeCloseTo(circumference / 2, 6);
  });

  it("clamps out-of-range input rather than drawing past the circle", () => {
    // A caller dividing by a stale total can hand this 1.4. An arc longer
    // than its circumference wraps and renders as a FULLER ring than 100%,
    // which reads as more-than-done.
    const over = arcDash(1.4, 58, 8);
    expect(over.filled).toBeCloseTo(over.circumference, 6);
    expect(over.gap).toBeCloseTo(0, 6);
    const under = arcDash(-0.3, 58, 8);
    expect(under.filled).toBe(0);
  });

  it("insets the radius by half the stroke so the ring is not clipped", () => {
    // A circle drawn at r = size/2 has half its stroke outside the
    // viewBox, which crops flat on all four sides.
    const { radius } = arcDash(0.5, 58, 8);
    expect(radius).toBe((58 - 8) / 2);
    expect(radius * 2 + 8).toBe(58);
  });
});

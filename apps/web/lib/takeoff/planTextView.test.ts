import { describe, expect, it } from "vitest";
import { doorsByGroup, feetInches } from "./planTextView";

const door = (mark: string, x: number, y: number) => ({
  mark,
  widthFt: 3,
  widthFrom: "schedule" as const,
  placedBy: "mark" as const,
  x,
  y,
  description: null,
});

describe("which group a placed door belongs to", () => {
  const groups = [
    { runs: [{ x1: 0.1, y1: 0.5, x2: 0.5, y2: 0.5 }] },
    { runs: [{ x1: 0.6, y1: 0.2, x2: 0.6, y2: 0.8 }] },
  ];

  it("attributes each door to the nearest run's group, within reach", () => {
    // FPU 100: 0.01 is a foot. The third door is 5 ft from anything.
    const got = doorsByGroup(groups, [door("101", 0.3, 0.505), door("102", 0.605, 0.4), door("103", 0.3, 0.55)], 100);
    expect([...got.entries()].map(([g, ds]) => [g, ds.map((d) => d.mark)])).toEqual([
      [0, ["101"]],
      [1, ["102"]],
    ]);
  });

  it("falls back to a hundredth of the page when there is no calibration", () => {
    const got = doorsByGroup(groups, [door("101", 0.3, 0.505), door("103", 0.3, 0.55)], null);
    expect([...got.keys()]).toEqual([0]);
  });
});

describe("a width on screen", () => {
  it("prints feet and inches as a drafter would", () => {
    expect(feetInches(3)).toBe(`3'-0"`);
    expect(feetInches(2.5)).toBe(`2'-6"`);
    expect(feetInches(2.999)).toBe(`3'-0"`);
  });
});

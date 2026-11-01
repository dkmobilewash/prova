import { describe, expect, it } from "vitest";
import { dimensionsBetween, isDimensionString, runsMeeting } from "./dimensionStrings";

const feetPerUnit = 100;
const string = { x1: 0.1, y1: 0.5, x2: 0.5, y2: 0.5, thicknessFeet: 1 };
const dims = (n: number, str = "12'-6\"") => Array.from({ length: n }, (_, i) => ({ str, x: 0.12 + i * 0.05, y: 0.5 }));
const tee = (x: number) => ({ x1: x, y1: 0.505, x2: x, y2: 0.6, thicknessFeet: 0.4 });

describe("a dimension string", () => {
  it("is many dimensions between the faces and little meeting it", () => {
    expect(isDimensionString(string, [string, tee(0.2)], dims(4), feetPerUnit)).toBe(true);
  });
  it("needs four: a real wall often has one or two written across it", () => {
    expect(isDimensionString(string, [string], dims(3), feetPerUnit)).toBe(false);
  });
  it("is a wall when four partitions tee into it, however many dimensions it has", () => {
    const tees = [0.15, 0.2, 0.3, 0.4].map(tee);
    expect(runsMeeting(string, tees, feetPerUnit)).toBe(4);
    expect(isDimensionString(string, [string, ...tees], dims(6), feetPerUnit)).toBe(false);
  });
  it("still allows three to stop at it by accident", () => {
    expect(isDimensionString(string, [string, ...[0.15, 0.2, 0.3].map(tee)], dims(6), feetPerUnit)).toBe(true);
  });
  it("counts a run crossing it as meeting it", () => {
    expect(runsMeeting(string, [{ x1: 0.3, y1: 0.4, x2: 0.3, y2: 0.6, thicknessFeet: 0.4 }], feetPerUnit)).toBe(1);
  });
  it("counts only feet-and-inches text, only between the faces, only along the run", () => {
    expect(dimensionsBetween(string, dims(4, "OFFICE"), feetPerUnit)).toBe(0);
    expect(dimensionsBetween(string, dims(4).map((w) => ({ ...w, y: 0.6 })), feetPerUnit)).toBe(0);
    expect(dimensionsBetween(string, dims(4).map((w) => ({ ...w, x: w.x + 0.8 })), feetPerUnit)).toBe(0);
    expect(dimensionsBetween(string, dims(4), feetPerUnit)).toBe(4);
  });
  it("does not divide by a run of no length", () => {
    expect(isDimensionString({ x1: 0.1, y1: 0.5, x2: 0.1, y2: 0.5, thicknessFeet: 1 }, [], dims(4), feetPerUnit)).toBe(false);
  });
});

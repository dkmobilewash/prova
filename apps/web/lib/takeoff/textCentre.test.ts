import { describe, expect, it } from "vitest";
import { textItemCentre } from "./textCentre";

describe("a text item's middle", () => {
  it("is the old (x + w/2, y − h/2) for text that runs left to right", () => {
    expect(textItemCentre({ x: 100, y: 200, width: 20, height: 10 })).toEqual({ x: 110, y: 195 });
    expect(textItemCentre({ x: 100, y: 200, width: 20, height: 10, angle: 0 })).toEqual({ x: 110, y: 195 });
  });
  it("RUNS UP THE PAGE FOR A VERTICAL DIMENSION STRING, so the middle sits on the string", () => {
    // Topeka p76's "21' - 0"": start at (x, y), the figures run toward −y, the glyphs' tops point to −x.
    const c = textItemCentre({ x: 100, y: 200, width: 20, height: 10, angle: -Math.PI / 2 });
    expect(c.x).toBeCloseTo(95, 6);
    expect(c.y).toBeCloseTo(190, 6);
  });
});

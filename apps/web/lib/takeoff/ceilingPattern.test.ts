import { describe, expect, it } from "vitest";
import { familyOfPattern, legendSwatches, patternInWindow, windowRound } from "./ceilingPattern";
import type { UnitStroke } from "./ceilingTags";

const FPU = 288; // 1/8" = 1'-0" on a 36" sheet: feet per page width
const ft = (f: number) => f / FPU;
const grid = (cx: number, cy: number, sx: number, sy: number, halfFt: number): UnitStroke[] => {
  const out: UnitStroke[] = [];
  for (let x = -halfFt; x <= halfFt; x += sx) out.push({ x1: cx + ft(x), y1: cy - ft(halfFt), x2: cx + ft(x), y2: cy + ft(halfFt) });
  for (let y = -halfFt; y <= halfFt; y += sy) out.push({ x1: cx - ft(halfFt), y1: cy + ft(y), x2: cx + ft(halfFt), y2: cy + ft(y) });
  return out;
};
const stipple = (cx: number, cy: number, n: number): UnitStroke[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i * 7919) % 97, b = (i * 104729) % 89;
    const x = cx + ft(-7 + (14 * a) / 97), y = cy + ft(-7 + (14 * b) / 89);
    return { x1: x, y1: y, x2: x + ft(0.05), y2: y + ft(0.05) };
  });
const walls = (cx: number, cy: number): UnitStroke[] => [
  { x1: cx - ft(9), y1: cy - ft(9), x2: cx + ft(9), y2: cy - ft(9) },
  { x1: cx - ft(9), y1: cy + ft(9), x2: cx + ft(9), y2: cy + ft(9) },
  { x1: cx - ft(9), y1: cy - ft(9), x2: cx - ft(9), y2: cy + ft(9) },
];

describe("patternInWindow", () => {
  it("names a 2x4 grid with its spacing, a 2x2 grid, and nothing from the walls alone", () => {
    const p = patternInWindow([...walls(0.5, 0.5), ...grid(0.5, 0.5, 4, 2, 8)], 0.5, 0.5, ft(8), FPU);
    // Lines twice the window's width, whose midpoints fall outside a window off to one side, still count.
    const wide = patternInWindow(grid(0.5, 0.5, 2, 2, 30), 0.5 + ft(20), 0.5, ft(5), FPU);
    expect(wide.kind).toBe("grid");
    expect(p.kind).toBe("grid");
    expect(p.spacingFeet.x).toBeCloseTo(4, 1);
    expect(p.spacingFeet.y).toBeCloseTo(2, 1);
    expect(patternInWindow(grid(0.5, 0.5, 2, 2, 8), 0.5, 0.5, ft(8), FPU).kind).toBe("grid");
    expect(patternInWindow(walls(0.5, 0.5), 0.5, 0.5, ft(8), FPU).kind).toBe("blank");
  });
  it("names a stipple, joists in one direction, and a diagonal hatch", () => {
    expect(patternInWindow(stipple(0.5, 0.5, 100), 0.5, 0.5, ft(8), FPU).kind).toBe("stipple");
    const joists: UnitStroke[] = Array.from({ length: 9 }, (_, i) => ({ x1: 0.5 - ft(8), y1: 0.5 + ft(-6 + 1.33 * i), x2: 0.5 + ft(8), y2: 0.5 + ft(-6 + 1.33 * i) }));
    expect(patternInWindow(joists, 0.5, 0.5, ft(8), FPU).kind).toBe("joists");
    const diag: UnitStroke[] = Array.from({ length: 10 }, (_, i) => ({ x1: 0.5 + ft(-7 + i), y1: 0.5 - ft(3), x2: 0.5 + ft(-4 + i), y2: 0.5 + ft(3) }));
    expect(patternInWindow(diag, 0.5, 0.5, ft(8), FPU).kind).toBe("diagonal");
  });
  it("maps through the sheet's swatches first, the convention second", () => {
    const W = 2592;
    const descriptions = [
      { str: "CEILING LEGEND", x: 0.28 * W, y: 0.85 * W, width: 100, height: 12 },
      { str: "GYP BOARD CEILING W/ WOOD VENEER", x: 0.3 * W, y: 0.9 * W, width: 100, height: 9.6 },
    ];
    const h = 9.6 / W;
    const cx = 0.3 - 2.2 * h, cy = 0.9 - h / 2;
    const swatch: UnitStroke[] = Array.from({ length: 5 }, (_, i) => ({ x1: cx - h + i * 0.4 * h, y1: cy - h, x2: cx + i * 0.4 * h, y2: cy + h }));
    const swatches = legendSwatches(descriptions, swatch, W);
    expect(swatches.get("diagonal")).toBe("GYP");
    expect(familyOfPattern("diagonal", swatches)).toBe("GYP");
    expect(familyOfPattern("diagonal", new Map())).toBeNull();
    expect(familyOfPattern("grid", new Map())).toBe("ACT");
  });
  it("sizes the window by the nearest other room tag", () => {
    const W = 2592;
    const w = windowRound({ x: 0.5 * W, y: 0.5 * W }, [{ x: 0.5 * W, y: 0.5 * W }, { x: 0.52 * W, y: 0.5 * W }], W, FPU);
    expect(w.half).toBeCloseTo(Math.max(4 / FPU, 0.45 * 0.02), 5);
    expect(w.away, "a crowded tag gets a second window stepped away from the neighbour").not.toBeNull();
    expect(w.away!.cx).toBeLessThan(0.5);
  });
});

import { describe, expect, it } from "vitest";
import type { StrokeSegment } from "./wallVectors";
import { coverageOf, findSymbols, signatureDistance, signatureOf, withoutText } from "./symbolSignature";

/** A duplex receptacle as CAD draws it: a circle (12 pieces) with two parallel ticks. */
function receptacle(cx: number, cy: number, r: number, rot = 0, mirror = false): StrokeSegment[] {
  const pts = (x: number, y: number) => {
    const mx = mirror ? -x : x;
    return { x: cx + mx * Math.cos(rot) - y * Math.sin(rot), y: cy + mx * Math.sin(rot) + y * Math.cos(rot) };
  };
  const out: StrokeSegment[] = [];
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * 2 * Math.PI, a1 = ((i + 1) / 12) * 2 * Math.PI;
    const p = pts(r * Math.cos(a0), r * Math.sin(a0)), q = pts(r * Math.cos(a1), r * Math.sin(a1));
    out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
  }
  for (const dy of [-r * 0.35, r * 0.35]) {
    const p = pts(-r * 1.6, dy), q = pts(-r * 0.9, dy);
    out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
  }
  return out;
}
/** A different symbol of the same size: a square with a diagonal. */
function box(cx: number, cy: number, r: number): StrokeSegment[] {
  return [
    { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy - r },
    { x1: cx + r, y1: cy - r, x2: cx + r, y2: cy + r },
    { x1: cx + r, y1: cy + r, x2: cx - r, y2: cy + r },
    { x1: cx - r, y1: cy + r, x2: cx - r, y2: cy - r },
    { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r },
  ];
}

describe("symbol signatures", () => {
  const r = 0.004;
  it("do not change under rotation, mirroring or translation", () => {
    const a = signatureOf(receptacle(0.2, 0.2, r))!;
    const b = signatureOf(receptacle(0.7, 0.4, r, Math.PI / 3))!;
    const c = signatureOf(receptacle(0.5, 0.8, r, Math.PI / 2, true))!;
    expect(signatureDistance(a, b)).toBeLessThan(0.15);
    expect(signatureDistance(a, c)).toBeLessThan(0.15);
  });
  it("tell a different symbol of the same size apart", () => {
    const a = signatureOf(receptacle(0.2, 0.2, r))!;
    const d = signatureOf(box(0.2, 0.2, r))!;
    expect(signatureDistance(a, d)).toBeGreaterThan(1);
  });
  it("drop the strokes under a text item", () => {
    const segs: StrokeSegment[] = [{ x1: 0.1, y1: 0.1, x2: 0.12, y2: 0.1 }, { x1: 0.5, y1: 0.5, x2: 0.52, y2: 0.5 }];
    expect(withoutText(segs, [{ x: 0.09, y: 0.09, width: 0.04, height: 0.02 }])).toEqual([segs[1]]);
  });
});

describe("find all like this", () => {
  const r = 0.004;
  const sheet: StrokeSegment[] = [
    // A wall the receptacles sit on — long, so never part of a symbol's cluster.
    { x1: 0.05, y1: 0.3, x2: 0.95, y2: 0.3 },
    ...receptacle(0.2, 0.3 + r * 1.7, r),
    ...receptacle(0.4, 0.3 + r * 1.7, r, Math.PI),
    ...receptacle(0.6, 0.3 + r * 1.7, r, Math.PI / 2, true),
    ...receptacle(0.8, 0.5, r, 0.4),
    ...box(0.3, 0.6, r),
    ...box(0.7, 0.6, r),
    // The same symbol twice the size is a different thing (a different fixture family).
    ...receptacle(0.5, 0.8, r * 2),
  ];
  const text = [{ x: 0.19, y: 0.314, width: 0.02, height: 0.01 }];

  it("finds every instance of the boxed symbol, rotated or mirrored, and nothing else", () => {
    const found = findSymbols(sheet, text, { x1: 0.2 - r * 2, y1: 0.3 + r * 0.5, x2: 0.2 + r * 1.2, y2: 0.3 + r * 3 });
    expect(found.template).not.toBeNull();
    expect(found.matches).toHaveLength(4);
    const centres = found.matches.map((m) => ((m.box.x1 + m.box.x2) / 2).toFixed(2)).sort();
    expect(centres).toEqual(["0.20", "0.40", "0.60", "0.80"]);
  });
  it("finds the other symbol when that one is boxed", () => {
    const found = findSymbols(sheet, [], { x1: 0.3 - r * 1.1, y1: 0.6 - r * 1.1, x2: 0.3 + r * 1.1, y2: 0.6 + r * 1.1 });
    expect(found.matches).toHaveLength(2);
  });
  it("returns nothing for an empty box", () => {
    expect(findSymbols(sheet, [], { x1: 0.01, y1: 0.01, x2: 0.02, y2: 0.02 }).matches).toHaveLength(0);
  });
});

describe("rigid coverage", () => {
  const r = 0.004;
  it("is one for the same strokes turned and mirrored, and ignores what else the candidate carries", () => {
    const t = receptacle(0.2, 0.2, r);
    const sig = signatureOf(t)!;
    const extra: StrokeSegment[] = [{ x1: 0.69, y1: 0.4, x2: 0.71, y2: 0.4 }, { x1: 0.7, y1: 0.39, x2: 0.7, y2: 0.41 }];
    expect(coverageOf(t, [...receptacle(0.7, 0.4, r, 1.1, true), ...extra], sig.radius)).toBeCloseTo(1, 2);
  });
  it("is low for a different symbol", () => {
    const t = receptacle(0.2, 0.2, r);
    expect(coverageOf(t, box(0.2, 0.2, r), signatureOf(t)!.radius)).toBeLessThan(0.3);
  });
});

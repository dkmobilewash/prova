import { describe, expect, it } from "vitest";
import type { StrokeSegment } from "./wallVectors";
import { coverageOf, findSymbols, findSymbolsFrom, samePen, signatureDistance, signatureOf, strokesInBox, symbolInk, symbolTemplate, withoutText } from "./symbolSignature";

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

describe("the pen is part of the symbol", () => {
  // A black 2x4 rectangle with a dot, sitting on a thin grey 2x4 tile; the
  // sheet has three more empty grey tiles. Only the fixture is the fixture.
  const rect = (x: number, y: number, extra: Partial<StrokeSegment>): StrokeSegment[] => [
    { x1: x, y1: y, x2: x + 0.014, y2: y, ...extra }, { x1: x + 0.014, y1: y, x2: x + 0.014, y2: y + 0.007, ...extra },
    { x1: x + 0.014, y1: y + 0.007, x2: x, y2: y + 0.007, ...extra }, { x1: x, y1: y + 0.007, x2: x, y2: y, ...extra },
  ];
  const black = { width: 1.3, gray: 0 }, grey = { width: 0.24, gray: 0.67 };
  const sheet: StrokeSegment[] = [
    ...rect(0.2, 0.3, black), ...rect(0.2, 0.3, grey),
    ...rect(0.2, 0.4, grey), ...rect(0.3, 0.3, grey), ...rect(0.3, 0.4, grey),
    ...rect(0.5, 0.5, black), ...rect(0.5, 0.5, grey),
  ];
  it("the grey tile under a fixture is background, not part of the symbol", () => {
    const tpl = symbolInk([...rect(0.2, 0.3, black), ...rect(0.2, 0.3, grey)]);
    expect(tpl.length).toBe(4);
    expect(tpl.every((s) => s.gray === 0)).toBe(true);
    // A symbol drawn entirely screened keeps every stroke.
    expect(symbolInk(rect(0.2, 0.3, grey)).length).toBe(4);
    // A fixture with its tile is found where a fixture has NO tile, too.
    const bare = [...sheet, ...rect(0.7, 0.7, black)];
    expect(findSymbols(bare, [], { x1: 0.199, y1: 0.299, x2: 0.215, y2: 0.308 }).matches.length).toBe(3);
  });
  it("an empty grey tile does not cover a black fixture", () => {
    const found = findSymbols(sheet, [], { x1: 0.199, y1: 0.299, x2: 0.215, y2: 0.308 });
    expect(found.matches.length).toBe(2);
    expect(samePen(rect(0, 0, black)[0]!, rect(0, 0, grey)[0]!)).toBe(false);
    expect(samePen(rect(0, 0, black)[0]!, { ...rect(0, 0, black)[0]!, width: 2 })).toBe(true);
    expect(samePen({ x1: 0, y1: 0, x2: 1, y2: 0 }, { x1: 0, y1: 0, x2: 1, y2: 0, width: 5 })).toBe(true);
  });
});

describe("the letters inside the box are part of the symbol", () => {
  // Three identical 24-gons: two read "OS", one reads "PC". Boxing an OS finds the OSs only.
  const circle = (cx: number, cy: number, r: number): StrokeSegment[] =>
    Array.from({ length: 24 }, (_, k) => {
      const a = (k / 24) * 2 * Math.PI, b = ((k + 1) / 24) * 2 * Math.PI;
      return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b), width: 1, gray: 0 };
    });
  const sheet = [...circle(0.2, 0.2, 0.004), ...circle(0.5, 0.2, 0.004), ...circle(0.5, 0.5, 0.004)];
  const text = [
    { x: 0.198, y: 0.199, width: 0.004, height: 0.002, str: "OS" },
    { x: 0.498, y: 0.199, width: 0.004, height: 0.002, str: "OS" },
    { x: 0.498, y: 0.499, width: 0.004, height: 0.002, str: "PC" },
  ];
  it("keeps the matches that read the same and reports the ones that do not", () => {
    const found = findSymbols(sheet, text, { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 });
    expect(found.label).toBe("OS");
    expect(found.matches.length).toBe(2);
    expect(found.offLabel).toBe(1);
    // Without words, the three are one symbol.
    const plain = findSymbols(sheet, text.map(({ str: _s, ...b }) => b), { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 });
    expect(plain.matches.length).toBe(3);
    expect(plain.label).toBeNull();
  });
});

describe("a number inside is the instance, a type tag beside is the kind", () => {
  const circle = (cx: number, cy: number, r: number): StrokeSegment[] =>
    Array.from({ length: 24 }, (_, k) => {
      const a = (k / 24) * 2 * Math.PI, b = ((k + 1) / 24) * 2 * Math.PI;
      return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b), width: 1, gray: 0 };
    });
  it("door tags numbered 101, 102, 103 are one symbol", () => {
    const sheet = [...circle(0.2, 0.2, 0.004), ...circle(0.5, 0.2, 0.004), ...circle(0.5, 0.5, 0.004)];
    const text = [
      { x: 0.198, y: 0.199, width: 0.004, height: 0.002, str: "101" },
      { x: 0.498, y: 0.199, width: 0.004, height: 0.002, str: "102" },
      { x: 0.498, y: 0.499, width: 0.004, height: 0.002, str: "103" },
    ];
    const found = findSymbols(sheet, text, { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 });
    expect(found.label).toBeNull();
    expect(found.matches.length).toBe(3);
  });
  it("letters inside say what it is, so a neighbour's tag asks nothing of the matches", () => {
    const sheet = [...circle(0.2, 0.2, 0.004), ...circle(0.5, 0.2, 0.004), ...circle(0.5, 0.5, 0.004)];
    const text = [
      { x: 0.198, y: 0.199, width: 0.004, height: 0.002, str: "OS" },
      { x: 0.498, y: 0.199, width: 0.004, height: 0.002, str: "OS" },
      { x: 0.498, y: 0.499, width: 0.004, height: 0.002, str: "OS" },
      { x: 0.196, y: 0.19, width: 0.012, height: 0.003, str: "R1" },
    ];
    const found = findSymbols(sheet, text, { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 });
    expect(found.tag).toBeNull();
    expect(found.matches).toHaveLength(3);
  });
  it("an empty symbol does not match the same shape with text across it", () => {
    const sheet = [...circle(0.2, 0.2, 0.004), ...circle(0.5, 0.2, 0.004), ...circle(0.5, 0.5, 0.004)];
    const text = [{ x: 0.503, y: 0.499, width: 0.02, height: 0.002, str: "XXXXXX" }];
    const found = findSymbols(sheet, text, { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 });
    expect(found.matches).toHaveLength(2);
  });
  it("on another sheet the tag decided on the boxed sheet is used, not whatever sits at that spot", () => {
    const sheet = [...circle(0.2, 0.2, 0.004), ...circle(0.5, 0.2, 0.004)];
    const text = [{ x: 0.196, y: 0.19, width: 0.012, height: 0.003, str: "E2 /INV-1" }, { x: 0.496, y: 0.19, width: 0.012, height: 0.003, str: "E2 /INV-3" }];
    const made = symbolTemplate(sheet, text, { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 })!;
    const other = [...circle(0.2, 0.2, 0.004), ...circle(0.5, 0.2, 0.004), ...circle(0.5, 0.5, 0.004)];
    const otherText = [{ x: 0.196, y: 0.19, width: 0.012, height: 0.003, str: "S1" }, { x: 0.496, y: 0.19, width: 0.012, height: 0.003, str: "E2" }, { x: 0.496, y: 0.49, width: 0.012, height: 0.003, str: "E2" }];
    const found = findSymbolsFrom(other, otherText, { ...made, decidedTag: "E2" });
    expect(found.tag).toBe("E2");
    expect(found.matches).toHaveLength(2);
  });
  it("the same block tagged E2 and R2 beside it is two kinds", () => {
    const sheet = [...circle(0.2, 0.2, 0.004), ...circle(0.5, 0.2, 0.004), ...circle(0.5, 0.5, 0.004)];
    const text = [
      { x: 0.196, y: 0.19, width: 0.012, height: 0.003, str: "E2 /INV-1" },
      { x: 0.496, y: 0.19, width: 0.012, height: 0.003, str: "E2 /INV-3" },
      { x: 0.496, y: 0.49, width: 0.012, height: 0.003, str: "R2 /INV-1" },
    ];
    const found = findSymbols(sheet, text, { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 });
    expect(found.tag).toBe("E2");
    expect(found.matches.length).toBe(2);
    expect(found.offTag).toBe(1);
    // A room name beside the symbol is not a type tag and asks nothing.
    const rooms = text.map((t, i) => ({ ...t, str: ["OFFICE", "STORAGE", "LOBBY"][i]! }));
    expect(findSymbols(sheet, rooms, { x1: 0.195, y1: 0.195, x2: 0.205, y2: 0.205 }).tag).toBeNull();
  });
});

describe("a chained strip light is counted once per unit", () => {
  // Three units tick-to-tick: |---o---|---o---|---o---| ; a template of one unit must not also land half a unit along.
  const unit = (x0: number, y: number): StrokeSegment[] => {
    const L = 0.014, tick = 0.002;
    const circle = Array.from({ length: 16 }, (_, k) => {
      const a = (k / 16) * 2 * Math.PI, b = ((k + 1) / 16) * 2 * Math.PI, r = 0.0012;
      return { x1: x0 + L / 2 + r * Math.cos(a), y1: y + r * Math.sin(a), x2: x0 + L / 2 + r * Math.cos(b), y2: y + r * Math.sin(b), width: 1, gray: 0 };
    });
    return [
      { x1: x0, y1: y - tick, x2: x0, y2: y + tick, width: 1, gray: 0 },
      { x1: x0, y1: y, x2: x0 + L / 2 - 0.0012, y2: y, width: 1, gray: 0 },
      { x1: x0 + L / 2 + 0.0012, y1: y, x2: x0 + L, y2: y, width: 1, gray: 0 },
      ...circle,
    ];
  };
  const sheet = [...unit(0.2, 0.3), ...unit(0.214, 0.3), ...unit(0.228, 0.3), { x1: 0.242, y1: 0.298, x2: 0.242, y2: 0.302, width: 1, gray: 0 }];
  it("finds three, not five", () => {
    const found = findSymbols(sheet, [], { x1: 0.199, y1: 0.296, x2: 0.2142, y2: 0.304 });
    expect(found.matches.length).toBe(3);
  });
});

describe("a circle drawn in two hundred pieces is one feature", () => {
  // A duplex receptacle: a 120-piece circle with two lines through it. The
  // junction box beside it is the same circle with three spokes. Only the
  // receptacle is a receptacle.
  const circle = (cx: number, cy: number, r: number, n: number): StrokeSegment[] =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * 2 * Math.PI, b = ((k + 1) / n) * 2 * Math.PI;
      return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b), width: 1, gray: 0 };
    });
  const duplex = (cx: number, cy: number): StrokeSegment[] => [
    ...circle(cx, cy, 0.002, 120),
    { x1: cx - 0.0007, y1: cy - 0.003, x2: cx - 0.0007, y2: cy + 0.003, width: 1, gray: 0 },
    { x1: cx + 0.0007, y1: cy - 0.003, x2: cx + 0.0007, y2: cy + 0.003, width: 1, gray: 0 },
  ];
  const junction = (cx: number, cy: number): StrokeSegment[] => [
    ...circle(cx, cy, 0.002, 120),
    ...[90, 210, 330].map((deg) => ({ x1: cx, y1: cy, x2: cx + 0.002 * Math.cos((deg * Math.PI) / 180), y2: cy + 0.002 * Math.sin((deg * Math.PI) / 180), width: 1, gray: 0 })),
  ];
  it("the lines through the circle keep their say", () => {
    const sheet = [...duplex(0.2, 0.2), ...duplex(0.4, 0.2), ...junction(0.6, 0.2), ...junction(0.6, 0.4)];
    const found = findSymbols(sheet, [], { x1: 0.1965, y1: 0.1965, x2: 0.2035, y2: 0.2035 });
    expect(found.matches.length).toBe(2);
  });
});

describe("a line that pokes out of the box is part of the symbol", () => {
  const circle = (cx: number, cy: number, r: number, n: number): StrokeSegment[] =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * 2 * Math.PI, b = ((k + 1) / n) * 2 * Math.PI;
      return { x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b), width: 1, gray: 0 };
    });
  const duplex = (cx: number, cy: number): StrokeSegment[] => [
    ...circle(cx, cy, 0.002, 12),
    { x1: cx - 0.0007, y1: cy - 0.003, x2: cx - 0.0007, y2: cy + 0.003, width: 1, gray: 0 },
    { x1: cx + 0.0007, y1: cy - 0.003, x2: cx + 0.0007, y2: cy + 0.003, width: 1, gray: 0 },
  ];
  it("a box snug round the circle still takes the lines, so a bare circle is not a receptacle", () => {
    const sheet = [...duplex(0.2, 0.2), ...duplex(0.4, 0.2), ...circle(0.6, 0.2, 0.002, 12), ...circle(0.6, 0.4, 0.002, 12)];
    const snug = { x1: 0.1978, y1: 0.1978, x2: 0.2022, y2: 0.2022 };
    expect(strokesInBox(sheet, snug).length).toBe(14);
    expect(findSymbols(sheet, [], snug).matches.length).toBe(2);
    // A long wall running through the box is still not the symbol.
    const wall = { x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.2, width: 1, gray: 0 };
    expect(strokesInBox([...sheet, wall], snug).length).toBe(14);
  });
});

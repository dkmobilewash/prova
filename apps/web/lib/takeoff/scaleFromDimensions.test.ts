import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURAL_SCALES,
  ENGINEERING_SCALES,
  scaleCandidates,
  scaleFromDimensions,
  type DimensionLabel,
} from "./scaleFromDimensions";
import type { StrokeSegment } from "./wallVectors";

/**
 * The scale a sheet is drawn at, read off the dimensions printed on it.
 *
 * Every case builds the geometry the way a drawing does: a dimension line of a
 * known length in POINTS, with its label sitting on it. At 1/8" = 1'-0" one foot
 * of building is 9 points, so an 11ft dimension is a 99pt line — the figures in
 * these cases are the figures a real sheet produced.
 */

/** A horizontal dimension line `lenPt` long at (x, y), with its label on it. */
function dimension(x: number, y: number, lenPt: number, text: string, feet: number) {
  const segment: StrokeSegment = { x1: x, y1: y, x2: x + lenPt, y2: y };
  const label: DimensionLabel = { text, feet, x: x + lenPt / 2, y: y - 4 };
  return { segment, label };
}

/** `count` dimensions all drawn at `feetPerInch`, spread down the page. */
function sheetAt(feetPerInch: number, count: number, startFeet = 8) {
  const segments: StrokeSegment[] = [];
  const labels: DimensionLabel[] = [];
  for (let i = 0; i < count; i += 1) {
    const feet = startFeet + i * 2;
    const lenPt = (feet / feetPerInch) * 72;
    const d = dimension(200, 200 + i * 300, lenPt, `${feet}' - 0"`, feet);
    segments.push(d.segment);
    labels.push(d.label);
  }
  return { segments, labels };
}

describe("every architectural scale is read back exactly", () => {
  // THE WHOLE RANGE, not a representative sample: the tightest neighbouring pair
  // is 1.333x apart and a reader that was systematically off by a constant would
  // pass on one scale and fail on its neighbour.
  for (const scale of ARCHITECTURAL_SCALES) {
    it(`reads ${scale.name}`, () => {
      const { segments, labels } = sheetAt(scale.feetPerInch, 6);
      const verdict = scaleFromDimensions(labels, segments);
      expect(verdict.ok, `declined: ${verdict.ok ? "" : verdict.reason}`).toBe(true);
      if (!verdict.ok) return;
      expect(verdict.scaleName).toBe(scale.name);
      expect(verdict.feetPerInch).toBeCloseTo(scale.feetPerInch, 4);
      expect(verdict.agreed).toHaveLength(6);
    });
  }
});

describe("the proposal it hands back is a real line and a real printed distance", () => {
  it("returns the pair, not a bare factor — which is the whole reason this is allowed to exist", () => {
    const { segments, labels } = sheetAt(8, 5);
    const verdict = scaleFromDimensions(labels, segments);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    // A line with two real endpoints…
    expect(Math.hypot(verdict.best.x2 - verdict.best.x1, verdict.best.y2 - verdict.best.y1)).toBeGreaterThan(0);
    // …and the figure printed beside it, which is what the drawing says.
    expect(verdict.best.declaredFeet).toBeGreaterThan(0);
    expect(verdict.best.text).toMatch(/^\d+' - 0"$/);
    // The pair's own reading reproduces the scale, so nothing has to be taken on
    // faith: the stored line is checkable against the sheet it came from.
    const impliedFeetPerInch =
      verdict.best.declaredFeet /
      (Math.hypot(verdict.best.x2 - verdict.best.x1, verdict.best.y2 - verdict.best.y1) / 72);
    expect(impliedFeetPerInch).toBeCloseTo(8, 2);
  });

  it("prefers the pair closest to the standard scale, since every measurement inherits it", () => {
    // Two dimensions: one exact at 1/8", one 1.5% off — inside tolerance, so
    // both vote, but the exact one is the one worth storing.
    const exact = dimension(200, 200, 99, `11' - 0"`, 11);
    const sloppy = dimension(200, 500, 99 * 1.015, `11' - 0"`, 11);
    const third = dimension(200, 800, 54, `6' - 0"`, 6);
    const verdict = scaleFromDimensions(
      [exact.label, { ...sloppy.label, text: `11' - 0" (b)` }, third.label],
      [exact.segment, sloppy.segment, third.segment],
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const len = Math.hypot(verdict.best.x2 - verdict.best.x1, verdict.best.y2 - verdict.best.y1);
    expect(len).toBeCloseTo(99, 0);
  });
});

describe("a mis-paired label is outvoted, not trusted", () => {
  it("survives the exact failure a real sheet produced", () => {
    // On the real export, `4' - 6"` sat nearer a 4.00ft line than its own, and a
    // reader that picked each label's best single segment took that as the
    // answer. Here the same shape: five good dimensions and one label whose
    // nearest line is wrong.
    const { segments, labels } = sheetAt(8, 5);
    const wrong = dimension(200, 1900, 36, `4' - 6"`, 4.5); // 36pt is 4.00ft at 1/8"
    const verdict = scaleFromDimensions([...labels, wrong.label], [...segments, wrong.segment]);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.scaleName).toBe('1/8" = 1\'-0"');
    expect(verdict.agreed).not.toContain(`4' - 6"`);
  });
});

describe("what it REFUSES, which is most of the value", () => {
  it("refuses a sheet with no dimensions at all", () => {
    const verdict = scaleFromDimensions([], [{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/No printed dimensions/);
  });

  it("refuses when only ONE dimension agrees — it agrees with itself", () => {
    const one = dimension(200, 200, 99, `11' - 0"`, 11);
    const verdict = scaleFromDimensions([one.label], [one.segment]);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/too few/);
  });

  it("refuses TWO agreeing dimensions, because one mis-pairing could be either of them", () => {
    const { segments, labels } = sheetAt(8, 2);
    const verdict = scaleFromDimensions(labels, segments);
    expect(verdict.ok).toBe(false);
  });

  it("refuses dimensions that match no standard scale", () => {
    // 7.3 ft per inch is not a scale anybody prints.
    const { segments, labels } = sheetAt(7.3, 6);
    const verdict = scaleFromDimensions(labels, segments);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/do not match any standard/);
  });

  it("REFUSES A TWO-SCALE SHEET and names both, which is ordinary drafting rather than a fault", () => {
    // A 1/8" plan and a 1-1/2" detail on one sheet — real, common, and the case
    // #640 already warns about. Equal support, so neither wins the margin.
    const plan = sheetAt(8, 4);
    const detail = sheetAt(2 / 3, 4, 3);
    const verdict = scaleFromDimensions(
      [...plan.labels, ...detail.labels.map((l, i) => ({ ...l, text: `d${i}:${l.text}`, y: l.y + 4000 }))],
      [...plan.segments, ...detail.segments.map((s) => ({ ...s, y1: s.y1 + 4000, y2: s.y2 + 4000 }))],
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/two different scales/);
    expect(verdict.reason).toContain('1/8" = 1\'-0"');
  });

  it("refuses a sheet whose labels are nowhere near a line", () => {
    const labels: DimensionLabel[] = [
      { text: `11' - 0"`, feet: 11, x: 100, y: 100 },
      { text: `9' - 0"`, feet: 9, x: 200, y: 200 },
      { text: `6' - 0"`, feet: 6, x: 300, y: 300 },
    ];
    const verdict = scaleFromDimensions(labels, [{ x1: 2000, y1: 2000, x2: 2099, y2: 2000 }]);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/not beside any line/);
  });

  it("refuses a dimension of zero or negative feet rather than dividing by it", () => {
    const { segments, labels } = sheetAt(8, 5);
    const bad: DimensionLabel = { text: `0' - 0"`, feet: 0, x: 200, y: 200 };
    const verdict = scaleFromDimensions([...labels, bad], segments);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.agreed).not.toContain(`0' - 0"`);
  });
});

describe("the engineering scales are excluded, and that is load-bearing", () => {
  it("DECLINES a civil sheet rather than reading it as an architectural one", () => {
    // 1" = 20' is 1.25x from 1/16", so a reader voting over all nineteen scales
    // could land either side of it. This product takes off architectural sheets.
    const { segments, labels } = sheetAt(20, 6);
    const verdict = scaleFromDimensions(labels, segments);
    expect(verdict.ok).toBe(false);
  });

  it("keeps 3/32in readable even though 1in = 10ft sits 3.3% away", () => {
    // The tightest collision in the full nineteen, and the reason this module
    // votes over twelve. 3/32" must still be readable on its own.
    const { segments, labels } = sheetAt(32 / 3, 6);
    const verdict = scaleFromDimensions(labels, segments);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.scaleName).toBe('3/32" = 1\'-0"');
  });
});

/**
 * THE TWO-LIST CENSUS the module's header promises.
 *
 * `ARCHITECTURAL_SCALES` is a deliberate second copy of twelve of
 * `takeoff-plan.ts`'s nineteen. CLAUDE.md's rule is that a canonical list needs
 * both guards — one that it is complete, one that it is the only one — and a
 * genuine second list is exactly the case where the second guard has to be
 * written rather than assumed. If the two drift, a sheet reads at a scale the
 * calibration readback cannot name.
 */
describe("the two scale lists cannot drift apart", () => {
  const source = readFileSync(new URL("../takeoff-plan.ts", import.meta.url), "utf8");

  it("finds the names in takeoff-plan.ts at all, so this census cannot pass on nothing", () => {
    const names = source.match(/name: '[^']+'/g) ?? [];
    expect(names.length, "the scale table in takeoff-plan.ts was not parsed").toBeGreaterThanOrEqual(19);
  });

  it("every scale here exists there, by name", () => {
    for (const scale of ARCHITECTURAL_SCALES) {
      // The file writes the name with escaped quotes; compare on the inner text.
      const needle = scale.name.replace(/'/g, "\\'");
      expect(source.includes(needle) || source.includes(scale.name), `${scale.name} is not in takeoff-plan.ts`).toBe(
        true,
      );
    }
  });

  it("every ENGINEERING scale here is one takeoff-plan.ts also knows", () => {
    for (const feet of ENGINEERING_SCALES) {
      expect(source).toContain(`feetPerInch: ${feet},`);
    }
  });

  it("holds the architectural count, so a scale added there is noticed here", () => {
    expect(ARCHITECTURAL_SCALES).toHaveLength(12);
    expect(ENGINEERING_SCALES).toHaveLength(7);
  });

  it("the architectural scales are far enough apart to tell apart", () => {
    // The accuracy argument, as an assertion rather than a comment. 1.333x is
    // the tightest neighbouring pair, so 15.5% of error is needed to cross.
    const sorted = [...ARCHITECTURAL_SCALES].sort((a, b) => a.feetPerInch - b.feetPerInch);
    let tightest = Infinity;
    for (let i = 1; i < sorted.length; i += 1) {
      tightest = Math.min(tightest, sorted[i].feetPerInch / sorted[i - 1].feetPerInch);
    }
    expect(tightest).toBeGreaterThan(1.33);
    // And the margin that follows from it, which is what the header claims.
    expect((Math.sqrt(tightest) - 1) * 100).toBeGreaterThan(15);
  });

  it("ADDING THE ENGINEERING SCALES WOULD BREAK THAT, which is why they are excluded", () => {
    const all = [...ARCHITECTURAL_SCALES.map((s) => s.feetPerInch), ...ENGINEERING_SCALES].sort((a, b) => a - b);
    let tightest = Infinity;
    for (let i = 1; i < all.length; i += 1) tightest = Math.min(tightest, all[i] / all[i - 1]);
    // 1.0667x — a 3.3% margin. This test exists so that nobody "tidies up" by
    // voting over one combined list.
    expect(tightest).toBeLessThan(1.07);
  });
});

describe("candidate pairing", () => {
  it("gives EVERY nearby segment a vote rather than picking one per label", () => {
    // Three segments near one label. All three are candidates; the vote sorts
    // them out later. A pairing that returned one would discard the evidence
    // that makes a mis-pairing survivable.
    const label: DimensionLabel = { text: `11' - 0"`, feet: 11, x: 250, y: 196 };
    const segments: StrokeSegment[] = [
      { x1: 200, y1: 200, x2: 299, y2: 200 },
      { x1: 200, y1: 210, x2: 290, y2: 210 },
      { x1: 200, y1: 220, x2: 310, y2: 220 },
    ];
    expect(scaleCandidates([label], segments)).toHaveLength(3);
  });

  it("ignores segments too short for a printed figure to mean anything", () => {
    const label: DimensionLabel = { text: `11' - 0"`, feet: 11, x: 200, y: 200 };
    expect(scaleCandidates([label], [{ x1: 200, y1: 200, x2: 204, y2: 200 }])).toEqual([]);
  });

  it("ignores a label far from every segment", () => {
    const label: DimensionLabel = { text: `11' - 0"`, feet: 11, x: 100, y: 100 };
    expect(scaleCandidates([label], [{ x1: 2000, y1: 2000, x2: 2099, y2: 2000 }])).toEqual([]);
  });
});

describe("the error band it reports is the error it has", () => {
  it("reports the stored pair's own distance from the scale the sheet voted for", () => {
    // Five exact dimensions and one 1% out. The exact ones win the vote; the
    // pair stored is an exact one, so the band is ~0.
    const { segments, labels } = sheetAt(8, 5);
    const verdict = scaleFromDimensions(labels, segments);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.inheritedError).toBeLessThan(0.0005);
  });

  it("REFUSES when the best line available is further out than a takeoff can absorb", () => {
    // Every dimension 1% off: inside SCALE_TOLERANCE so they still vote and
    // agree, but 1% is twice MAX_INHERITED_ERROR and 1% of a 3,000ft takeoff is
    // 30 feet. Agreement on a scale is not the same as a line worth storing.
    const segments = [];
    const labels = [];
    for (let i = 0; i < 6; i += 1) {
      const feet = 8 + i * 2;
      const lenPt = (feet / 8) * 72 * 1.01; // 1% long
      const d = dimension(200, 200 + i * 300, lenPt, `${feet}' - 0"`, feet);
      segments.push(d.segment);
      labels.push(d.label);
    }
    const verdict = scaleFromDimensions(labels, segments);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/out — enough to move every quantity/);
  });

  it("prefers a LONGER accurate line over a shorter equally accurate one", () => {
    // Both exact. The longer one is steadier under any later nudge, which is
    // the reasoning `MIN_CALIBRATION_SPAN` rests on.
    const short = dimension(200, 200, 54, `6' - 0"`, 6);
    const long = dimension(200, 600, 144, `16' - 0"`, 16);
    const third = dimension(200, 1000, 99, `11' - 0"`, 11);
    const verdict = scaleFromDimensions(
      [short.label, long.label, third.label],
      [short.segment, long.segment, third.segment],
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.best.declaredFeet).toBe(16);
  });
});

describe("a label belongs to the line it is CENTRED on", () => {
  it("ignores a long line the label merely sits near, which is how a real sheet broke this", () => {
    // The defect this test exists for: pairing by a radius proportional to the
    // segment's own length let every long wall face near a label collect a
    // vote, and a line four times too long explains the same figure at a scale
    // four times finer. On the real export that produced 5,698 pairings from 30
    // labels and a split vote.
    const label: DimensionLabel = { text: `11' - 0"`, feet: 11, x: 250, y: 196 };
    const itsOwn: StrokeSegment = { x1: 200, y1: 200, x2: 299, y2: 200 };
    // A wall face running the width of the sheet, passing right under the label.
    const wallFace: StrokeSegment = { x1: 0, y1: 205, x2: 3000, y2: 205 };
    const pairs = scaleCandidates([label], [itsOwn, wallFace]);
    expect(pairs).toHaveLength(1);
    expect(Math.hypot(pairs[0].x2 - pairs[0].x1, pairs[0].y2 - pairs[0].y1)).toBeCloseTo(99, 0);
  });

  it("ignores a line the label sits at the END of rather than the middle of", () => {
    const label: DimensionLabel = { text: `11' - 0"`, feet: 11, x: 205, y: 196 };
    expect(scaleCandidates([label], [{ x1: 200, y1: 200, x2: 500, y2: 200 }])).toEqual([]);
  });

  it("ignores a line the label is far from across, however well centred", () => {
    const label: DimensionLabel = { text: `11' - 0"`, feet: 11, x: 250, y: 100 };
    expect(scaleCandidates([label], [{ x1: 200, y1: 200, x2: 299, y2: 200 }])).toEqual([]);
  });

  it("accepts a VERTICAL dimension, which half of a plan's are", () => {
    const label: DimensionLabel = { text: `11' - 0"`, feet: 11, x: 196, y: 250 };
    const pairs = scaleCandidates([label], [{ x1: 200, y1: 200, x2: 200, y2: 299 }]);
    expect(pairs).toHaveLength(1);
  });
});

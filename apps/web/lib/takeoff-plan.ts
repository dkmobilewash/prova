/**
 * Turning geometry somebody traced on a drawing into measured primitives.
 *
 * THE BAR THIS HAS TO CLEAR IS WRITTEN IN `takeoff.ts`: "a measuring tool that
 * is slightly wrong is more dangerous than no measuring tool, because a number
 * that came off a screen gets trusted." That sentence deferred this feature for
 * weeks and it is right. Everything unusual in this module is an answer to it.
 *
 * WHAT THIS PRODUCES, AND WHAT IT REFUSES TO PRODUCE. `takeoff-recipes.ts`
 * draws the line this file sits on: the capture layer emits PRIMITIVES —
 * linear feet, square feet, a count — and never materials. The fuzzy part (what
 * somebody traced, at what scale) is confirmed by a person; the exact part (how
 * many sheets that is) is the recipe arithmetic, which cannot drift. This file
 * is entirely the first half.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PAGE-WIDTH BOX — the one contract every stored coordinate is in
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `page.getViewport({ scale: 1 })`, with pdf.js having already applied the
 * page's own `/Rotate`, gives a width and height in PDF points. Every stored
 * coordinate is the pointer offset divided by the RENDERED WIDTH — on BOTH
 * axes. So `x` runs 0..1 and `y` runs 0..H/W. **`y` is not a fraction of the
 * height.**
 *
 * That asymmetry is deliberate and it is the whole reason the server needs no
 * PDF library. Normalising each axis by its own extent — which is what
 * `JobMediaAnnotation` does for photo marks — distorts Euclidean distance by
 * the aspect ratio, so every length would need the page's dimensions stored
 * beside it to be meaningful. `media-annotations.prisma` spends thirty lines on
 * why a second column that can disagree is the thing to avoid, and issue #256
 * is what it cost when the comment naming the box was wrong: a GC was shown an
 * arrow pointing at the wrong part of a photo "while every comment in the
 * codebase said the geometry was handled."
 *
 * Dividing both axes by the width instead means a distance is computable from
 * the stored coordinates ALONE. `pageWidthPt` exists on the page row, but
 * nothing here reads it for a quantity — only for naming the paper scale.
 *
 * Pure. No database, no React, no pdfjs. Every number below can be checked on a
 * laptop with no drawing in front of you.
 */

import type { Opening, WallInput } from "@/lib/takeoff";
import type { Primitive, RecipeInput } from "@/lib/takeoff-recipes";

/** A calibration as stored: the line somebody dragged along a known dimension,
 * in page-width units, and what the drawing says that dimension is. */
export type StoredCalibration = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  declaredDistanceFeet: number;
};

export type MeasurementKind = "LINEAR" | "AREA" | "COUNT";

/** A measurement as stored, with the calibration it was drawn to. The
 * calibration travels WITH the measurement rather than being looked up,
 * because a page may have several and the one that matters is the one this
 * measurement was taken against. */
export type StoredMeasurement = {
  kind: MeasurementKind;
  xs: number[];
  ys: number[];
  label: string | null;
  calibration: StoredCalibration;
};

/**
 * A calibration line shorter than this fraction of the page width is REFUSED.
 *
 * The error in a scale is the error in the two clicks divided by the length
 * between them, so a short line multiplies a two-pixel slip across the whole
 * sheet. At 0.05 — a twentieth of the page — a 2px error on a 1200px render is
 * already ±3%, which on a 200 ft building is six feet.
 */
export const MIN_CALIBRATION_SPAN = 0.05;

/** Below this, the calibration is allowed but the form says what the error
 * band works out to, because "allowed" and "advisable" are different. */
export const SHORT_CALIBRATION_SPAN = 0.15;

/** A traced shape may not carry more vertices than this. A corridor traced
 * around its inside face is a few dozen points; five hundred is a runaway
 * pointer handler, and an unbounded array is a payload nobody sized. */
export const MAX_VERTICES = 500;

/** Two decimals, matching `takeoff.ts` — a quantity should read like a
 * quantity rather than like a float. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * How many feet one page-width spans, or null when the calibration cannot
 * support an answer.
 *
 * THIS IS NOT A STORED COLUMN, on purpose. It is two stored numbers divided,
 * and a third number beside two that already determine it is a number that
 * wins silently on the day they disagree.
 */
export function feetPerPageWidth(calibration: StoredCalibration): number | null {
  const span = Math.hypot(calibration.x2 - calibration.x1, calibration.y2 - calibration.y1);
  if (!(span > 0) || !(calibration.declaredDistanceFeet > 0)) return null;
  if (span < MIN_CALIBRATION_SPAN) return null;
  return calibration.declaredDistanceFeet / span;
}

/** Whether a stored shape is usable at all: matched axes, enough points for
 * its kind, every value finite and inside the box. A row written by an older
 * build is not evidence of anything, so this runs on the way out as well as
 * on the way in. */
export function verticesProblem(kind: MeasurementKind, xs: number[], ys: number[]): string | null {
  if (xs.length !== ys.length) return "That shape's coordinates don't line up.";
  if (xs.length > MAX_VERTICES) return `That shape has more than ${MAX_VERTICES} points.`;
  for (let i = 0; i < xs.length; i += 1) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) return "That shape has a point that isn't a number.";
    if (xs[i] < 0 || xs[i] > 1) return "That shape has a point off the side of the sheet.";
    if (ys[i] < 0 || ys[i] > 4) return "That shape has a point off the top or bottom of the sheet.";
  }
  const needed = kind === "AREA" ? 3 : kind === "LINEAR" ? 2 : 1;
  if (xs.length < needed) {
    const noun = kind === "AREA" ? "an area" : kind === "LINEAR" ? "a line" : "a count";
    return `That isn't ${noun} yet — it needs at least ${needed} point${needed === 1 ? "" : "s"}.`;
  }
  return null;
}

/** Length of an open polyline, in page-width units. */
export function polylineLength(xs: number[], ys: number[]): number {
  let total = 0;
  for (let i = 1; i < xs.length; i += 1) {
    total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return total;
}

/** Do segments `a`-`b` and `c`-`d` properly cross? Shared endpoints do not
 * count: consecutive edges of a ring always touch. */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => {
    const value = (qx - px) * (ry - py) - (qy - py) * (rx - px);
    if (Math.abs(value) < 1e-12) return 0;
    return value > 0 ? 1 : -1;
  };
  const d1 = side(ax, ay, bx, by, cx, cy);
  const d2 = side(ax, ay, bx, by, dx, dy);
  const d3 = side(cx, cy, dx, dy, ax, ay);
  const d4 = side(cx, cy, dx, dy, bx, by);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/** Does the closed ring cross itself? */
export function ringSelfIntersects(xs: number[], ys: number[]): boolean {
  const n = xs.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const i2 = (i + 1) % n;
    for (let j = i + 1; j < n; j += 1) {
      const j2 = (j + 1) % n;
      if (i === j || i2 === j || j2 === i) continue;
      if (segmentsCross(xs[i], ys[i], xs[i2], ys[i2], xs[j], ys[j], xs[j2], ys[j2])) return true;
    }
  }
  return false;
}

/**
 * Area of a closed ring in page-width units squared, or null if the ring
 * crosses itself.
 *
 * THE REFUSAL IS THE POINT. The shoelace formula happily returns a number for
 * a bowtie — the two lobes partly cancel — and that number is plausible,
 * smaller than either lobe, and wrong. A figure that looks reasonable and is
 * wrong is the failure mode this whole module is built against, so a ring that
 * crosses itself gets no area at all and the screen says to redraw it.
 */
export function ringArea(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  if (ringSelfIntersects(xs, ys)) return null;
  let twice = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const j = (i + 1) % xs.length;
    twice += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(twice) / 2;
}

/**
 * One stored measurement as the primitive a recipe consumes, or null when it
 * cannot be measured (no usable calibration, a bad shape, a crossing ring).
 *
 * NOTE THE SQUARE on the area branch. A scale converts a length, so it
 * converts an area by its square — forgetting that is how a takeoff comes out
 * exactly twelve times wrong while every individual number looks sane.
 */
export function measurementPrimitive(measurement: StoredMeasurement): Primitive | null {
  const { kind, xs, ys, calibration } = measurement;
  if (verticesProblem(kind, xs, ys)) return null;

  if (kind === "COUNT") {
    const item = (measurement.label ?? "").trim();
    if (!item) return null;
    return { kind: "count", count: xs.length, item };
  }

  const scale = feetPerPageWidth(calibration);
  if (scale === null) return null;

  if (kind === "LINEAR") {
    return { kind: "linear", feet: round2(polylineLength(xs, ys) * scale) };
  }

  const area = ringArea(xs, ys);
  if (area === null) return null;
  return { kind: "area", squareFeet: round2(area * scale * scale) };
}

/** What a wall run needs that a drawing cannot supply. The height is not on
 * the plan — it is in the wall schedule or in somebody's head — so it is typed
 * at posting time rather than stored as plan geometry. */
export type WallBridge = {
  heightFt: number;
  sides: 1 | 2;
  openings: Opening[];
};

export type RecipeInputsResult =
  | { ok: true; inputs: RecipeInput[] }
  | { ok: false; error: string };

/**
 * Selected measurements as the inputs a recipe takes.
 *
 * THE ONE ASYMMETRY THAT MATTERS: `paint`, `flooring` and `fixture-count` sum
 * over every primitive they are handed, while `wall` and `ceiling` reach for
 * the FIRST structured input with `.find()`. So a wall built from traced runs
 * must arrive as exactly one `{kind:"wall"}` whose length is the runs added
 * together — not as one wall per run, which would silently price only the
 * first of them.
 *
 * `ceiling` is absent by design and the screen says why: a traced polygon has
 * an area, not a length and a width, and inventing them from a bounding box is
 * the kind of guess this codebase refuses everywhere else.
 */
export function recipeInputsFromMeasurements(
  recipeId: string,
  measurements: StoredMeasurement[],
  wall: WallBridge | null,
): RecipeInputsResult {
  if (measurements.length === 0) {
    return { ok: false, error: "Pick at least one measurement." };
  }

  const primitives: Primitive[] = [];
  for (const measurement of measurements) {
    const primitive = measurementPrimitive(measurement);
    if (!primitive) {
      return { ok: false, error: refusalFor(measurement) };
    }
    primitives.push(primitive);
  }

  if (recipeId !== "wall") {
    return { ok: true, inputs: primitives };
  }

  if (!wall) {
    return { ok: false, error: "A wall needs a height — the drawing doesn't carry one." };
  }
  const runs = primitives.filter((p): p is Extract<Primitive, { kind: "linear" }> => p.kind === "linear");
  if (runs.length === 0) {
    return { ok: false, error: "A wall is built from traced runs — pick at least one line measurement." };
  }
  const lengthFt = round2(runs.reduce((total, run) => total + run.feet, 0));
  const built: WallInput = {
    lengthFt,
    heightFt: wall.heightFt,
    sides: wall.sides,
    openings: wall.openings,
  };
  return { ok: true, inputs: [{ kind: "wall", wall: built }] };
}

/** Why one measurement could not be measured, in the words the screen shows.
 * Specific rather than "something was wrong": the three causes have three
 * different fixes. */
function refusalFor(measurement: StoredMeasurement): string {
  const named = measurement.label?.trim() ? `"${measurement.label.trim()}"` : "One measurement";
  const shape = verticesProblem(measurement.kind, measurement.xs, measurement.ys);
  if (shape) return `${named}: ${shape}`;
  if (measurement.kind === "COUNT") {
    return `${named === "One measurement" ? "A count" : named} needs a name for what is being counted.`;
  }
  if (feetPerPageWidth(measurement.calibration) === null) {
    return `${named} was drawn to a scale that can no longer be read — re-check the sheet's scale.`;
  }
  return `${named} crosses itself, so it has no area. Redraw it without the crossing.`;
}

// ───────────────────────────────────────────────────────────────────────────
// Naming the scale back to the person who set it
// ───────────────────────────────────────────────────────────────────────────

/** The imperial scales a drawing is actually printed at, as feet per inch of
 * paper. Architectural first, then engineering — the two families an estimator
 * recognises by name. */
const STANDARD_SCALES: { feetPerInch: number; name: string }[] = [
  { feetPerInch: 32, name: '1/32" = 1\'-0"' },
  { feetPerInch: 16, name: '1/16" = 1\'-0"' },
  { feetPerInch: 32 / 3, name: '3/32" = 1\'-0"' },
  { feetPerInch: 8, name: '1/8" = 1\'-0"' },
  { feetPerInch: 16 / 3, name: '3/16" = 1\'-0"' },
  { feetPerInch: 4, name: '1/4" = 1\'-0"' },
  { feetPerInch: 8 / 3, name: '3/8" = 1\'-0"' },
  { feetPerInch: 2, name: '1/2" = 1\'-0"' },
  { feetPerInch: 4 / 3, name: '3/4" = 1\'-0"' },
  { feetPerInch: 1, name: '1" = 1\'-0"' },
  { feetPerInch: 2 / 3, name: '1-1/2" = 1\'-0"' },
  { feetPerInch: 1 / 3, name: '3" = 1\'-0"' },
  { feetPerInch: 10, name: '1" = 10\'' },
  { feetPerInch: 20, name: '1" = 20\'' },
  { feetPerInch: 30, name: '1" = 30\'' },
  { feetPerInch: 40, name: '1" = 40\'' },
  { feetPerInch: 50, name: '1" = 50\'' },
  { feetPerInch: 60, name: '1" = 60\'' },
  { feetPerInch: 100, name: '1" = 100\'' },
];

/** Within 2% counts as that scale. Two clicks on a grid line are not exact,
 * and a tolerance tight enough to reject an honest calibration would teach
 * people to ignore the readback. */
const SCALE_TOLERANCE = 0.02;

export type ScaleReading = {
  /** Feet of building per inch of paper. */
  feetPerInch: number;
  /** `1/8" = 1'-0"`, or null when it matches no standard scale. */
  name: string | null;
  /** The ratio an engineer would write: 96 for 1/8". */
  ratio: number;
  /** How wide the whole sheet reads, in feet. */
  sheetWidthFeet: number;
};

/**
 * What the calibration says the sheet is, in the vocabulary of the title
 * block. Needs the page width in points, which is the ONLY thing that number
 * is used for — a wrong `pageWidthPt` mislabels a scale and cannot mis-measure
 * a wall.
 *
 * Returns null rather than guessing when the page width is unknown.
 */
export function readScale(calibration: StoredCalibration, pageWidthPt: number | null): ScaleReading | null {
  const perPageWidth = feetPerPageWidth(calibration);
  if (perPageWidth === null) return null;
  if (pageWidthPt === null || !(pageWidthPt > 0)) return null;

  const paperInches = pageWidthPt / 72;
  const feetPerInch = perPageWidth / paperInches;
  const match = STANDARD_SCALES.find(
    (scale) => Math.abs(feetPerInch - scale.feetPerInch) / scale.feetPerInch <= SCALE_TOLERANCE,
  );
  return {
    feetPerInch,
    name: match?.name ?? null,
    ratio: feetPerInch * 12,
    sheetWidthFeet: perPageWidth,
  };
}

/** A sheet that reads narrower or wider than any real building is a typo in
 * the declared distance — a decimal place, or feet typed where inches were
 * meant. Not a refusal: a detail sheet and a site plan are both legitimate. */
export const PLAUSIBLE_SHEET_WIDTH_FEET = { min: 10, max: 2000 } as const;

export type CalibrationNotice = { level: "refuse" | "warn"; message: string };

/**
 * Everything worth saying about a calibration before it is saved, in the order
 * it should be read. This is the safeguard that earns its keep: the scale is
 * read back in the estimator's own vocabulary while the drawing is still on
 * screen, so a wrong one is caught before a single quantity is taken from it.
 */
export function calibrationNotices(
  calibration: StoredCalibration,
  pageWidthPt: number | null,
  renderedWidthPx: number | null,
): CalibrationNotice[] {
  const notices: CalibrationNotice[] = [];
  const span = Math.hypot(calibration.x2 - calibration.x1, calibration.y2 - calibration.y1);

  if (!(calibration.declaredDistanceFeet > 0)) {
    return [{ level: "refuse", message: "Type what that dimension says on the drawing." }];
  }
  if (!(span > 0)) {
    return [{ level: "refuse", message: "Drag along a dimension on the drawing first." }];
  }
  if (span < MIN_CALIBRATION_SPAN) {
    return [
      {
        level: "refuse",
        message:
          "That line is too short to set a scale from — a small slip in either end would move every quantity on the sheet. Drag along a longer dimension.",
      },
    ];
  }

  const reading = readScale(calibration, pageWidthPt);
  if (reading) {
    notices.push(
      reading.name
        ? {
            level: "warn",
            message: `1 in = ${round2(reading.feetPerInch)} ft — that's ${reading.name} (1:${Math.round(reading.ratio)}).`,
          }
        : {
            level: "warn",
            message: `This isn't a standard scale — 1 in = ${round2(reading.feetPerInch)} ft. Check the distance you typed, or that this sheet was printed to scale.`,
          },
    );
  }

  const sheetWidth = feetPerPageWidth(calibration);
  if (sheetWidth !== null) {
    notices.push({ level: "warn", message: `This sheet reads ${Math.round(sheetWidth)} ft across.` });
    if (sheetWidth < PLAUSIBLE_SHEET_WIDTH_FEET.min || sheetWidth > PLAUSIBLE_SHEET_WIDTH_FEET.max) {
      notices.push({
        level: "warn",
        message: "That's outside the range a drawing usually covers — check the distance you typed.",
      });
    }
  }

  if (span < SHORT_CALIBRATION_SPAN && sheetWidth !== null && renderedWidthPx && renderedWidthPx > 0) {
    // One pixel of click error, expressed over a length somebody will measure.
    const feetPerPixel = sheetWidth / renderedWidthPx;
    const bandOver100ft = (feetPerPixel / (span * sheetWidth)) * 100;
    notices.push({
      level: "warn",
      message: `Short calibration line: ±1 px at this zoom is about ±${bandOver100ft.toFixed(1)} ft over a 100 ft run. A longer line is steadier.`,
    });
  }

  return notices;
}

/** Does anything here stop the calibration being saved? */
export function calibrationRefusal(notices: CalibrationNotice[]): string | null {
  return notices.find((notice) => notice.level === "refuse")?.message ?? null;
}

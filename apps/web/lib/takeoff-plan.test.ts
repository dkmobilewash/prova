import { describe, expect, it } from "vitest";

import {
  MAX_VERTICES,
  MIN_CALIBRATION_SPAN,
  calibrationNotices,
  calibrationRefusal,
  feetPerPageWidth,
  measurementPrimitive,
  polylineLength,
  readScale,
  recipeInputsFromMeasurements,
  ringArea,
  ringSelfIntersects,
  verticesProblem,
  type StoredCalibration,
  type StoredMeasurement,
} from "./takeoff-plan";
import { recipeLines } from "./takeoff-recipes";

/**
 * Every fixture here is at a scale an estimator would recognise, so a wrong
 * answer is WRONG rather than merely different — 6 sq ft where 600 belongs is
 * obvious; 0.0601 where 0.06 belongs is not.
 *
 * `ROUND`: a calibration line spanning 0.4 of the page width, declared as
 * 40 ft, so one page width is exactly 100 ft and every figure below is
 * arithmetic anybody can check in their head.
 */
const ROUND: StoredCalibration = { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2, declaredDistanceFeet: 40 };

/** A 30x42 sheet (42 in wide = 3024 pt) at 1/4" = 1'-0": half the page width
 * declared as 84 ft puts 168 ft across 42 inches of paper, i.e. 4 ft/in. */
const QUARTER_INCH: StoredCalibration = { x1: 0.25, y1: 0.5, x2: 0.75, y2: 0.5, declaredDistanceFeet: 84 };
const SHEET_42_IN_PT = 42 * 72;

const measurement = (over: Partial<StoredMeasurement> & Pick<StoredMeasurement, "kind">): StoredMeasurement => ({
  xs: [],
  ys: [],
  label: null,
  calibration: ROUND,
  ...over,
});

describe("reading a scale off a calibration line", () => {
  it("turns the drawn line and the typed distance into feet per page width", () => {
    expect(feetPerPageWidth(ROUND)).toBeCloseTo(100, 10);
  });

  it("measures the diagonal, not the bounding box", () => {
    // 3-4-5: a line 0.3 across and 0.4 down spans 0.5, declared 50 ft.
    const diagonal: StoredCalibration = { x1: 0, y1: 0, x2: 0.3, y2: 0.4, declaredDistanceFeet: 50 };
    expect(feetPerPageWidth(diagonal)).toBeCloseTo(100, 10);
  });

  it("refuses a calibration line too short to be steady", () => {
    const stubby: StoredCalibration = { ...ROUND, x2: ROUND.x1 + MIN_CALIBRATION_SPAN / 2 };
    expect(feetPerPageWidth(stubby)).toBeNull();
  });

  it("refuses a zero or negative declared distance rather than dividing by it", () => {
    expect(feetPerPageWidth({ ...ROUND, declaredDistanceFeet: 0 })).toBeNull();
    expect(feetPerPageWidth({ ...ROUND, declaredDistanceFeet: -40 })).toBeNull();
  });
});

describe("naming the scale back", () => {
  it("recognises a quarter-inch architectural scale and its ratio", () => {
    const reading = readScale(QUARTER_INCH, SHEET_42_IN_PT);
    expect(reading).not.toBeNull();
    expect(reading!.feetPerInch).toBeCloseTo(4, 6);
    expect(reading!.name).toBe('1/4" = 1\'-0"');
    expect(Math.round(reading!.ratio)).toBe(48);
    expect(reading!.sheetWidthFeet).toBeCloseTo(168, 6);
  });

  it("names nothing when the scale is not a standard one", () => {
    // 1 in = 7.3 ft matches no architectural or engineering scale.
    const odd: StoredCalibration = { ...QUARTER_INCH, declaredDistanceFeet: 153.3 };
    const reading = readScale(odd, SHEET_42_IN_PT);
    expect(reading!.name).toBeNull();
  });

  it("says nothing at all rather than guessing when the page width is unknown", () => {
    expect(readScale(QUARTER_INCH, null)).toBeNull();
  });
});

describe("measuring a traced line", () => {
  it("adds the segments of a polyline", () => {
    expect(polylineLength([0, 0.1, 0.1], [0, 0, 0.2])).toBeCloseTo(0.3, 10);
  });

  it("reads a 40 ft run as 40 ft", () => {
    const line = measurement({ kind: "LINEAR", xs: [0.1, 0.5], ys: [0.6, 0.6] });
    expect(measurementPrimitive(line)).toEqual({ kind: "linear", feet: 40 });
  });
});

describe("measuring a traced area", () => {
  it("scales by the SQUARE of the scale, not by the scale", () => {
    // 0.2 x 0.3 of a 100 ft page width = 20 ft x 30 ft = 600 sq ft.
    // Applying the scale once would give 6, which is the bug this pins.
    const rectangle = measurement({
      kind: "AREA",
      xs: [0.1, 0.3, 0.3, 0.1],
      ys: [0.1, 0.1, 0.4, 0.4],
    });
    expect(measurementPrimitive(rectangle)).toEqual({ kind: "area", squareFeet: 600 });
  });

  it("measures a triangle as half its bounding rectangle", () => {
    const triangle = measurement({ kind: "AREA", xs: [0, 0.2, 0], ys: [0, 0, 0.3] });
    expect(measurementPrimitive(triangle)).toEqual({ kind: "area", squareFeet: 300 });
  });

  it("gives the same area whichever way round the ring was drawn", () => {
    const clockwise = measurement({ kind: "AREA", xs: [0.1, 0.3, 0.3, 0.1], ys: [0.1, 0.1, 0.4, 0.4] });
    const widdershins = measurement({ kind: "AREA", xs: [0.1, 0.3, 0.3, 0.1].reverse(), ys: [0.1, 0.1, 0.4, 0.4].reverse() });
    expect(measurementPrimitive(clockwise)).toEqual(measurementPrimitive(widdershins));
  });

  it("REFUSES a ring that crosses itself rather than returning a plausible number", () => {
    // A bowtie. Shoelace would happily return 0 here — the lobes cancel — and
    // zero is a number somebody would act on.
    const bowtie = measurement({ kind: "AREA", xs: [0, 0.2, 0, 0.2], ys: [0, 0, 0.2, 0.2] });
    expect(ringSelfIntersects(bowtie.xs, bowtie.ys)).toBe(true);
    expect(ringArea(bowtie.xs, bowtie.ys)).toBeNull();
    expect(measurementPrimitive(bowtie)).toBeNull();
  });

  it("does not mistake a simple ring's touching edges for a crossing", () => {
    const rectangle = { xs: [0.1, 0.3, 0.3, 0.1], ys: [0.1, 0.1, 0.4, 0.4] };
    expect(ringSelfIntersects(rectangle.xs, rectangle.ys)).toBe(false);
  });
});

describe("counting", () => {
  it("counts the points and carries the item name the recipe will label", () => {
    const counted = measurement({ kind: "COUNT", xs: [0.1, 0.2, 0.3], ys: [0.1, 0.1, 0.1], label: "can light" });
    expect(measurementPrimitive(counted)).toEqual({ kind: "count", count: 3, item: "can light" });
  });

  it("refuses a count with no name, because the name IS the line label", () => {
    const unnamed = measurement({ kind: "COUNT", xs: [0.1], ys: [0.1], label: "  " });
    expect(measurementPrimitive(unnamed)).toBeNull();
  });

  it("needs no calibration at all — a count is not a length", () => {
    const uncalibratable = measurement({
      kind: "COUNT",
      xs: [0.1, 0.2],
      ys: [0.1, 0.1],
      label: "diffuser",
      calibration: { ...ROUND, declaredDistanceFeet: 0 },
    });
    expect(measurementPrimitive(uncalibratable)).toEqual({ kind: "count", count: 2, item: "diffuser" });
  });
});

describe("what a shape has to be before it is measured", () => {
  it("refuses mismatched coordinate arrays", () => {
    expect(verticesProblem("LINEAR", [0, 1], [0])).toMatch(/don't line up/);
  });

  it("refuses a point outside the sheet", () => {
    expect(verticesProblem("LINEAR", [0, 1.2], [0, 0])).toMatch(/off the side/);
  });

  it("refuses more points than a traced shape could have", () => {
    const many = Array.from({ length: MAX_VERTICES + 1 }, () => 0.5);
    expect(verticesProblem("LINEAR", many, many)).toMatch(/more than/);
  });

  it("needs three points for an area and two for a line", () => {
    expect(verticesProblem("AREA", [0, 1], [0, 1])).toMatch(/at least 3/);
    expect(verticesProblem("LINEAR", [0], [0])).toMatch(/at least 2/);
    expect(verticesProblem("COUNT", [0], [0])).toBeNull();
  });
});

describe("the wall bridge", () => {
  const run = (xs: number[], ys: number[]) => measurement({ kind: "LINEAR", xs, ys });
  const wall = { heightFt: 9, sides: 2 as const, openings: [] };

  it("SUMS the traced runs into one wall rather than one wall per run", () => {
    // 40 + 50 + 38 = 128 ft. `wall` reaches for the FIRST structured input
    // with .find(), so three separate walls would price only the first.
    const three = recipeInputsFromMeasurements(
      "wall",
      [run([0, 0.4], [0, 0]), run([0, 0.5], [0.1, 0.1]), run([0, 0.38], [0.2, 0.2])],
      wall,
    );
    // The same 128 ft as one run, turned a corner to stay on the sheet:
    // 1.0 across then 0.28 down. A straight 1.28 would be off the page, which
    // the bounds check correctly refuses.
    const one = recipeInputsFromMeasurements("wall", [run([0, 1, 1], [0, 0, 0.28])], wall);
    expect(three.ok).toBe(true);
    expect(one.ok).toBe(true);
    expect(three).toEqual(one);

    const args = { wastePercent: 10, spacingFt: 16 / 12 };
    if (!three.ok || !one.ok) throw new Error("both should have produced inputs");
    expect(recipeLines("wall", three.inputs, args)).toEqual(recipeLines("wall", one.inputs, args));
  });

  it("produces exactly one wall input", () => {
    const result = recipeInputsFromMeasurements("wall", [run([0, 0.4], [0, 0]), run([0, 0.5], [0.1, 0.1])], wall);
    expect(result.ok).toBe(true);
    const inputs = (result as { inputs: { kind: string }[] }).inputs;
    expect(inputs).toHaveLength(1);
    expect(inputs[0].kind).toBe("wall");
  });

  it("carries the height and sides that were typed, since the drawing has neither", () => {
    const result = recipeInputsFromMeasurements("wall", [run([0, 0.4], [0, 0])], {
      heightFt: 12,
      sides: 1,
      openings: [{ widthFt: 3, heightFt: 7 }],
    });
    expect(result).toEqual({
      ok: true,
      inputs: [{ kind: "wall", wall: { lengthFt: 40, heightFt: 12, sides: 1, openings: [{ widthFt: 3, heightFt: 7 }] } }],
    });
  });

  it("refuses a wall with no height rather than assuming one", () => {
    const result = recipeInputsFromMeasurements("wall", [run([0, 0.4], [0, 0])], null);
    expect(result).toEqual({ ok: false, error: "A wall needs a height — the drawing doesn't carry one." });
  });

  it("refuses a wall built from areas, which have no run", () => {
    const area = measurement({ kind: "AREA", xs: [0.1, 0.3, 0.3], ys: [0.1, 0.1, 0.4] });
    const result = recipeInputsFromMeasurements("wall", [area], wall);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/traced runs/);
  });
});

describe("passing measurements to the other recipes", () => {
  it("hands paint every area, since paint sums them", () => {
    const one = measurement({ kind: "AREA", xs: [0.1, 0.3, 0.3, 0.1], ys: [0.1, 0.1, 0.4, 0.4] });
    const two = measurement({ kind: "AREA", xs: [0.4, 0.5, 0.5, 0.4], ys: [0.1, 0.1, 0.2, 0.2] });
    const result = recipeInputsFromMeasurements("paint", [one, two], null);
    expect(result).toEqual({
      ok: true,
      inputs: [
        { kind: "area", squareFeet: 600 },
        { kind: "area", squareFeet: 100 },
      ],
    });
  });

  it("names the measurement in the refusal, so a bad one can be found", () => {
    const bowtie = measurement({ kind: "AREA", xs: [0, 0.2, 0, 0.2], ys: [0, 0, 0.2, 0.2], label: "Level 2 ceiling" });
    const result = recipeInputsFromMeasurements("paint", [bowtie], null);
    expect(result).toEqual({ ok: false, error: '"Level 2 ceiling" crosses itself, so it has no area. Redraw it without the crossing.' });
  });

  it("refuses an empty selection", () => {
    expect(recipeInputsFromMeasurements("paint", [], null)).toEqual({ ok: false, error: "Pick at least one measurement." });
  });
});

describe("what the calibration dialog says before it saves", () => {
  it("refuses a line too short to set a scale from", () => {
    const stubby: StoredCalibration = { ...ROUND, x2: ROUND.x1 + 0.01 };
    const refusal = calibrationRefusal(calibrationNotices(stubby, SHEET_42_IN_PT, 1200));
    expect(refusal).toMatch(/too short/);
  });

  it("refuses a missing distance before it divides by it", () => {
    const refusal = calibrationRefusal(calibrationNotices({ ...ROUND, declaredDistanceFeet: 0 }, SHEET_42_IN_PT, 1200));
    expect(refusal).toMatch(/what that dimension says/);
  });

  it("names the scale and the sheet width when both are readable", () => {
    const notices = calibrationNotices(QUARTER_INCH, SHEET_42_IN_PT, 1200);
    expect(calibrationRefusal(notices)).toBeNull();
    expect(notices.map((n) => n.message).join(" ")).toContain('1/4" = 1\'-0"');
    expect(notices.map((n) => n.message).join(" ")).toContain("168 ft across");
  });

  it("says so when the scale matches nothing standard", () => {
    const odd: StoredCalibration = { ...QUARTER_INCH, declaredDistanceFeet: 153.3 };
    const notices = calibrationNotices(odd, SHEET_42_IN_PT, 1200);
    expect(notices.some((n) => n.message.includes("isn't a standard scale"))).toBe(true);
  });

  it("flags a sheet that reads too wide to be a building", () => {
    const huge: StoredCalibration = { ...QUARTER_INCH, declaredDistanceFeet: 9000 };
    const notices = calibrationNotices(huge, SHEET_42_IN_PT, 1200);
    expect(notices.some((n) => n.message.includes("outside the range"))).toBe(true);
  });

  it("puts a number on the error band when the line is short but allowed", () => {
    const shortish: StoredCalibration = { ...ROUND, x2: ROUND.x1 + 0.08 };
    const notices = calibrationNotices(shortish, SHEET_42_IN_PT, 1200);
    expect(notices.some((n) => n.message.includes("ft over a 100 ft run"))).toBe(true);
  });
});

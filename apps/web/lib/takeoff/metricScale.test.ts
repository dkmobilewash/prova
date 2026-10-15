import { describe, expect, it } from "vitest";
import { metricDimensionLabels } from "../plan-ingest/dimensionLabels";
import {
  ARCHITECTURAL_SCALES,
  METRIC_SCALES,
  SCALE_TOLERANCE,
  readSheetScale,
  scaleFromDimensions,
} from "./scaleFromDimensions";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── A METRIC SHEET DIMENSIONS IN BARE MILLIMETRES ──
 *
 * `7150`, `12300`. No unit, no punctuation. Two sheets drawn outside this repo
 * (`fixtures` S16 at `1:100`, S17 at `1:50`) print their scale, are covered in
 * dimensions, and declined with "No printed dimensions were found on this
 * sheet" — because the imperial pattern requires feet.
 *
 * The risk is the mirror image of the gap: a bare four-digit number is also a
 * year, a job number or a room area. The safety is NOT this pattern — it is
 * that the metric pass runs only after the imperial one declines, that the
 * figure must still sit beside a line of the right length, and that three
 * distinct figures must agree.
 */

const PAGE_PT = 1224;

/** A page carrying the given words at the given positions. */
const pageOf = (items: { str: string; x: number; y: number; width?: number }[]) => ({
  pageNumber: 1,
  widthPt: PAGE_PT,
  heightPt: 792,
  rotation: 0,
  items: items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width ?? 30, height: 8 })),
});

/** A horizontal dimension line of `pt` points at `y`. */
const lineOf = (x: number, y: number, pt: number): StrokeSegment => ({ x1: x, y1: y, x2: x + pt, y2: y });

describe("the metric scale table", () => {
  it("is feet per inch, which is what everything downstream speaks", () => {
    // A 1:100 drawing puts 100 inches of building in an inch of paper, which is
    // 100/12 feet. Spelled out because an off-by-twelve here is invisible: it
    // produces a plausible number that is wrong on every quantity.
    expect(METRIC_SCALES.find((s) => s.name === "1:100")?.feetPerInch).toBeCloseTo(8.333, 3);
    expect(METRIC_SCALES.find((s) => s.name === "1:50")?.feetPerInch).toBeCloseTo(4.167, 3);
  });

  it("NEVER COLLIDES with an imperial scale at the tolerance in force", () => {
    // The load-bearing property, and the reason both tables can exist. The
    // nearest pairs are 1:50 vs 1/4" (4.167 vs 4.000) and 1:100 vs 1/8" (8.333
    // vs 8.000), both 4.2% apart against a 2% tolerance. If somebody widens
    // SCALE_TOLERANCE past ~4% this test is what tells them the two tables have
    // started overlapping, rather than a sheet quietly reading the wrong one.
    for (const metric of METRIC_SCALES) {
      for (const imperial of ARCHITECTURAL_SCALES) {
        const apart = Math.abs(metric.feetPerInch - imperial.feetPerInch) / imperial.feetPerInch;
        expect(
          apart,
          `${metric.name} and ${imperial.name} are ${(apart * 100).toFixed(1)}% apart — inside the ${(SCALE_TOLERANCE * 100).toFixed(0)}% tolerance, so a reading could land on both`,
        ).toBeGreaterThan(SCALE_TOLERANCE);
      }
    }
  });
});

describe("reading bare millimetres", () => {
  it("finds them and converts to feet", () => {
    const labels = metricDimensionLabels(pageOf([{ str: "7150", x: 100, y: 100 }]));
    expect(labels).toHaveLength(1);
    // 7150mm is 23.46 ft. Wrong by 12 or by 3.28 and every quantity moves.
    expect(labels[0].feet).toBeCloseTo(23.46, 2);
  });

  it("ignores what is too small to be a building dimension", () => {
    // A room number, an area, a door width — none of them worth a scale, and
    // all of them common on the same sheet.
    const labels = metricDimensionLabels(
      pageOf([
        { str: "101", x: 100, y: 100 },
        { str: "361", x: 200, y: 100 },
        { str: "900", x: 300, y: 100 },
      ]),
    );
    expect(labels).toEqual([]);
  });

  it("ignores what is too large to be a building", () => {
    expect(metricDimensionLabels(pageOf([{ str: "1234567", x: 100, y: 100 }]))).toEqual([]);
  });

  it("ignores anything that is not a bare integer", () => {
    const labels = metricDimensionLabels(
      pageOf([
        { str: "7150mm", x: 100, y: 100 },
        { str: "71.50", x: 200, y: 100 },
        { str: "A-101", x: 300, y: 100 },
        { str: "12'-6\"", x: 400, y: 100 },
      ]),
    );
    expect(labels).toEqual([]);
  });

  it("ignores the title block, where a job number lives", () => {
    // Bottom-right corner. A six-digit job number there is the likeliest false
    // positive this reader has.
    const labels = metricDimensionLabels(pageOf([{ str: "20260", x: PAGE_PT * 0.9, y: 792 * 0.9 }]));
    expect(labels).toEqual([]);
  });
});

describe("the two passes", () => {
  // Three dimensions at 1:100: 7150mm is 71.5mm of paper, which is 202.7pt.
  const mmToPt = (mm: number, ratio: number) => (mm / ratio / 25.4) * 72;
  const metricSheet = () => {
    const dims = [7150, 5150, 12300];
    // THE LABEL SITS ON THE LINE'S MIDDLE, which is how an architect letters a
    // dimension and what `scaleCandidates` requires — within 30% of the
    // midpoint and 30pt of the line. A first version of this fixture put every
    // label at the left end and the pairer refused all three, which is the
    // pairer being right about a drawing nobody would draw.
    const items = dims.map((mm, i) => ({
      str: String(mm),
      x: 100 + mmToPt(mm, 100) / 2 - 15,
      y: 200 + i * 50,
    }));
    const segments = dims.map((mm, i) => lineOf(100, 200 + i * 50, mmToPt(mm, 100)));
    return { page: pageOf(items), segments };
  };

  it("reads a metric sheet the imperial pass cannot", () => {
    const { page, segments } = metricSheet();
    const verdict = readSheetScale(page, segments, [], {}, metricDimensionLabels(page));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.scaleName).toBe("1:100");
  });

  it("DOES NOTHING when no metric labels are supplied — every old caller's behaviour", () => {
    const { page, segments } = metricSheet();
    const verdict = readSheetScale(page, segments, []);
    expect(verdict.ok).toBe(false);
  });

  it("KEEPS THE IMPERIAL READING when the imperial pass succeeds", () => {
    // The ordering IS the safety. A sheet that already reads a scale must never
    // reach the metric pass, or a stray four-digit figure gets a vote on a
    // drawing that was already explained.
    const dims = [20, 30, 40]; // feet
    const items = dims.map((ft, i) => ({ str: `${ft}'-0"`, x: 100, y: 200 + i * 50 }));
    const page = pageOf([
      ...items.map((it, i) => ({ ...it, x: 100 + dims[i] * 9 - 15 })),
      { str: "7150", x: 600, y: 400 },
    ]);
    // 1/4" = 1'-0": a foot is 18pt of paper.
    const segments = dims.map((ft, i) => lineOf(100, 200 + i * 50, ft * 18));
    const imperialLabels = dims.map((ft, i) => ({
      text: `${ft}'-0"`,
      feet: ft,
      x: 100 + ft * 9,
      y: 200 + i * 50,
    }));
    const verdict = readSheetScale(page, segments, imperialLabels, {}, metricDimensionLabels(page));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.scaleName).toBe('1/4" = 1\'-0"');
  });

  it("PREFERS IMPERIAL even when the metric pass would also succeed", () => {
    // ── THE ORDERING, TESTED WHERE IT CAN ACTUALLY FAIL ──
    //
    // The earlier case puts one stray figure on an imperial sheet, and a
    // mutation removing `imperial.ok ||` survived it: with only one metric
    // label the metric pass declines, so `metric.ok ? metric : imperial` hands
    // back the imperial answer anyway and the bug is invisible.
    //
    // This page is readable BOTH ways. The same three lines carry imperial
    // dimensions at 1/4" and millimetre figures that agree on 1:100, so the
    // two passes give different answers and only the ordering decides.
    const ft = [20, 30, 40];
    const ptOf = (f: number) => f * 18; // 1/4" = 1'-0"
    // The same line read as 1:100: 360pt of paper is 127mm, so 12700mm.
    const mm = ft.map((f) => Math.round((ptOf(f) / 72) * 25.4 * 100));
    const items = [
      ...ft.map((f, i) => ({ str: `${f}'-0"`, x: 100 + ptOf(f) / 2 - 15, y: 200 + i * 60 })),
      ...mm.map((m, i) => ({ str: String(m), x: 100 + ptOf(ft[i]) / 2 - 15, y: 210 + i * 60 })),
    ];
    const page = pageOf(items);
    const segments = ft.map((f, i) => lineOf(100, 200 + i * 60, ptOf(f)));
    const imperialLabels = ft.map((f, i) => ({
      text: `${f}'-0"`,
      feet: f,
      x: 100 + ptOf(f) / 2,
      y: 200 + i * 60,
    }));

    // The control: the metric pass really would answer, so this is a choice
    // between two readings rather than a choice between one and nothing.
    const metricOnly = scaleFromDimensions(metricDimensionLabels(page), segments, {
      pageWidthPt: PAGE_PT,
      scales: METRIC_SCALES,
    });
    expect(metricOnly.ok, "the metric arm declined — this page no longer tests the ordering").toBe(true);

    const verdict = readSheetScale(page, segments, imperialLabels, {}, metricDimensionLabels(page));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.scaleName).toBe('1/4" = 1\'-0"');
  });

  it("keeps the IMPERIAL decline reason when both passes fail", () => {
    // The reason an estimator reads has to describe the sheet in front of them.
    // A second failure about a metric reading they never asked for makes a
    // confusing message worse.
    const page = pageOf([{ str: "7150", x: 100, y: 200 }]);
    const verdict = readSheetScale(page, [lineOf(100, 200, 5)], [], {}, metricDimensionLabels(page));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/No printed dimensions were found/);
  });
});

describe("the second snap, which is where this broke", () => {
  it("proposes a line for a METRIC winner rather than refusing it", () => {
    // ── THE BUG THIS CASE EXISTS FOR ──
    //
    // The vote was taught the metric table and the line-proposing `snap` below
    // it was not. A sheet agreed unanimously on `1:100`, that second call found
    // no imperial scale by that name, the inherited error came out as Infinity,
    // and the sheet was refused with "the best line to set it from is
    // Infinity% out". Two call sites, one updated.
    const dims = [7150, 5150, 12300];
    const pt = (mm: number) => (mm / 100 / 25.4) * 72;
    const page = pageOf(
      dims.map((mm, i) => ({ str: String(mm), x: 100 + pt(mm) / 2 - 15, y: 200 + i * 50 })),
    );
    const segments = dims.map((mm, i) => lineOf(100, 200 + i * 50, pt(mm)));
    const verdict = scaleFromDimensions(metricDimensionLabels(page), segments, {
      pageWidthPt: PAGE_PT,
      scales: METRIC_SCALES,
    });
    expect(verdict.ok, verdict.ok ? "" : verdict.reason).toBe(true);
    if (verdict.ok) {
      expect(verdict.scaleName).toBe("1:100");
      // And it proposes a real line, which is what the second snap decides.
      expect(Math.hypot(verdict.best.x2 - verdict.best.x1, verdict.best.y2 - verdict.best.y1)).toBeGreaterThan(0);
    }
  });
});

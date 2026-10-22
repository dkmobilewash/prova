import { describe, expect, it } from "vitest";
import { findWallsOnSheet } from "./findWallsOnSheet";
import { wallsPerView } from "./sheetViews";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── A SHEET IS MEASURED BY ONE OF TWO PATHS, AND BOTH MUST REPORT ──
 *
 * The viewer calls `findWallsOnSheet` itself for a sheet with one plan view,
 * and `wallsPerView` for a sheet with several — then takes that result and
 * never calls the finder at all. Answer-key mode collected candidates only at
 * the first call, so on a multi-view sheet it collected NOTHING: Save to
 * labels refused with "no pairings were captured", on most real bid-package
 * sheets, which is most of the ones anybody wants labelled.
 *
 * Nothing in the repository could see it. Typecheck is green either way, the
 * prop exists, the panel reads it, and the census that checks a hook is wired
 * can only see that the code is THERE — the same limit `expo-router header
 * options never render` records, one framework down. The defect lived in
 * which branch ran, and the only instrument for that is a test that takes
 * both branches and requires each to speak.
 */
const opts = {
  textItems: [],
  pageSize: { widthPt: 1000, heightPt: 800 },
  feetPerUnit: 60,
  wallTypes: [],
  sampledSheets: null,
};

/** A wall pair, placed so it falls inside the named band. */
const wallAt = (y: number): StrokeSegment[] => [
  { x1: 100, y1: y, x2: 600, y2: y, width: 1.2 },
  { x1: 100, y1: y + 5, x2: 600, y2: y + 5, width: 1.2 },
];

describe("every measuring path reports its pairings", () => {
  it("the single-view path reports", () => {
    const seen: number[][] = [];
    const found = findWallsOnSheet({
      ...opts,
      segments: wallAt(200),
      onCandidate: (features) => seen.push([...features]),
    });
    expect(found.walls.length, "nothing was found, so this proves nothing").toBeGreaterThan(0);
    expect(seen.length, "the single-view path reported no pairings").toBeGreaterThan(0);
    expect(seen[0].length, "a pairing arrived with no feature vector").toBeGreaterThan(0);
  });

  it("THE PER-VIEW PATH REPORTS TOO — the one that was silent", () => {
    const seen: number[][] = [];
    const measured = wallsPerView({
      ...opts,
      segments: [...wallAt(200), ...wallAt(600)],
      views: [
        {
          name: "FLOOR PLAN",
          feetPerInch: 48,
          from: 0,
          to: 1000,
          fromY: 0,
          toY: 400,
        },
        {
          name: "ENLARGED PLAN",
          feetPerInch: 48,
          from: 0,
          to: 1000,
          fromY: 400,
          toY: 800,
        },
      ] as never,
      onCandidate: (features) => seen.push([...features]),
    });
    expect(measured.length, "no view was measured, so this proves nothing").toBeGreaterThan(0);
    expect(
      measured.some((m) => m.walls.length > 0),
      "no view found a wall, so a silent reporter would look the same",
    ).toBe(true);
    expect(seen.length, "the per-view path reported no pairings").toBeGreaterThan(0);
    expect(seen[0].length, "a pairing arrived with no feature vector").toBeGreaterThan(0);
  });

  it("neither path invents a report when nobody is listening", () => {
    // The collector is undefined in ordinary use, and the cost of collecting
    // on every sheet is paid only in answer-key mode.
    expect(() => findWallsOnSheet({ ...opts, segments: wallAt(200) })).not.toThrow();
    expect(() =>
      wallsPerView({
        ...opts,
        segments: wallAt(200),
        views: [
          { name: "FLOOR PLAN", feetPerInch: 48, from: 0, to: 1000, fromY: 0, toY: 800 },
        ] as never,
      }),
    ).not.toThrow();
  });
});

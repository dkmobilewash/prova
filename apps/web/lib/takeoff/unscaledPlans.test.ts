import { describe, expect, it } from "vitest";
import { wallsPerView } from "./sheetViews";
import type { SheetView } from "./sheetViews";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── A SHEET WHOSE PLANS PRINT NO SCALE IS NOT A SHEET WITH NO PLANS ──
 *
 * Murray A101 (page 24) offered "Nothing to review on this sheet" while the
 * finder read it perfectly well: driven at the calibrated scale it produces
 * 731 pairings and 158 runs.
 *
 * `wallsPerView` dropped every band because neither view's caption carried a
 * readable scale — "1st Floor Plan" and "1st Floor Reflected Ceiling Plan",
 * no scale printed under either. With no bands there was nothing for
 * `primaryView` to pick, and the viewer took its deliberate empty result.
 *
 * The user had already answered the question the filter was asking: they
 * calibrated the sheet, 23 ft across a known span, and `feetPerUnit` carried
 * that answer in and was ignored.
 *
 * The fallback applies ONLY when not one view prints a scale. That is the
 * line the tests below defend from both sides.
 */
const W = 1000;
const pageSize = { widthPt: W, heightPt: W };

const view = (name: string, feetPerInch: number | null, fromY: number, toY: number): SheetView =>
  ({
    name,
    scaleName: feetPerInch === null ? null : `1/8" = 1'-0"`,
    feetPerInch,
    captionX: 0.5,
    captionY: toY,
    from: 0,
    to: 1,
    fromY,
    toY,
    boxes: null,
  }) as unknown as SheetView;

/** A little rectangle of wall-ish lines inside a band. */
function walls(fromY: number, count: number): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = (fromY + 0.02 + i * 0.01) * W;
    out.push({ x1: 0.2 * W, y1: y, x2: 0.8 * W, y2: y });
    // The second face, a wall thickness below.
    out.push({ x1: 0.2 * W, y1: y + 2, x2: 0.8 * W, y2: y + 2 });
  }
  return out;
}

const run = (views: SheetView[], segments: StrokeSegment[]) =>
  wallsPerView({
    segments,
    textItems: [],
    pageSize,
    views,
    wallTypes: [],
    feetPerUnit: 288,
    sampledSheets: null,
  });

describe("plan views with no printed scale", () => {
  it("MEASURES THEM AT THE CALIBRATED SCALE when no view prints one", () => {
    // Murray's shape: two plans, neither captioned with a scale.
    const got = run(
      [
        view("1st Floor Plan", null, 0.1, 0.45),
        view("1st Floor Reflected Ceiling Plan", null, 0.5, 0.85),
      ],
      [...walls(0.1, 6), ...walls(0.5, 3)],
    );
    expect(got.length, "every band was dropped — the sheet offers nothing").toBeGreaterThan(0);
    expect(got.some((v) => v.lengthFeet > 0), "measured, but found nothing").toBe(true);
  });

  it("still measures nothing when the only views are NOT plans", () => {
    // The guard this must not relax. Eight interior elevations once reached
    // the quantities, because an elevation of a wall is two parallel lines a
    // wall-thickness apart by every geometric test here. Only the caption
    // separates them, so the caption still decides.
    const got = run(
      [
        view("Interior Elevations", null, 0.1, 0.45),
        view("Door Schedule", null, 0.5, 0.85),
      ],
      [...walls(0.1, 6), ...walls(0.5, 3)],
    );
    expect(got, "an elevation was measured as wall").toEqual([]);
  });

  it("PREFERS the views that print a scale, and drops the ones that do not", () => {
    // ── THE MULTI-SCALE PROTECTION, UNTOUCHED ──
    //
    // When one view prints a scale, the sheet is drawn at more than one and
    // the calibration belongs to whichever view it came from. Measuring the
    // unscaled one at it would be inventing a scale for it — so the fallback
    // must NOT fire here.
    const got = run(
      [
        view("Enlarged Plan", 4, 0.1, 0.45),
        view("1st Floor Plan", null, 0.5, 0.85),
      ],
      [...walls(0.1, 6), ...walls(0.5, 3)],
    );
    expect(got).toHaveLength(1);
    expect(got[0].view.name).toBe("Enlarged Plan");
  });

  it("measures nothing when there is no geometry, scale or not", () => {
    expect(run([view("1st Floor Plan", null, 0.1, 0.45)], [])).toEqual([]);
  });

  it("keeps each unscaled view's own geometry rather than pooling it", () => {
    // Two plans, neither scaled: both are measured, and the one with more
    // wall in it must come out with more footage. If the bands were pooled
    // the two would be identical.
    const got = run(
      [
        view("1st Floor Plan", null, 0.1, 0.45),
        view("2nd Floor Plan", null, 0.5, 0.85),
      ],
      [...walls(0.1, 8), ...walls(0.5, 2)],
    );
    expect(got).toHaveLength(2);
    const first = got.find((v) => v.view.name === "1st Floor Plan");
    const second = got.find((v) => v.view.name === "2nd Floor Plan");
    expect(first?.lengthFeet ?? 0).toBeGreaterThan(second?.lengthFeet ?? 0);
  });
});

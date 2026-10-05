import { describe, expect, it } from "vitest";
import {
  measurementScaleLabel,
  SAME_SCALE_TOLERANCE,
  scaleLabel,
  zoneNotices,
  zoneScales,
  type IdentifiedCalibration,
} from "./takeoff-zones";

/**
 * The silence cases carry as much weight as the sentence here, because the
 * ordinary page has one scale and anything this module says on it is noise.
 */

/** An ARCH D sheet: 36 inches at 72pt per inch. */
const SHEET = 36 * 72;

/**
 * A calibration line spanning `span` of the page width, declared as `feet`.
 *
 * `feetPerPageWidth` is `feet / span`, and `readScale` divides that by the
 * paper inches — so 36 paper inches and a full-width line declared at 288 ft
 * reads 8 ft per inch, which is 1/8" = 1'-0".
 */
function calibration(id: string, span: number, feet: number): IdentifiedCalibration {
  return { id, x1: 0.1, y1: 0.5, x2: 0.1 + span, y2: 0.5, declaredDistanceFeet: feet };
}

/** 1/8" = 1'-0" — 8 ft of building per paper inch. */
const eighth = (id: string) => calibration(id, 0.5, 144);
/** 1-1/2" = 1'-0" — 0.667 ft per paper inch, the head-of-wall detail scale. */
const inchAndAHalf = (id: string) => calibration(id, 0.5, 12);

describe("a page with one scale says nothing", () => {
  it("is silent on a single calibration", () => {
    const zones = zoneScales([eighth("c1")], SHEET);
    expect(zoneNotices(zones)).toEqual([]);
  });

  it("is silent on NO calibrations", () => {
    expect(zoneNotices(zoneScales([], SHEET))).toEqual([]);
  });

  it("is silent on two calibrations of the SAME scale, which is a re-calibration", () => {
    // The estimator set the scale, did not like the line, and set it again.
    // Two rows, one scale. Reporting a multi-scale sheet here is the
    // cry-wolf failure this tolerance exists to prevent.
    const zones = zoneScales([eighth("c1"), eighth("c2")], SHEET);
    expect(zoneNotices(zones)).toEqual([]);
  });

  it("is silent on two hand-drawn lines a few per cent apart", () => {
    // Nobody clicks the same two pixels twice. 4% apart is the same scale.
    const zones = zoneScales([calibration("c1", 0.5, 144), calibration("c2", 0.5, 150)], SHEET);
    expect(zoneNotices(zones)).toEqual([]);
  });

  it("is silent when the page width is unknown, because nothing can be compared", () => {
    // `readScale` returns null for every calibration without a page width, so
    // this is the whole-page case and not a partial one.
    const zones = zoneScales([eighth("c1"), inchAndAHalf("c2")], null);
    expect(zoneNotices(zones)).toEqual([]);
  });
});

describe("a page with two real scales says so, once", () => {
  it("names both scales and does not refuse", () => {
    const zones = zoneScales([eighth("c1"), inchAndAHalf("c2")], SHEET);
    const notices = zoneNotices(zones);
    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe("warn");
    expect(notices[0].message).toContain("2 different scales");
    expect(notices[0].message).toContain('1/8" = 1\'-0"');
    expect(notices[0].message).toContain('1-1/2" = 1\'-0"');
  });

  it("SAYS THE SHEET IS NORMAL, which is the difference between a warning and an accusation", () => {
    const notices = zoneNotices(zoneScales([eighth("c1"), inchAndAHalf("c2")], SHEET));
    expect(notices[0].message).toContain("normal where a detail sits beside a plan");
    // And it asks for the one thing a person can actually act on.
    expect(notices[0].message).toContain("traced against the right zone");
  });

  it("reports ONE notice for three calibrations at two scales, not three pairings", () => {
    // Two at 1/8" and one at 1-1/2" is two distinct scales. Pairwise
    // comparison would report three disagreements, which is arithmetic
    // rather than information.
    const zones = zoneScales([eighth("c1"), eighth("c2"), inchAndAHalf("c3")], SHEET);
    const notices = zoneNotices(zones);
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain("2 different scales");
  });

  it("counts three distinct scales as three", () => {
    const quarter = calibration("c3", 0.5, 72); // 1/4" = 1'-0"
    const zones = zoneScales([eighth("c1"), inchAndAHalf("c2"), quarter], SHEET);
    expect(zoneNotices(zones)[0].message).toContain("3 different scales");
  });

  it("never returns a refusal, at any number of scales", () => {
    // `calibrationRefusal` reads `level === "refuse"`. Nothing here may ever
    // produce one: a detail at its own scale must not block a save.
    const zones = zoneScales([eighth("c1"), inchAndAHalf("c2"), calibration("c3", 0.5, 72)], SHEET);
    for (const notice of zoneNotices(zones)) expect(notice.level).toBe("warn");
  });
});

describe("the tolerance is the thing that decides, so it is pinned", () => {
  it("treats a pair just inside the tolerance as one scale and just outside as two", () => {
    const base = 144;
    const inside = base * (1 + SAME_SCALE_TOLERANCE * 0.8);
    const outside = base * (1 + SAME_SCALE_TOLERANCE * 2);
    expect(zoneNotices(zoneScales([calibration("a", 0.5, base), calibration("b", 0.5, inside)], SHEET))).toEqual(
      [],
    );
    expect(
      zoneNotices(zoneScales([calibration("a", 0.5, base), calibration("b", 0.5, outside)], SHEET)),
    ).toHaveLength(1);
  });

  it("is wider than click jitter and far narrower than adjacent standard scales", () => {
    // 1/8" against 3/16" is a 33% gap. A tolerance at or above that would
    // merge two real scales into one and say nothing.
    expect(SAME_SCALE_TOLERANCE).toBeLessThan(0.33);
    expect(SAME_SCALE_TOLERANCE).toBeGreaterThan(0.02);
  });
});

describe("a measurement is labelled only where the label means something", () => {
  it("labels nothing on a single-scale page", () => {
    const zones = zoneScales([eighth("c1")], SHEET);
    const notices = zoneNotices(zones);
    // The scale is a property of the sheet here; repeating it on every row is
    // noise, which is why this takes the notices rather than deciding itself.
    expect(measurementScaleLabel("c1", zones, notices)).toBeNull();
  });

  it("labels each measurement with its OWN scale on a multi-scale page", () => {
    const zones = zoneScales([eighth("c1"), inchAndAHalf("c2")], SHEET);
    const notices = zoneNotices(zones);
    expect(measurementScaleLabel("c1", zones, notices)).toBe('1/8" = 1\'-0"');
    expect(measurementScaleLabel("c2", zones, notices)).toBe('1-1/2" = 1\'-0"');
  });

  it("returns null for a calibration the page does not have", () => {
    const zones = zoneScales([eighth("c1"), inchAndAHalf("c2")], SHEET);
    expect(measurementScaleLabel("gone", zones, zoneNotices(zones))).toBeNull();
  });
});

describe("a non-standard scale is named by its reading rather than left blank", () => {
  it("reads out feet per inch when no standard scale matches", () => {
    // 1 in = 3.6 ft matches nothing standard, and the estimator still needs to
    // see what the zone was calibrated to.
    const odd = calibration("c2", 0.5, 64.8);
    const zones = zoneScales([eighth("c1"), odd], SHEET);
    expect(zoneNotices(zones)[0].message).toContain("1 in = 3.6 ft");
  });

  it("calls a null reading an unknown scale rather than printing null", () => {
    expect(scaleLabel(null)).toBe("an unknown scale");
  });
});

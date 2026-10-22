import { describe, expect, it } from "vitest";
import { primaryView, type ViewWalls } from "./sheetViews";
import { takeoffRank } from "./sheetSuitability";
import { viewKind } from "./viewKind";

/**
 * ── ON A SHEET OF FOUR VIEWS OF ONE FLOOR, WHICH ONE IS MEASURED ──
 *
 * HPL p3 carries FINISH PLAN, DECORATIVE LIGHTING PLAN and PARTITION PLAN of
 * the same tier, and the finder measured the lighting plan. Two causes, and
 * each needs its own test because fixing either one alone still leaves the
 * sheet wrong:
 *
 *   - `takeoffRank` had no entry for LIGHTING, so the caption scored 40 as "a
 *     plan of some kind" and the view was measured at all;
 *   - `primaryView` then chose on FOOTAGE, and a decorative lighting layout
 *     over one floor has more line work in it than the partitions underneath.
 *
 * The captions here are the real ones, read off the sheets by
 * `zzViewPick.eval.ts`, not invented — a fixture caption nobody writes would
 * test a vocabulary nobody uses.
 */

/** A measured view, with only the fields `primaryView` reads. */
function view(name: string, lengthFeet: number): ViewWalls {
  return {
    view: {
      name,
      scaleName: '1/4" = 1\'-0"',
      feetPerInch: 48,
      captionX: 0.5,
      captionY: 0.9,
      from: 0,
      to: 1,
      fromY: 0,
      toY: 1,
      boxes: undefined,
    },
    lengthFeet,
    // `primaryView` reads only the caption and the footage. These two are the
    // rest of the type and are deliberately empty: a fixture that carried
    // geometry would suggest the choice depends on it.
    found: null as unknown as ViewWalls["found"],
    walls: [],
  };
}

describe("the caption decides which view is measured", () => {
  it("a lighting plan is not a plan to price", () => {
    // The first cause. Without this the view is measured at all, and on HPL p3
    // it had the most footage on the sheet.
    expect(viewKind("DECORATIVE LIGHTING PLAN TIER 1").kind).toBe("not-a-plan");
    expect(takeoffRank(null, "DECORATIVE LIGHTING PLAN TIER 1").score).toBeLessThan(0);
  });

  /**
   * ── THE DEMOTION'S WEIGHT IS NOT LOAD-BEARING, AND A MUTANT PROVED IT ──
   *
   * Weakening LIGHTING from -200 to -20 leaves every test here green, and that
   * is correct rather than a hole. `takeoffRank` returns a demotion's weight
   * OUTRIGHT instead of summing it with the promotion — measured, not assumed:
   * "DECORATIVE LIGHTING PLAN TIER 1" scores -200, not 40-200. So any negative
   * weight makes the caption not-a-plan, and `primaryView` never compares one,
   * because only plans are measured and every plan scores positive.
   *
   * No test is added to pin -200. It would assert a number this fix does not
   * depend on, and the repo's rule for a surviving mutant is to find what else
   * was doing the work rather than to strengthen the code around it. What does
   * the work here is the demotion-beats-promotion rule, which has its own
   * tests in `sheetSuitability`.
   */
  it("a power plan is not either, even on an architectural sheet", () => {
    // `ELECTRICAL` already caught a sheet TITLED electrical. A view captioned
    // POWER PLAN on an A-series sheet says nothing about electricity, so the
    // sheet-level rule never saw it.
    expect(viewKind("POWER PLAN - LEVEL 2").kind).toBe("not-a-plan");
  });

  it("the ones an estimator prices are still plans", () => {
    // The other direction, which is the half a demotion list gets wrong: these
    // four captions are all real and all must stay measurable.
    for (const caption of [
      "PARTITION PLAN - TIER 1 WHITE",
      "FLOOR PLAN",
      "ENLARGED FLOOR PLAN",
      "DIMENSIONED FLOOR PLAN",
    ]) {
      expect(viewKind(caption).kind, caption).toBe("plan");
    }
  });
});

describe("primaryView prefers what the drawing IS over how much is on it", () => {
  it("picks the partition plan over a bare PLAN that has MORE footage", () => {
    // HPL p4, the exact numbers from the sheet. This is the case that proves
    // the ordering rather than the vocabulary: both captions are plans, so no
    // demotion can settle it, and the wrong one has 19.5 more feet on it.
    const { primary, others } = primaryView([
      view("PLAN- TIER 1 TWO TONED", 442.1),
      view("PARTITION PLAN - TIER 1 TWO TONED", 422.6),
    ]);
    expect(primary?.view.name).toBe("PARTITION PLAN - TIER 1 TWO TONED");
    expect(others.map((o) => o.view.name)).toEqual(["PLAN- TIER 1 TWO TONED"]);
  });

  it("a dimensioned floor plan outranks a plain one", () => {
    const { primary } = primaryView([
      view("FLOOR PLAN", 900),
      view("DIMENSIONED FLOOR PLAN", 100),
    ]);
    expect(primary?.view.name).toBe("DIMENSIONED FLOOR PLAN");
  });

  it("footage still decides between two views of the same kind", () => {
    // The tie-break has to survive, or an enlarged scrap of a floor plan beats
    // the floor plan whenever it is listed first. FLOOR PLAN and PARTITION
    // PLAN both score 90 deliberately — an office calling its wall drawing
    // either name means the same thing.
    const { primary } = primaryView([
      view("PARTITION PLAN - AREA A", 120),
      view("FLOOR PLAN", 400),
    ]);
    expect(primary?.view.name).toBe("FLOOR PLAN");
  });

  it("is stable when every view scores the same and measures the same", () => {
    // Not a behaviour anyone needs, but an unstable sort here would make the
    // measured footage of a sheet change between runs, which is the kind of
    // flake that gets blamed on the geometry.
    const names = ["FLOOR PLAN A", "FLOOR PLAN B", "FLOOR PLAN C"];
    const first = primaryView(names.map((n) => view(n, 200))).primary?.view.name;
    for (let i = 0; i < 5; i += 1) {
      expect(primaryView(names.map((n) => view(n, 200))).primary?.view.name).toBe(first);
    }
  });

  it("picks nothing from nothing", () => {
    expect(primaryView([]).primary).toBeNull();
  });
});

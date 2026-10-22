import { describe, expect, it } from "vitest";
import { rankSheetsForTakeoff, takeoffRank } from "./sheetSuitability";

/**
 * ── RANKING SHEETS BY WHAT THEY SAY THEY ARE ──
 *
 * The real-plan report ranked by STROKE COUNT and it picked four LIFE SAFETY
 * plans over every architectural floor plan in the set. That is not bad luck:
 * a life-safety plan carries the egress paths, the occupancy tags and the
 * rated-wall hatching ON TOP of the same walls, so it is denser than the plan
 * it is drawn over. Ranking by how much is drawn prefers exactly the sheets
 * that repeat the plan.
 *
 * These tests are written on TITLES rather than on that set's sheet numbers,
 * because a rule that knows "A4.B.2" is a rule that works once.
 */

describe("the sheets an estimator would price come first", () => {
  it("puts a floor plan above a life-safety plan of the same building", () => {
    const floor = takeoffRank("A4.B.2", "1 HR FLOOR PLAN LEVEL 2");
    const safety = takeoffRank("A1.2-3", "LIFE SAFETY & OCCUPANCY PLAN LEVEL 3");
    expect(floor.score).toBeGreaterThan(safety.score);
    expect(safety.score).toBeLessThan(0);
  });

  it("A DEMOTION BEATS A PROMOTION, because all of them say PLAN", () => {
    // The whole difficulty in one assertion. Every sheet that should sink also
    // contains the word PLAN, so taking the best match would let each of them
    // argue its way up on a word it shares with the drawing it covers.
    for (const title of [
      "LIFE SAFETY PLAN",
      "UNIT NUMBERING PLAN",
      "REFLECTED CEILING PLAN",
      "FURNITURE PLAN",
      "ROOF PLAN",
      "SITE PLAN",
      "KEY PLAN",
      "EGRESS PLAN",
      "FINISH PLAN",
      "EQUIPMENT PLAN",
    ]) {
      expect(takeoffRank("A101", title).score, `${title} ranked as worth pricing`).toBeLessThan(0);
    }
  });

  it("keeps the plans an estimator prices above zero", () => {
    for (const title of [
      "FLOOR PLAN",
      "DIMENSIONAL FLOOR PLAN",
      "OVERALL FLOOR PLAN",
      "PARTITION PLAN",
      "ENLARGED RESTROOM PLAN",
      "FIRST FLOOR PLAN",
    ]) {
      expect(takeoffRank("A101", title).score, `${title} was not ranked as worth pricing`).toBeGreaterThan(0);
    }
  });

  it("prefers a DIMENSIONED floor plan, because that is the one with the numbers on", () => {
    expect(takeoffRank("A102", "DIMENSIONAL FLOOR PLAN").score).toBeGreaterThan(
      takeoffRank("A101", "FLOOR PLAN").score,
    );
  });

  it("uses the discipline letter only to BREAK TIES, never to decide", () => {
    // An office that numbers its ceiling plans in the A series is common; one
    // that writes FLOOR PLAN on an elevation is not. So the title has to win.
    expect(takeoffRank("A101", "REFLECTED CEILING PLAN").score).toBeLessThan(
      takeoffRank("M101", "FLOOR PLAN").score,
    );
    // And with equal titles, architectural wins.
    expect(takeoffRank("A101", "FLOOR PLAN").score).toBeGreaterThan(
      takeoffRank("X101", "FLOOR PLAN").score,
    );
  });

  it("sinks a sheet that repeats the architectural plan under its own work", () => {
    // `sheetSuitability` already knows this and the ranking folds it in rather
    // than restating it: a mechanical floor plan shows the same walls in grey.
    expect(takeoffRank("M101", "FLOOR PLAN").score).toBeLessThan(
      takeoffRank("A101", "FLOOR PLAN").score,
    );
  });

  it("says WHY, in words an estimator can check against the sheet", () => {
    expect(takeoffRank("A1.2-3", "LIFE SAFETY & OCCUPANCY PLAN").why).toContain("life-safety");
    expect(takeoffRank("A102", "DIMENSIONAL FLOOR PLAN").why).toContain("dimensioned");
    // "WALL TYPES" is NOT this case — `sheetSuitability` recognises it as a
    // partition-type legend, and the ranking folds that in rather than
    // restating it. A title that genuinely names nothing is this one.
    expect(takeoffRank("A999", "GENERAL INFORMATION").why).toMatch(/nothing in the title/);
    expect(takeoffRank("A999", "WALL TYPES").why).toContain("legend");
  });

  it("has no opinion rather than a wrong one about a title it cannot read", () => {
    // A title block that read badly gives an empty string. That must not score
    // like a floor plan, and must not sink below a sheet that named itself as
    // a section — "unknown" is weaker evidence than "says it is an elevation".
    const unknown = takeoffRank("A101", "");
    expect(unknown.score).toBeLessThan(takeoffRank("A101", "FLOOR PLAN").score);
    expect(unknown.score).toBeGreaterThan(takeoffRank("A101", "BUILDING SECTIONS").score);
  });
});

describe("ranking a whole set", () => {
  it("orders them best first and keeps page order within a tie", () => {
    const sheets = [
      { number: "A1.2-3", title: "LIFE SAFETY & OCCUPANCY PLAN LEVEL 3" },
      { number: "A4.B.2", title: "1 HR FLOOR PLAN LEVEL 2" },
      { number: "A4.B.3", title: "2 HR FLOOR PLAN LEVEL 3" },
      { number: "A2.20", title: "UNIT NUMBERING PLAN" },
      { number: "A120", title: "RESTROOM PLANS" },
    ];
    const ranked = rankSheetsForTakeoff(sheets).map((one) => one.sheet.number);
    // The two floor plans first, in page order; the enlarged restroom plan
    // next; the life-safety and unit-numbering plans last.
    expect(ranked.slice(0, 2)).toEqual(["A4.B.2", "A4.B.3"]);
    expect(ranked.slice(-2).sort()).toEqual(["A1.2-3", "A2.20"]);
  });

  it("does not crash on a set with no titles at all", () => {
    const ranked = rankSheetsForTakeoff([
      { number: "A101", title: null },
      { number: null, title: null },
    ]);
    expect(ranked).toHaveLength(2);
    // The architectural one still edges it, on the tie-break alone.
    expect(ranked[0].sheet.number).toBe("A101");
  });
});

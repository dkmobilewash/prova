import { describe, expect, it } from "vitest";
import { sheetSuitability, duplicateWallsCaution } from "./sheetSuitability";

/**
 * THE DEFECT THIS EXISTS FOR, IN NUMBERS.
 *
 * Scored against a 60-page answer key: recall on the floor plans was 72.6% and
 * A THIRD OF EVERYTHING REPORTED WAS NOT A WALL. All ten phantom pages were
 * mechanical plans, reflected ceiling plans or elevations — 13,767 ft invented:
 *
 *   M-101 mechanical   p27 p45 p47 p54   6,466 ft
 *   A-111 ceiling      p33 p39 p42 p48   5,875 ft
 *   A-201 elevations   p15 p49           1,426 ft
 *
 * The finder was right about the lines. An M-101 carries the architectural
 * walls repeated in grey, so they are real walls and also the SAME walls as the
 * A-101 — counting them bids the job twice.
 */

describe("telling a floor plan from a sheet that repeats one", () => {
  it("leaves an ordinary floor plan alone", () => {
    const s = sheetSuitability("A-101", "LEVEL 1 FLOOR PLAN", "PLAN");
    expect(s.likelyDuplicate).toBe(false);
    expect(duplicateWallsCaution(s, "A-101")).toBe("");
  });

  it("CATCHES THE MECHANICAL SHEET, which invented 6,466 ft across four pages", () => {
    const s = sheetSuitability("M-101", "LEVEL 1 MECHANICAL PLAN", "PLAN");
    expect(s.likelyDuplicate).toBe(true);
    expect(s.kind).toBe("mechanical plan");
  });

  it("CATCHES THE REFLECTED CEILING PLAN, which invented 5,875 ft", () => {
    // Numbered A-111 — an ARCHITECTURAL number, so the discipline letter cannot
    // catch it and the title has to.
    const s = sheetSuitability("A-111", "LEVEL 1 REFLECTED CEILING PLAN", "PLAN");
    expect(s.likelyDuplicate).toBe(true);
    expect(s.kind).toBe("reflected ceiling plan");
  });

  it("CATCHES THE ELEVATIONS, which invented 1,426 ft", () => {
    const s = sheetSuitability("A-201", "EXTERIOR ELEVATIONS", "ELEVATION");
    expect(s.likelyDuplicate).toBe(true);
    expect(s.kind).toBe("elevation");
  });

  it("catches the framing plan, whose girders are drawn a wall apart", () => {
    expect(sheetSuitability("S-101", "LEVEL 2 FRAMING PLAN", "PLAN").likelyDuplicate).toBe(true);
  });

  it("catches the schedules and the partition-type legend", () => {
    expect(sheetSuitability("A-601", "DOOR AND WINDOW SCHEDULES", "SCHEDULE").likelyDuplicate).toBe(true);
    expect(sheetSuitability("A-501", "PARTITION TYPES", "DETAIL").likelyDuplicate).toBe(true);
  });

  it("READS THE TITLE BEFORE THE NUMBER, because every one of these says PLAN", () => {
    // A REFLECTED CEILING PLAN and a MECHANICAL PLAN are both plans. Matching
    // the generic word first would clear every sheet in the set.
    expect(sheetSuitability("A-111", "REFLECTED CEILING PLAN", "PLAN").likelyDuplicate).toBe(true);
    expect(sheetSuitability("M-101", "MECHANICAL PLAN", "PLAN").likelyDuplicate).toBe(true);
  });

  it("lets the TITLE overrule an architectural number", () => {
    // An office that numbers its ceiling plans in the A-series still writes
    // REFLECTED CEILING PLAN on them.
    expect(sheetSuitability("A-101", "LEVEL 1 REFLECTED CEILING PLAN", "PLAN").kind).toBe(
      "reflected ceiling plan",
    );
  });

  it("falls back to the NUMBER when there is no title", () => {
    expect(sheetSuitability("M-101", null, null).kind).toBe("mechanical plan");
    expect(sheetSuitability("E-201", "", "").kind).toBe("electrical plan");
  });

  it("falls back to pageType when there is neither", () => {
    expect(sheetSuitability(null, null, "ELEVATION").likelyDuplicate).toBe(true);
    expect(sheetSuitability(null, null, "SCHEDULE").likelyDuplicate).toBe(true);
  });

  it("TREATS MISSING EVIDENCE AS A PLAN, so an unnumbered sheet is not nagged", () => {
    // The caution has to be earned. A sheet nobody has numbered, with no title
    // and a proposal older than the prompt that added pageType, has given no
    // reason to doubt it — and a warning nobody can act on is noise.
    expect(sheetSuitability(null, null, null).likelyDuplicate).toBe(false);
    expect(sheetSuitability("", "", "").likelyDuplicate).toBe(false);
    expect(sheetSuitability(undefined, undefined, undefined).likelyDuplicate).toBe(false);
  });

  it("does not mistake an A-series plan for a discipline sheet", () => {
    // `A-101` must not match the mechanical rule just by starting with a letter.
    for (const n of ["A-101", "A-102", "A1.11", "A 201 FLOOR PLAN"]) {
      expect(sheetSuitability(n, "FLOOR PLAN", "PLAN").likelyDuplicate, n).toBe(false);
    }
  });

  it("requires a DIGIT after the discipline letter", () => {
    // "MASONRY NOTES" starts with M and is not a mechanical sheet.
    expect(sheetSuitability("MASONRY", "FLOOR PLAN", "PLAN").likelyDuplicate).toBe(false);
  });
});

describe("what the estimator is told", () => {
  it("NAMES THE SHEET AND THE REASON, not just that something may be wrong", () => {
    const s = sheetSuitability("M-101", "LEVEL 1 MECHANICAL PLAN", "PLAN");
    const text = duplicateWallsCaution(s, "M-101");
    expect(text).toContain("M-101");
    expect(text).toContain("mechanical plan");
    expect(text).toContain("ductwork");
    // The consequence, in money terms, because that is what makes it act-on-able.
    expect(text).toContain("twice");
  });

  it("still says something useful when the sheet has no number", () => {
    const s = sheetSuitability(null, "EXTERIOR ELEVATIONS", null);
    expect(duplicateWallsCaution(s, null)).toContain("elevation");
  });

  it("says nothing at all about a floor plan", () => {
    expect(duplicateWallsCaution(sheetSuitability("A-101", "FLOOR PLAN", "PLAN"), "A-101")).toBe("");
  });
});

describe("the answer key's own pages, by sheet", () => {
  /**
   * THE WHOLE SET, scored the way the blind run was. Every sheet that invented
   * footage must be caught, and every sheet that holds real walls must not be —
   * a classifier that warns about everything is as useless as one that warns
   * about nothing, and only checking both halves can tell them apart.
   */
  const PHANTOM: ReadonlyArray<readonly [string, string, string, number]> = [
    ["M-101", "LEVEL 1 MECHANICAL PLAN", "PLAN", 6466],
    ["A-111", "LEVEL 1 REFLECTED CEILING PLAN", "PLAN", 5875],
    ["A-201", "EXTERIOR ELEVATIONS", "ELEVATION", 1426],
  ];
  const REAL: ReadonlyArray<readonly [string, string, string]> = [
    ["A-101", "LEVEL 1 FLOOR PLAN", "PLAN"],
    ["A-101-REV1", "LEVEL 1 FLOOR PLAN", "PLAN"],
    ["A-102", "LEVEL 2 FLOOR PLAN", "PLAN"],
  ];

  it("CATCHES EVERY SHEET THAT INVENTED FOOTAGE — all 13,767 ft of it", () => {
    let caught = 0;
    for (const [number, title, pageType, feet] of PHANTOM) {
      const s = sheetSuitability(number, title, pageType);
      expect(s.likelyDuplicate, `${number} ${title}`).toBe(true);
      caught += feet;
    }
    expect(caught).toBe(13_767);
  });

  it("LEAVES EVERY SHEET THAT HELD REAL WALLS ALONE — 30,690 ft of them", () => {
    for (const [number, title, pageType] of REAL) {
      expect(sheetSuitability(number, title, pageType).likelyDuplicate, number).toBe(false);
    }
  });

  it("also catches the zero-wall sheets that happened not to invent anything", () => {
    // S-101, A-501 and A-601 returned zero on their own in the blind run. That
    // was luck of the geometry, not a decision — on another export they would
    // not, and the key says all three carry no walls.
    for (const [number, title, pageType] of [
      ["S-101", "LEVEL 2 FRAMING PLAN", "PLAN"],
      ["A-501", "PARTITION TYPES", "DETAIL"],
      ["A-601", "DOOR AND WINDOW SCHEDULES", "SCHEDULE"],
      ["G-001", "COVER SHEET", "COVER"],
    ] as const) {
      expect(sheetSuitability(number, title, pageType).likelyDuplicate, number).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { sheetNumberFrom, CORNER_IS_INSIDE_REGION, CORNER_X, CORNER_Y } from "./sheetNumber";
import {
  TITLE_BLOCK_RIGHT_FRACTION,
  TITLE_BLOCK_BOTTOM_FRACTION,
  type PlanPageText,
  type PlanTextItem,
} from "./planPdf";
import { sheetSuitability } from "../takeoff/sheetSuitability";

/**
 * READING A SHEET NUMBER OFF A TITLE BLOCK.
 *
 * ── THE FIXTURES ARE THREE REAL LAYOUTS, REBUILT FROM MEASUREMENTS ──
 *
 * Every position and type height was measured off a real bid set on 2026-10-14
 * and rebuilt here synthetically: sheet numbers and generic sheet names only,
 * never a customer's project text. Three offices, because two of them break
 * rules the third would have passed:
 *
 *   West Herr  A-101 at 38.7pt, with A1/A3/A-301 detail refs over the drawing
 *   Naples     M011A at 88pt, with room tags A100-A108 at 12.5pt in the plan
 *   Augusta    A5.11 at 50.5pt, with "PERMIT SET" ABOVE it at 25pt
 */

const ARCH_D = { widthPt: 2592, heightPt: 1728 };

const at = (str: string, fx: number, fy: number, height: number): PlanTextItem => ({
  str,
  x: fx * ARCH_D.widthPt,
  y: fy * ARCH_D.heightPt,
  width: 0,
  height,
});

const page = (items: PlanTextItem[], over: Partial<PlanPageText> = {}): PlanPageText =>
  ({ pageNumber: 1, rotate: 0, items, ...ARCH_D, ...over }) as PlanPageText;

const westHerr = [
  at("07231.14", 0.89, 0.933, 25.8),
  at("A-101", 0.925, 0.967, 38.7),
  at("01-12-18", 0.941, 0.932, 25.8),
  at("A1", 0.052, 0.965, 12.1),
  at("A3", 0.305, 0.93, 9.7),
  at("A-301", 0.463, 0.937, 7.3),
];

const naples = [
  at("FIRST FLOOR DEMOLITION", 0.888, 0.896, 24.9),
  at("M011A", 0.901, 0.955, 88),
  at("PLAN", 0.888, 0.909, 24.9),
  at("MECHANICAL", 0.909, 0.909, 24.9),
  at("A107", 0.189, 0.21, 12.5),
  at("A100", 0.327, 0.187, 12.5),
];

const augusta = [
  at("PERMIT SET", 0.84, 0.984, 25),
  at("A5.11", 0.932, 0.954, 50.5),
  at("WALL SECTIONS", 0.974, 0.803, 19),
  at("DRAWING NUMBER", 0.933, 0.909, 12.5),
];

describe("the corner narrows planPdf's region rather than competing with it", () => {
  it("IS INSIDE IT, on both axes", () => {
    // ── THE DEFECT THIS PINS, AND IT WAS MINE ──
    //
    // #782 shipped a second title-block region — 0.82/0.72 as an INTERSECTION —
    // while `planPdf.ts` already had one argued better: the right 40% OR the
    // bottom 25%, a union, because *"a filter assuming one convention would
    // silently drop the sheet number on every set drawn the other way."* Two
    // lists of the same value is the shape CLAUDE.md names; this is the guard
    // that they cannot drift apart.
    expect(CORNER_IS_INSIDE_REGION).toBe(true);
    // Through the X CLAUSE ALONE, and the first version of this case got that
    // wrong: it also asserted `CORNER_Y >= TITLE_BLOCK_BOTTOM_FRACTION` and
    // went red, because 0.72 is looser than 0.75. That module's region is a
    // UNION — `x >= 0.6 OR y >= 0.75` — so anything right of 0.6 is inside it
    // whatever its y. The guard caught the reasoning, not the constants.
    expect(CORNER_X).toBeGreaterThanOrEqual(TITLE_BLOCK_RIGHT_FRACTION);
    expect(CORNER_Y, "y is free to be looser; the x clause is what contains the corner").toBeLessThan(
      TITLE_BLOCK_BOTTOM_FRACTION,
    );
  });
});

describe("the sheet number is the largest text in the title block", () => {
  it("reads all three offices' conventions, from the corner", () => {
    for (const [items, expected] of [
      [westHerr, "A-101"],
      [naples, "M011A"],
      [augusta, "A5.11"],
    ] as const) {
      const read = sheetNumberFrom(page([...items]));
      expect(read.sheetNumber).toBe(expected);
      expect(read.source, `${expected} should come from the corner`).toBe("corner");
    }
  });

  it("FALLS BACK TO THE WIDER REGION for a bottom-band title block", () => {
    // ── THE CASE THE FIRST VERSION MISSED, AND WHY IT ONLY READ 149 OF 218 ──
    //
    // An office that runs its title block along the BOTTOM puts the number at a
    // low x. A right-hand corner cannot see it; `planPdf.ts`'s union can,
    // which is the whole reason its region is a union. The reading says it came
    // from the wider region, because over that much area the largest text is
    // less certainly the number.
    const bottomBand = [
      at("ELEVATIONS", 0.3, 0.96, 20),
      at("A-201", 0.12, 0.96, 40),
      at("ISSUED FOR BID", 0.5, 0.96, 20),
    ];
    const read = sheetNumberFrom(page(bottomBand));
    expect(read.sheetNumber).toBe("A-201");
    expect(read.source).toBe("region");
  });

  it("ignores the detail references scattered over the drawing", () => {
    // 14 candidates on West Herr's real A-101. The region excludes them, not
    // the pattern — `A-301` matches every pattern `A-101` does.
    const read = sheetNumberFrom(page([...westHerr]));
    expect(read.regionText).not.toContain("A-301");
  });

  it("ignores room tags larger than another office's sheet number", () => {
    const read = sheetNumberFrom(page([...naples]));
    expect(read.sheetNumber).toBe("M011A");
    expect(read.regionText).not.toContain("A107");
  });

  it("skips the issue stamp to reach the number below it", () => {
    expect(sheetNumberFrom(page([...augusta])).sheetNumber).toBe("A5.11");
  });

  it("does NOT depend on the largest-text sort, on any office measured", () => {
    // ── AN HONEST NOTE ABOUT THE RULE THIS MODULE IS BUILT AROUND ──
    //
    // The header calls it "the largest piece of text in the title block", and a
    // mutation replacing the type-size sort with document order leaves every
    // case here GREEN. Measured, not assumed — and the fixtures were first
    // reordered so the number is never the first item, which ruled out the
    // obvious artefact.
    //
    // The reason is that inside the corner the PATTERN already disambiguates:
    // `07231.14` and `01-12-18` start with a digit, `PERMIT SET` has a space,
    // `DRAWING NUMBER` has no digit. None is a designation, so the first match
    // in any order is the number.
    //
    // The sort earns its place only when a corner holds TWO designations — a
    // reference cell reading `SEE A-301` beside the number, say — and **that has
    // not been seen on a real sheet here.** So it is kept as the stated
    // tiebreak, one line, and recorded as unproven rather than dressed up with
    // a fixture invented to make a mutation red. Same treatment as the zero
    // test in `scaleBar.ts`, which the linear fit turned out to subsume.
    //
    // What IS load-bearing, and is pinned by the cases above: the region (it
    // excludes the 14 detail references), the pattern, and the fallback.
    const shuffled = [...westHerr].reverse();
    expect(sheetNumberFrom(page(shuffled)).sheetNumber).toBe("A-101");
  });

  it("refuses a job number or a date, which share the corner", () => {
    const noNumber = [at("07231.14", 0.89, 0.933, 25.8), at("01-12-18", 0.941, 0.932, 25.8)];
    const read = sheetNumberFrom(page(noNumber));
    expect(read.sheetNumber).toBeNull();
    expect(read.source).toBe("none");
  });

  it("says nothing rather than guessing on an empty page", () => {
    expect(sheetNumberFrom(page([]))).toEqual({
      sheetNumber: null,
      regionText: "",
      source: "none",
    });
  });

  it("refuses a page that reports no size", () => {
    expect(sheetNumberFrom(page([...westHerr], { widthPt: 0, heightPt: 0 })).sheetNumber).toBeNull();
  });
});

describe("what it is FOR: the duplicate-walls caution with no proposal row", () => {
  // `effectiveSheetNumber` returns null when a page has NO proposal
  // (`sheetIndex.ts:63`), so `sheetSuitability` gets nothing and the caution
  // that keeps 13,767 invented feet off a mechanical plan cannot fire. These
  // are the same answers from the PDF alone.

  const judge = (items: PlanTextItem[]) => {
    const { sheetNumber, regionText } = sheetNumberFrom(page(items));
    return sheetSuitability(sheetNumber, regionText, null);
  };

  it("passes an architectural floor plan", () => {
    expect(judge([...westHerr]).likelyDuplicate).toBe(false);
  });

  it("catches the mechanical demolition sheet", () => {
    // Reports "demolition plan", not "mechanical plan": the corner reads FIRST
    // FLOOR DEMOLITION PLAN … MECHANICAL and `sheetSuitability` checks titles
    // before numbers, deliberately. Both are true of the sheet and the takeoff
    // decision is identical, so that is asserted first.
    const verdict = judge([...naples]);
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("demolition plan");
  });

  it("catches a mechanical sheet by its NUMBER when the title says nothing", () => {
    const numberOnly = [at("DRAWING NUMBER", 0.933, 0.909, 12.5), at("M1.12", 0.93, 0.954, 50.5)];
    const verdict = judge(numberOnly);
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("mechanical plan");
  });

  it("catches a section whose number says architectural", () => {
    const verdict = judge([...augusta]);
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("section");
  });

  it("DOES NOT see a note written out on the drawing", () => {
    // The bias this module exists to avoid: handing the title rules the whole
    // page disagreed with the number on 163 of 218 real pages, in the direction
    // that flatters coverage.
    const planWithNote = [...westHerr, at("SEE REFLECTED CEILING PLAN", 0.4, 0.5, 10)];
    expect(judge(planWithNote).likelyDuplicate).toBe(false);
  });
});

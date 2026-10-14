import { describe, expect, it } from "vitest";
import { titleBlockText } from "./titleBlockText";
import { sheetSuitability } from "../takeoff/sheetSuitability";
import type { PageTextItem } from "../takeoff/wallTags";

/**
 * READING A TITLE BLOCK WITHOUT PAYING A MODEL.
 *
 * ── THE FIXTURES ARE THREE REAL LAYOUTS, REBUILT FROM MEASUREMENTS ──
 *
 * Every position and type height below was measured off a real bid set on
 * 2026-10-14 and then rebuilt here as synthetic items: the sheet numbers and
 * generic sheet names only, never a customer's project text. Three offices,
 * because two of them break rules the third would have passed:
 *
 *   West Herr  A-101 at 38.7pt, with A1/A3/A-301 detail refs over the drawing
 *   Naples     M011A at 88pt, with room tags A100-A108 at 12.5pt in the plan
 *   Augusta    A5.11 at 50.5pt, with "PERMIT SET" ABOVE it at 25pt
 */

const ARCH_D = { widthPt: 2592, heightPt: 1728 };

const at = (str: string, fx: number, fy: number, height: number): PageTextItem => ({
  str,
  x: fx * ARCH_D.widthPt,
  y: fy * ARCH_D.heightPt,
  width: 0,
  height,
});

/** West Herr's A-101: the number in the corner, detail refs over the drawing. */
const westHerr: PageTextItem[] = [
  at("A-101", 0.925, 0.967, 38.7),
  at("07231.14", 0.89, 0.933, 25.8),
  at("01-12-18", 0.941, 0.932, 25.8),
  // The decoys, out in the drawing where the plan is.
  at("A1", 0.052, 0.965, 12.1),
  at("A3", 0.305, 0.93, 9.7),
  at("A-301", 0.463, 0.937, 7.3),
];

/** Naples: room tags LARGER than some offices' sheet numbers, and a number a
 *  `LETTER-DIGITS` pattern rejects for its trailing letter. */
const naples: PageTextItem[] = [
  at("M011A", 0.901, 0.955, 88),
  at("FIRST FLOOR DEMOLITION", 0.888, 0.896, 24.9),
  at("PLAN", 0.888, 0.909, 24.9),
  at("MECHANICAL", 0.909, 0.909, 24.9),
  at("A107", 0.189, 0.21, 12.5),
  at("A100", 0.327, 0.187, 12.5),
];

/** Augusta: the sheet title is set SMALLER than the issue stamp above it. */
const augusta: PageTextItem[] = [
  at("A5.11", 0.932, 0.954, 50.5),
  at("PERMIT SET", 0.84, 0.984, 25),
  at("WALL SECTIONS", 0.974, 0.803, 19),
  at("DRAWING NUMBER", 0.933, 0.909, 12.5),
];

describe("the sheet number is the largest text in the corner", () => {
  it("reads all three offices' conventions", () => {
    expect(titleBlockText(westHerr, ARCH_D.widthPt, ARCH_D.heightPt).sheetNumber).toBe("A-101");
    expect(titleBlockText(naples, ARCH_D.widthPt, ARCH_D.heightPt).sheetNumber).toBe("M011A");
    expect(titleBlockText(augusta, ARCH_D.widthPt, ARCH_D.heightPt).sheetNumber).toBe("A5.11");
  });

  it("IGNORES the detail references scattered over the drawing", () => {
    // 14 candidates on West Herr's real A-101. The region is what excludes them,
    // not the pattern — `A-301` matches every pattern `A-101` does.
    const read = titleBlockText(westHerr, ARCH_D.widthPt, ARCH_D.heightPt);
    expect(read.cornerText).not.toContain("A-301");
    expect(read.cornerText).not.toContain("A1");
  });

  it("IGNORES room tags that are larger than another office's sheet number", () => {
    // Naples prints room tags at 12.5pt; Augusta's sheet number is 50.5pt and
    // West Herr's is 38.7 — but a rule that took the largest match ON THE PAGE
    // would read Naples' plan as "A107". The region is the fix.
    const read = titleBlockText(naples, ARCH_D.widthPt, ARCH_D.heightPt);
    expect(read.sheetNumber).toBe("M011A");
    expect(read.cornerText).not.toContain("A107");
  });

  it("skips the issue stamp to reach the number below it", () => {
    // "PERMIT SET" is in the corner and is not a designation. The reader walks
    // down the type sizes rather than giving up on the first non-match.
    expect(titleBlockText(augusta, ARCH_D.widthPt, ARCH_D.heightPt).sheetNumber).toBe("A5.11");
  });

  it("refuses a job number or a date, which share the corner", () => {
    // Both start with a digit, so neither is a sheet designation. If the pattern
    // ever admits them, West Herr's `07231.14` at 25.8pt is the next largest
    // thing in that corner and would win on the sheets with no number.
    const noNumber = [at("07231.14", 0.89, 0.933, 25.8), at("01-12-18", 0.941, 0.932, 25.8)];
    expect(titleBlockText(noNumber, ARCH_D.widthPt, ARCH_D.heightPt).sheetNumber).toBeNull();
  });

  it("says nothing rather than guessing on a page with an empty corner", () => {
    expect(titleBlockText([], ARCH_D.widthPt, ARCH_D.heightPt)).toEqual({
      sheetNumber: null,
      cornerText: "",
    });
  });

  it("refuses a page that reports no size", () => {
    expect(titleBlockText(westHerr, 0, 0).sheetNumber).toBeNull();
  });
});

describe("what it is FOR: the sheet filter runs with no model", () => {
  // ── THE POINT OF THE WHOLE MODULE ──
  //
  // `sheetSuitability` decides whether a wall takeoff belongs on a page, and it
  // took its two best inputs from a model stage. These are the same answers,
  // free and offline.

  const read = (items: PageTextItem[]) => {
    const { sheetNumber, cornerText } = titleBlockText(items, ARCH_D.widthPt, ARCH_D.heightPt);
    return sheetSuitability(sheetNumber, cornerText, null);
  };

  it("passes an architectural floor plan", () => {
    expect(read(westHerr).likelyDuplicate).toBe(false);
  });

  it("catches the mechanical demolition sheet, and names the demolition", () => {
    // ── MY FIRST EXPECTATION HERE WAS WRONG AND THE CODE WAS RIGHT ──
    //
    // I asserted "mechanical plan", because `M011A` is a mechanical number. It
    // reports "demolition plan", because the corner reads FIRST FLOOR
    // DEMOLITION PLAN … MECHANICAL and `sheetSuitability` checks titles before
    // numbers — deliberately, per its own header. The sheet is a mechanical
    // demolition plan and both labels are true of it.
    //
    // What matters for the takeoff is identical either way, so that is what is
    // asserted first: no wall should be taken off this page.
    const verdict = read(naples);
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("demolition plan");
  });

  it("catches a mechanical sheet by its NUMBER when the title says nothing", () => {
    // The number's discipline letter on its own, with no title to help — which
    // is the half `titleBlock.ts`'s model was being paid for.
    const numberOnly = [at("M1.12", 0.93, 0.954, 50.5), at("DRAWING NUMBER", 0.933, 0.909, 12.5)];
    const verdict = read(numberOnly);
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("mechanical plan");
  });

  it("catches a section by its title, where the number says architectural", () => {
    // `A5.11` is an architectural number, so only the title can catch this —
    // which is `sheetSuitability`'s own argument for preferring the title.
    const verdict = read(augusta);
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("section");
  });

  it("DOES NOT see a note written out on the drawing", () => {
    // The bias this module exists to avoid. A floor plan carrying "SEE
    // REFLECTED CEILING PLAN" as a note must stay a floor plan — handing the
    // whole page to the title rules disagreed with the number on 163 of 218
    // real pages, and in the direction that flatters coverage.
    const planWithNote = [...westHerr, at("SEE REFLECTED CEILING PLAN", 0.4, 0.5, 10)];
    expect(read(planWithNote).likelyDuplicate).toBe(false);
  });
});

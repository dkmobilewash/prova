import { describe, expect, it } from "vitest";
import { SHEET_CASES, sameish } from "./planSheetCases";
import { planSetPdf } from "./planFixtures";
import { openPlanPdf, titleBlockText } from "./planPdf";

/**
 * THE EVAL'S CASES ARE WHAT THEY CLAIM TO BE, PROVED WITHOUT SPENDING A PENNY.
 *
 * `planSheets.eval.ts` measures how honestly a model reads a title block. It is run
 * by hand, it costs real money, and it is only worth running if the text handed to
 * the model is the text each case describes. This file checks that, in CI, in half a
 * second.
 *
 * IT EXISTS BECAUSE THE FIRST VERSION OF THE EVAL WAS WRONG IN EXACTLY THIS WAY. Its
 * most important case put four references to other sheets in the DRAWING area, so a
 * reader might grab one instead of the sheet's own number. Printing what actually
 * reached the model showed three lines — the title block alone. The region filter
 * had removed every reference, so the trap was never presented, and the case would
 * have passed for the wrong reason in the one eval written to catch that.
 *
 * `mustSend` is the fix as a property rather than as a comment: if a string a case
 * depends on stops reaching the model, this goes red for nothing instead of a run
 * going green for nothing.
 */

async function sent(caseId: string): Promise<string> {
  const one = SHEET_CASES.find((c) => c.id === caseId)!;
  const doc = await openPlanPdf(planSetPdf([one.sheet]));
  try {
    return titleBlockText(await doc.pageText(1)).text;
  } finally {
    await doc.close();
  }
}

describe("the eval's sheets say what the cases claim", () => {
  it("has the cases the eval is for, and no duplicate ids", () => {
    // THE SIZE ASSERTION FIRST: an empty list would make every loop below vacuous.
    expect(SHEET_CASES.length).toBeGreaterThanOrEqual(9);
    expect(new Set(SHEET_CASES.map((c) => c.id)).size).toBe(SHEET_CASES.length);
    // The judgements this eval is FOR, named rather than counted, so trimming the
    // list says which ones cannot go.
    const ids = SHEET_CASES.map((c) => c.id);
    for (const id of ["reference-in-block", "no-number", "not-a-sheet", "rotated"]) {
      expect(ids, `${id} is one of the cases the eval exists to measure`).toContain(id);
    }
  });

  it("sends every string each case depends on", async () => {
    for (const one of SHEET_CASES) {
      const text = await sent(one.id);
      expect(text.trim().length, `${one.id} sent nothing at all`).toBeGreaterThan(0);
      for (const must of one.mustSend) {
        // THE ASSERTION THAT CAUGHT THE REAL BUG. A case claiming the model must
        // choose between A-102 and A-501 is not that case if A-501 never arrives.
        expect(text, `${one.id} must send ${JSON.stringify(must)} or it is not the case it claims`).toContain(must);
      }
    }
  }, 30_000);

  it("sends the sheet's own number whenever the case says one is printed", async () => {
    for (const one of SHEET_CASES.filter((c) => c.sheetNumber !== null)) {
      const text = await sent(one.id);
      // Otherwise the case is unanswerable and a MISSED verdict would be the
      // harness's fault reported as the model's.
      expect(text, `${one.id} expects ${one.sheetNumber} to be readable`).toContain(one.sheetNumber!);
    }
  }, 30_000);

  it("sends NO sheet number on the cases that expect null", async () => {
    // The other half, and the one that makes an INVENTED verdict meaningful: if a
    // sheet-number-shaped string did reach the model here, reporting it would be
    // correct behaviour scored as invention.
    for (const one of SHEET_CASES.filter((c) => c.sheetNumber === null)) {
      const text = await sent(one.id);
      expect(text, `${one.id} must carry nothing that reads as a sheet number`).not.toMatch(
        /\b[A-Z]{1,2}-?\d{1,2}\.?\d{0,2}\b/,
      );
    }
  }, 30_000);

  it("compares the way the eval compares, including the apostrophe a font changed", () => {
    // Helvetica's standard encoding maps a straight apostrophe to a curly one, so a
    // scale written as 1/4" = 1'-0" comes back as 1/4" = 1’-0". An exact comparison
    // would mark a CORRECT reading wrong — the eval blaming the model for the font's
    // decision. Found by printing the extracted text before any run.
    expect(sameish("1/4\" = 1'-0\"", "1/4\" = 1’-0\"")).toBe(true);
    expect(sameish("a-101", " A-101 ")).toBe(true);
    // Still strict about content.
    expect(sameish("A-101", "A-102")).toBe(false);
    expect(sameish(null, "A-101")).toBe(false);
    expect(sameish(null, null)).toBe(true);
  });
});

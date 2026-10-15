import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../plan-ingest/planPdf";
import { sheetNumberFrom } from "../plan-ingest/sheetNumber";
import { cautionToShow, duplicateWallsCaution, sheetSuitability } from "./sheetSuitability";
import { VARIANTS, allSheets, primsForCase, sheetForVariant } from "./bench/cases";
import { writePdf } from "./bench/writers";

/**
 * ── THE CAUTION THAT KEEPS A MECHANICAL PLAN'S WALLS OUT OF A BID ──
 *
 * `sheetSuitability` has existed since 2026-10-08 and on a real plan set it says
 * NOTHING, because the takeoff page feeds it `effectiveSheetNumber` and
 * `effectiveTitle` — both of which return null for a page with no
 * `PlanSheetProposal`. Every sheet of every set uploaded before the ingest
 * shipped is in that state; one real 52-sheet set reads "52 need their numbers
 * typed in", which is 52 sheets it cannot judge.
 *
 * `sheetNumber.ts` was written for that gap and had no caller. This proves the
 * pair works end to end on drawings rather than on hand-made strings: real
 * PDFs, through the real title-block reader, into the real caution.
 *
 * ── WHY THE FIXTURES AND NOT A FABRICATED PAGE ──
 *
 * A hand-made page would assert the regex rather than the rule. These are the
 * bench's own sheets, drawn by the generator with title blocks laid out the way
 * it lays them out, and A-111 and M-101 are the two that invent ~2,300 ft of
 * wall each — the largest phantom numbers on the whole scorecard.
 */

const sheetPdf = (sheetId: string) => {
  const variant = VARIANTS.find((v) => v.id === "clean")!;
  const sheet = sheetForVariant(sheetId, "clean", allSheets());
  return { sheet, bytes: writePdf(sheet, primsForCase(sheet, variant)) };
};

async function judge(sheetId: string) {
  const { bytes } = sheetPdf(sheetId);
  const doc = await openPlanPdf(bytes);
  try {
    const reading = sheetNumberFrom(await doc.pageText(1));
    const verdict = sheetSuitability(reading.sheetNumber, reading.regionText, null);
    return { reading, verdict, caution: duplicateWallsCaution(verdict, reading.sheetNumber) };
  } finally {
    await doc.close();
  }
}

describe("reading what kind of sheet this is, off the drawing, with no model", () => {
  it("names the ceiling plan, which invents 2,314 ft of wall", async () => {
    const { reading, verdict, caution } = await judge("A-111");
    expect(reading.sheetNumber).toBe("A-111");
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("reflected ceiling plan");
    // The sentence has to NAME the suspicion, or an estimator cannot check it.
    expect(caution).toContain("A-111 is a reflected ceiling plan");
    expect(caution).toContain("bid those walls twice");
  });

  it("names the mechanical plan, which invents 2,268 ft", async () => {
    const { reading, verdict } = await judge("M-101");
    expect(reading.sheetNumber).toBe("M-101");
    expect(verdict.likelyDuplicate).toBe(true);
    expect(verdict.kind).toBe("mechanical plan");
  });

  it("LEAVES THE FLOOR PLAN ALONE, which is the half that makes it usable", async () => {
    // A caution on the sheet somebody is supposed to measure teaches people to
    // ignore cautions. This is the assertion that would fail first if the rules
    // were widened carelessly, and it is why it is here rather than implied.
    const { reading, verdict, caution } = await judge("A-101");
    expect(reading.sheetNumber).toBe("A-101");
    expect(verdict.likelyDuplicate).toBe(false);
    expect(caution).toBe("");
  });

  it("leaves the enlarged-plan sheet alone too", async () => {
    const { verdict } = await judge("A-401");
    expect(verdict.likelyDuplicate).toBe(false);
  });

  it("reads the number from the title block CORNER, not from a guess", async () => {
    // `source` separates a clean corner read from the much wider fallback. If
    // these ever drop to "region" the reader is working harder than it should
    // and the number is less certain — worth knowing before it is trusted.
    for (const id of ["A-101", "A-111", "M-101"]) {
      expect((await judge(id)).reading.source, `${id} fell back off the corner`).toBe("corner");
    }
  });
});

describe("which of the two cautions a sheet shows", () => {
  it("prefers the server's, because a person may have corrected it", () => {
    expect(cautionToShow("from the proposal", "from the drawing")).toBe("from the proposal");
  });

  it("falls back to the drawing when the server has nothing to say", () => {
    // The case this whole change exists for: a plan set uploaded before the
    // ingest, where every sheet has no proposal at all.
    expect(cautionToShow(undefined, "from the drawing")).toBe("from the drawing");
    expect(cautionToShow("", "from the drawing")).toBe("from the drawing");
    // Whitespace is not an answer. An empty-looking string would otherwise win
    // and silence the only reading there is.
    expect(cautionToShow("   ", "from the drawing")).toBe("from the drawing");
  });

  it("says nothing when neither has anything", () => {
    expect(cautionToShow(undefined, undefined)).toBe("");
  });
});

describe("and the viewer actually shows it", () => {
  /**
   * ── THE DECISIVE MUTATION HERE IS "MAKE IT RENDER NOTHING" ──
   *
   * Everything above proves the judgement is correct, and all of it would stay
   * green if the caution never reached a screen — the shape CLAUDE.md records
   * from expo-router, where three plausible fixes shipped green and rendered
   * nothing, and from `{false && (` leaving 11,111 tests passing.
   *
   * No test in this repo can drive pdf.js in a browser, so this reads the
   * source for the three facts that make the difference between wired and
   * written. The limit is stated rather than implied: a census says "written",
   * never "honoured". The click-list is what says honoured.
   */
  const code = () => {
    const raw = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
    // Comments stripped, because this file explains itself at length and the
    // explanations quote the very names being asserted — the #185 shape, and
    // the one `openDeduction.test.ts` paid for twice in one afternoon.
    return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  };

  it("reads the sheet's own title block", () => {
    expect(code(), "the viewer never reads the drawing's sheet number").toMatch(/sheetNumberFrom\(/);
    expect(code(), "the reading is never judged").toMatch(/sheetSuitability\(/);
  });

  it("RENDERS it — the decisive mutation here is make-it-render-nothing", () => {
    const text = code();
    const at = text.indexOf('data-takeoff="duplicate-walls-caution"');
    expect(at, "the caution element is gone entirely").toBeGreaterThan(0);
    // The element's own region, so this cannot pass on a name appearing
    // somewhere unrelated in a 1,300-line file.
    const region = text.slice(Math.max(0, at - 300), at + 400);
    // GUARDED BY THE VALUE, AND RENDERING THE VALUE. `{false && (` breaks the
    // first; dropping the interpolation breaks the second. Both were green
    // against an earlier version of this file, because the guard and the value
    // were the same two names and a census could not tell them apart.
    expect(region, "the caution is not guarded by whether there IS one").toMatch(
      /\{\s*sheetCaution\s*&&\s*found\.length > 0\s*&&\s*\(/,
    );
    expect(region, "the caution is never actually printed").toMatch(/\{\s*sheetCaution\s*\}/);
  });

  it("PREFERS THE SERVER'S ANSWER, asserted at the call site", () => {
    // `cautionToShow`'s own cases pin what the rule IS. This pins that the
    // viewer hands it the two readings in that order — the mutation that swaps
    // them is otherwise invisible, because both names still appear either way.
    expect(code(), "the precedence at the call site is backwards or gone").toMatch(
      /cautionToShow\(\s*duplicateWallsByPage\[pageNumber\]\s*,\s*readCaution\[pageNumber\]\s*\)/,
    );
  });

  it("only asks once per sheet, so paging does not re-read every page", () => {
    expect(code()).toMatch(/cautionAsked\.current\.has\(pageNumber\)/);
    expect(code()).toMatch(/cautionAsked\.current\.add\(pageNumber\)/);
  });
});

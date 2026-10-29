/**
 * A SHEET THAT IS THE WRONG QUESTION IS NEITHER TRAINED ON NOR SCORED.
 *
 * Michigan State A3, round 8: the finder offers nothing on it, Chrome traced
 * 20 walls, and those walls are mostly EXISTING (A-EXIST). A trace means "a
 * wall the finder missed", so training on this sheet teaches it to find walls
 * nobody is building, and scoring against it counts a correct refusal as a
 * miss. It makes both numbers worse while the finder gets better.
 *
 * Why this is not `HELD_OUT_SETS`: a held-out set is still an answer key —
 * scored, never trained on. That is the wrong shape here, because scoring
 * against this sheet is the other half of the problem. And the exclusion is
 * per SHEET: the rest of the Michigan set is not implicated.
 */
import { describe, expect, it } from "vitest";
import { EXCLUDED_SHEETS, excludedSheetReason, heldOutReason } from "./heldOutSets";
import { trainingRows, type LabelledSheet } from "./trainingRows";

const sheet = (set: string, name: string, rows: number): LabelledSheet => ({
  set,
  sheet: name,
  rows: Array.from({ length: rows }, (_, i) => ({ y: i % 2 === 0 ? 1 : 0 }) as never),
});

describe("sheets excluded from training and scoring", () => {
  it("names Michigan State A3 and says why, in terms somebody can act on", () => {
    const why = excludedSheetReason("michigan-state-universtity", "A3");
    expect(why, "A3 is not excluded").not.toBeNull();
    expect(why, "the reason does not say what is wrong with the sheet").toMatch(/EXIST/);
    expect(why, "the reason does not say who decided or where to read it").toMatch(/BOARD\.md/);
  });

  it("matches however the names were punctuated", () => {
    // The corpus spells this set with and without punctuation, and the sheet
    // as A3 in one place. `flatten` is what makes one entry cover them.
    expect(excludedSheetReason("michigan_state_universtity.pdf", "a3")).not.toBeNull();
    expect(excludedSheetReason("MICHIGAN-STATE-UNIVERSTITY", "A3")).not.toBeNull();
  });

  it("excludes the SHEET, not the set — A4 and the rest still train", () => {
    // The whole point of a sheet-level list. If this ever starts refusing the
    // set, the exclusion has quietly become a held-out set.
    expect(excludedSheetReason("michigan-state-universtity", "A4")).toBeNull();
    expect(excludedSheetReason("michigan-state-universtity", "A5")).toBeNull();
    expect(heldOutReason("michigan-state-universtity"), "the set became an answer key").toBeNull();
  });

  it("is not a held-out set in disguise", () => {
    for (const one of EXCLUDED_SHEETS) {
      expect(
        heldOutReason(one.set),
        `${one.set} is in BOTH lists — a held-out set is scored, an excluded sheet is not, and a set ` +
          `cannot be both without one list silently winning`,
      ).toBeNull();
    }
  });

  it("trainingRows REFUSES it, with the reason, and keeps every other sheet", () => {
    // The refusal that matters: one implementation, in the funnel the census
    // guards, so nothing reaches training around it.
    const got = trainingRows([
      sheet("michigan-state-universtity", "A3", 4),
      sheet("michigan-state-universtity", "A4", 3),
      sheet("BUNKIE-BID-DRAWINGS", "A100", 5),
    ]);
    const refusedSheets = got.refused.map((r) => `${r.set}/${r.sheet}`);
    expect(refusedSheets, "A3 was not refused").toContain("michigan-state-universtity/A3");
    expect(refusedSheets, "A4 was refused too, so the exclusion hit the set").not.toContain(
      "michigan-state-universtity/A4",
    );
    const refusal = got.refused.find((r) => r.sheet === "A3");
    expect(refusal?.why, "the refusal does not carry the reason").toMatch(/EXIST/);
    expect(refusal?.rows, "the refusal does not say how many rows it dropped").toBe(4);
  });
});

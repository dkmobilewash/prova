import { describe, expect, it } from "vitest";
import { insideWorkArea } from "./userExclusions";
import { isWholeSheet, notInWorkAreaWords, WHOLE_SHEET, WORK_AREA_PROMPT, workAreaPrompt } from "./workAreaFirst";

/**
 * Diego's audit order (2026-11-25), coordination/work-area-first.md W1-W4: on a sheet that shows existing work the work
 * area is the first step, and it stays asked until a work area exists — drawn, or the whole sheet as new work.
 */

const drawn = { kind: "WORK_AREA", xs: [0.1, 0.5, 0.5, 0.1], ys: [0.1, 0.1, 0.5, 0.5] };
const like = { kind: "EXCLUDE_LIKE", xs: [0.1, 0.2], ys: [0.3, 0.3] };

describe("W1-W2: when the work area is asked", () => {
  it("the words, exactly as the order gives them", () => {
    expect(WORK_AREA_PROMPT).toBe("Draw your work area: walls outside it won't be counted");
  });
  it("asks on a sheet that shows existing work and has no work area", () => {
    expect(workAreaPrompt({ marks: ["(E)"], paired: false, exclusions: [] })).toBe("ask");
  });
  it("keeps asking when only walls drawn like one were excluded: the two exits are a work area or the whole sheet", () => {
    expect(workAreaPrompt({ marks: ["(E)", "DEMO"], paired: false, exclusions: [like] })).toBe("ask");
  });
  it("is done once a work area is drawn, or the whole sheet is new work", () => {
    expect(workAreaPrompt({ marks: ["(E)"], paired: false, exclusions: [drawn] })).toBe("done");
    expect(workAreaPrompt({ marks: ["(E)"], paired: false, exclusions: [{ kind: "WORK_AREA", ...WHOLE_SHEET }] })).toBe("done");
  });
  it("never asks on a new-build sheet (NIC alone is not existing work), or one a demolition plan handles", () => {
    expect(workAreaPrompt({ marks: [], paired: false, exclusions: [] })).toBe("none");
    expect(workAreaPrompt({ marks: ["NIC"], paired: false, exclusions: [] })).toBe("none");
    expect(workAreaPrompt({ marks: ["(E)"], paired: true, exclusions: [] })).toBe("none");
  });
});

describe("W3: the whole sheet as new work", () => {
  it("covers every point of a page, landscape or portrait, so nothing is set aside", () => {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1.5], [1, 1.5], [0.5, 0.7]] as const) expect(insideWorkArea(x, y, [WHOLE_SHEET])).toBe(true);
  });
  it("is told apart from a drawn area", () => {
    expect(isWholeSheet(WHOLE_SHEET.xs, WHOLE_SHEET.ys)).toBe(true);
    expect(isWholeSheet(drawn.xs, drawn.ys)).toBe(false);
  });
});

describe("W4: the effect, in the order's words", () => {
  it("reads the feet not in the work area, rounded, with a real minus sign", () => {
    expect(notInWorkAreaWords(1240.4)).toBe("−1,240 ft not in your work area");
  });
  it("says nothing when nothing is outside it", () => {
    expect(notInWorkAreaWords(0)).toBeNull();
    expect(notInWorkAreaWords(null)).toBeNull();
  });
});

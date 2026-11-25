import { showsExistingWork } from "@/lib/takeoff/renovationMarks";

/**
 * ── THE WORK AREA IS THE FIRST STEP ON A SHEET THAT SHOWS EXISTING WORK (Diego's audit order, 2026-11-25) ──
 *
 * coordination/work-area-first.md. A renovation sheet opens asking for the work area and keeps asking until one exists:
 * drawn, or the whole sheet as new work (one work area over the page). Excluding walls drawn like one is not an answer:
 * the order names two exits. The same rule is read by the viewer, the whole-set panel, the review queue and the
 * estimate's warning, so the screen and the server cannot disagree about which sheets are answered.
 */
export const WORK_AREA_PROMPT = "Draw your work area: walls outside it won't be counted";

/** The page square and then some, inside `addSheetExclusion`'s bounds: every point of a landscape or portrait sheet is in it. */
export const WHOLE_SHEET = { xs: [-0.01, 2, 2, -0.01], ys: [-0.01, -0.01, 2, 2] } as const;

export function isWholeSheet(xs: readonly number[], ys: readonly number[]): boolean {
  return xs.length === WHOLE_SHEET.xs.length && xs.every((x, i) => x === WHOLE_SHEET.xs[i] && ys[i] === WHOLE_SHEET.ys[i]);
}

/**
 * `ask` until a work area exists on a sheet whose words show existing work; `none` for a new-build sheet or one a paired
 * demolition plan handles (plan comparison sets its existing walls aside and says so instead).
 */
export function workAreaPrompt(input: { marks: readonly string[]; paired: boolean; exclusions: readonly { kind: string }[] }): "none" | "ask" | "done" {
  if (!showsExistingWork(input.marks) || input.paired) return "none";
  return input.exclusions.some((e) => e.kind === "WORK_AREA") ? "done" : "ask";
}

/** "−1,240 ft not in your work area", with a real minus sign; nothing when nothing is outside it. */
export function notInWorkAreaWords(feet: number | null): string | null {
  if (feet === null || !(Math.round(feet) > 0)) return null;
  return `−${Math.round(feet).toLocaleString("en-US")} ft not in your work area`;
}

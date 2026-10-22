import { takeoffRank } from "./sheetSuitability";
import { viewKind, type ViewKind } from "./viewKind";

/**
 * ── IS THERE ANYTHING ON THIS SHEET TO TAKE OFF? ──
 *
 * A130 is PARTITION TYPES — a legend of wall assemblies drawn in section.
 * A140 is PLAN DETAILS. Neither has a floor plan on it, and both offer Find
 * the walls exactly as a floor plan does. Pressing it on a partition legend
 * returns hundreds of feet of "wall", because a wall type drawn in section IS
 * two parallel lines a wall-thickness apart, repeated down the sheet. That is
 * the most convincing phantom this product can produce.
 *
 * ── WHY THIS CANNOT BE A GEOMETRIC TEST ──
 *
 * There is no measurement that separates a partition legend from a floor plan.
 * Both are parallel line pairs at scheduled thicknesses; the legend is the
 * tidier of the two. The only thing that knows is what the drafter wrote on
 * it, which is why this reads the title and the view captions and nothing
 * else.
 *
 * ── IT REFUSES, IT DOES NOT HIDE ──
 *
 * `TakeoffPlanViewer` already has a note about this, from a defect reported
 * the day it shipped: Find the walls used to be HIDDEN until a sheet had a
 * scale, and somebody went looking for the button they had been told about and
 * found nothing — "no error, no explanation, just an absence, which reads as
 * 'this feature does not exist'". So the verdict here carries a REASON for the
 * button's tooltip, and the caller keeps the button on the toolbar.
 *
 * And it is advisory, never a lock. A set can caption a floor plan anything at
 * all, and the person looking at the drawing knows better than its title block
 * does. The product offers an override; what it must not do is INVITE the
 * press, and must not make it automatically.
 */

export type TakeoffSheetVerdict = {
  /** Should this sheet be offered for wall detection without a warning? */
  worthMeasuring: boolean;
  /** Why not, in the estimator's own words, for a tooltip or a line of help.
   *  Null when there is nothing to say. */
  why: string | null;
  /** True when an automatic or one-click run should SKIP this sheet
   *  altogether. Identical to `!worthMeasuring` today and named separately
   *  because the two questions are different ones: a person may press a
   *  button on a sheet nothing would choose for them. */
  skipAutomatically: boolean;
};

/**
 * ── THE SAME VOCABULARY AS EVERYTHING ELSE, NOT A THIRD COPY ──
 *
 * `takeoffRank` ranks a sheet TITLE and `viewKind` classifies a view CAPTION,
 * and both already read one list of words in `sheetSuitability.ts`. This asks
 * them rather than restating them: a sheet is worth measuring when its title
 * is not something else, and when the drawings on it are plans or are at least
 * not named as something else.
 */
export function takeoffSheetVerdict(input: {
  sheetNumber: string | null | undefined;
  title: string | null | undefined;
  /** The captions of the drawings on the sheet, where they are known. */
  viewNames?: readonly string[];
}): TakeoffSheetVerdict {
  const rank = takeoffRank(input.sheetNumber, input.title);
  const titleSaysOtherwise = rank.score < 0;

  const kinds: ViewKind[] = (input.viewNames ?? []).map((name) => viewKind(name).kind);
  const anyPlan = kinds.includes("plan");
  const allNotPlans = kinds.length > 0 && kinds.every((kind) => kind === "not-a-plan");

  // ── A CAPTIONED PLAN BEATS A TITLE THAT SAYS OTHERWISE ──
  //
  // The drawing is better evidence than the sheet's own name for this
  // question: a sheet called DETAILS that carries a captioned ENLARGED PLAN
  // has a plan on it, and the plan is the thing somebody opened it for.
  if (anyPlan) {
    return { worthMeasuring: true, why: null, skipAutomatically: false };
  }

  if (allNotPlans) {
    const first = input.viewNames?.[0];
    const reason = first ? viewKind(first).why : "not a plan";
    return {
      worthMeasuring: false,
      why: `Every drawing on this sheet is ${reason} — there is no floor plan here to measure.`,
      skipAutomatically: true,
    };
  }

  if (titleSaysOtherwise) {
    return {
      worthMeasuring: false,
      why: `This is ${rank.why} — there is no floor plan here to measure.`,
      skipAutomatically: true,
    };
  }

  // ── NOT RECOGNISED IS NOT REFUSED ──
  //
  // A title this does not know is the common case on a real set, and refusing
  // it would quietly remove the feature from every sheet an office names in
  // its own shorthand. Silence is the right answer: the button stays, with
  // nothing in the way.
  return { worthMeasuring: true, why: null, skipAutomatically: false };
}

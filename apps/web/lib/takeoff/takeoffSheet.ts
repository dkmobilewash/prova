import { takeoffRank, sheetTitleRefusal } from "./sheetSuitability";
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
const FLOOR_PLAN = /\bFLOOR\s+PLANS?\b/i;
/** A trade or purpose right before the words: this is that trade's plan of the floor. */
const SOMEONE_ELSES_FLOOR_PLAN = /\b(?:STRUCTURAL|FRAMING|MECHANICAL|HVAC|PLUMBING|ELECTRICAL|LIGHTING|POWER|FIRE|SPRINKLER|DEMO(?:LITION)?|EXISTING|FINISH(?:ES)?|FURNITURE|FF&E|CODE|LIFE\s+SAFETY|EGRESS|EVACUATION|SIGNAGE)\s*[-–—:]?\s*FLOOR\s+PLANS?\b/i;
const OTHER_DRAWING = /\b(?:REFLECTED|CEILING|ELEVATIONS?|SECTIONS?|SCHEDULES?|ENLARGED)\b/i;
/** A sheet number in the A series, and not a demolition AD sheet. */
const ARCHITECTURAL = /^A(?!D)[-.\d]/i;

/** The sheet's own title says it holds the floor plan. Pure; the words are the title's, never the notes'. */
export function ownsFloorPlan(sheetNumber: string | null | undefined, title: string | null | undefined): boolean {
  const text = title ?? "";
  const plan = text.search(FLOOR_PLAN);
  if (!ARCHITECTURAL.test(sheetNumber ?? "") || plan < 0 || SOMEONE_ELSES_FLOOR_PLAN.test(text)) return false;
  // A title names its main drawing first: "REFLECTED CEILING PLAN … FLOOR PLAN"
  // is a ceiling sheet, and "Enlarged Plans and Elevations" repeats a floor.
  const other = text.search(OTHER_DRAWING);
  return other < 0 || plan < other;
}

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

  // ── AN ARCHITECTURAL SHEET THAT SAYS FLOOR PLAN IS ONE ──
  //
  // Measured on the whole-set sweep, 2026-10-31: titles join several drawings
  // ("FLOOR PLAN & DETAILS", "Floor Plans and Roof Plan", "FLOOR PLAN KEY
  // PLAN"), one other word refused the sheet, and Fairgrounds, Alden and
  // Crosslines lost their only plan: a whole building at zero with no error.
  if (ownsFloorPlan(input.sheetNumber, input.title)) {
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
  // ── THE SHEET-ONLY WORDS ──
  // Code, FF&E, ceiling, fire-protection, demolition and assemblies sheets:
  // refused here and not in the shared rank, so the viewer's view split on a
  // page does not move (see `NOT_A_FLOOR_PLAN_SHEET`).
  const sheetOnly = sheetTitleRefusal(input.title);
  if (sheetOnly !== null) {
    return {
      worthMeasuring: false,
      why: `This is ${sheetOnly} — there is no floor plan here to measure.`,
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

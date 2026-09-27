/**
 * Whether a measured run can be posted against a wall type, and with what.
 *
 * ISSUE #515 — two measurement paths into the estimate with two behaviours. A
 * wall run created on the Wall types page arrives complete: description,
 * quantity, labour hours, unit price, budgeted unit cost, craft classification,
 * catalog link, production rate and (since #513) cost category. A plan takeoff
 * arrived carrying description, unit and quantity and nothing else — so the
 * newest and most impressive way to get quantities into a bid was also the one
 * that dropped you back into hand-pricing every row, while the path needing no
 * PDF at all arrived priced.
 *
 * PURE AND ARGUMENT-TAKING, like `bid-recap.ts`, `takeoff.ts` and `wip.ts`. The
 * decisions here are the whole of what can go wrong — which wall type, whose
 * height, and whether the type can price anything at all — and none of them
 * needs a database to be checked. `lib/actions/takeoff.ts` reads the two rows
 * and does what this says.
 *
 * EVERY REFUSAL IS A SENTENCE A FORM CAN RENDER, and names the way out.
 * Production redacts a thrown Server Action message to a digest, so a refusal
 * that reads perfectly in `next dev` reaches a real estimator as a dead button.
 */

/** The wall type as this decision needs it — Decimals already resolved, so
 * nothing here has to know about Prisma. */
export type WallTypeFacts = {
  code: string;
  /** Null is a real state: a type that does not commit to a height. */
  defaultHeightFt: number | null;
  sides: number;
};

export type MeasuredWallRunPlan =
  | { ok: true; heightFt: number; sides: 1 | 2; label: string }
  | { ok: false; error: string };

/** The one refusal that is a LOOKUP concern rather than a decision: the id did
 * not resolve on this company. Lives here so the sentence has one home, and is
 * returned by the caller that did the lookup. */
export const WALL_TYPE_GONE = "That wall type isn't on your account any more. Reload the page.";

export function planMeasuredWallRun(input: {
  wallType: WallTypeFacts;
  /** How many components the type has. Zero is the case worth refusing. */
  layerCount: number;
  /** A height typed for THESE runs, overriding the type's default. */
  typedHeightFt: number | null;
  /** What the estimator called the selection. */
  label: string;
}): MeasuredWallRunPlan {
  const { wallType, layerCount, typedHeightFt, label } = input;

  // A type with no layers produces NO schedule lines, so posting against it
  // would record a wall run and add NOTHING to the estimate — a takeoff that
  // looks posted and changed no number on the bid. Strictly worse than the bare
  // quantities it replaced, which at least carried the measurement.
  if (layerCount === 0) {
    return {
      ok: false,
      error:
        `"${wallType.code}" has no layers yet, so posting against it would add a wall run and no line items. ` +
        `Add its layers on the Wall types page, or post these measurements as quantities instead.`,
    };
  }

  // The type's default, unless somebody typed one for these runs.
  // `WallRun.heightFt` is per-run precisely so one measured run can differ from
  // the type's default without editing the type for every other job.
  const heightFt = typedHeightFt ?? wallType.defaultHeightFt;
  if (heightFt == null) {
    return {
      ok: false,
      error:
        `"${wallType.code}" has no default height, so type the wall height for these runs — ` +
        `a drawing does not carry one.`,
    };
  }
  if (!(heightFt > 0)) {
    return { ok: false, error: "A wall height has to be more than zero." };
  }

  return {
    ok: true,
    heightFt,
    // The schema allows any Int; the schedule only means one or two.
    sides: wallType.sides === 1 ? 1 : 2,
    // Named after what the estimator called the selection, falling back to the
    // type's own code so a run is never nameless on the schedule.
    label: label.trim() || wallType.code,
  };
}

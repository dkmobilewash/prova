import { takeoffRank } from "./sheetSuitability";

/**
 * ── IS THIS DRAWING A PLAN, SOMETHING ELSE, OR CANNOT YOU TELL? ──
 *
 * A sheet carrying one plan and eight interior elevations had all nine
 * measured, and the elevations' footage went into the quantities as wall. An
 * elevation IS parallel lines a wall-thickness apart for the height of a wall,
 * so no geometric rule can refuse it: the only thing that separates a plan from
 * an elevation of the same wall is the caption the drafter wrote under it.
 *
 * ── THREE ANSWERS AND NOT TWO, WHICH IS THE WHOLE POINT ──
 *
 * "Not a plan" and "I cannot tell" must not collapse into each other. A caption
 * this does not recognise is the common case on a real set — an office's own
 * shorthand, a view named after a room — and measuring it silently is how eight
 * elevations reached a bid. Refusing it silently is the same failure wearing a
 * cautious face: the estimator loses a drawing and is not told.
 *
 * So `check` is its own answer, and the caller's job is to SAY SO rather than
 * to decide. `sheetViews.ts` and `excludedViews` carry it to the caution.
 *
 * ── THE VOCABULARY IS NOT A SECOND LIST ──
 *
 * It is `takeoffRank`'s, which already ranks SHEET titles by the same words and
 * already gets the hard part right: a demotion beats a promotion, because every
 * one of LIFE SAFETY, UNIT NUMBERING and REFLECTED CEILING also says PLAN. This
 * repo has paid twice for a second copy of a canonical list — see CLAUDE.md on
 * the bid recap's rates, where a completeness test passed while a consumer read
 * its own inlined copy — so this asks that function rather than restating it.
 *
 * What a view caption needed that a sheet title did not is the ABBREVIATIONS:
 * `ELEV.`, `SECT.`, `DET.`, `SCHED.`. Those went into `takeoffRank`'s own list,
 * where sheet ranking benefits from them too.
 */
export type ViewKind = "plan" | "not-a-plan" | "check";

/**
 * The score at or below which a caption is naming something other than a plan.
 *
 * `takeoffRank` returns a NEGATIVE score for every title it recognises as
 * something else and a positive one for every kind of plan, so zero is the
 * boundary the function already draws — not a number chosen here. Its
 * "nothing in the title says what it is" case returns 0 (or 5 for an A-series
 * number), which is why `check` is read from the REASON rather than from a
 * band of scores.
 */
const NOT_A_PLAN_AT_OR_BELOW = 0;

/** What `takeoffRank` says when it recognised nothing at all. */
const RECOGNISED_NOTHING = "nothing in the title says what it is";

export type ViewVerdict = {
  kind: ViewKind;
  /** Why, in the estimator's own words — "an elevation", "a schedule". */
  why: string;
};

/**
 * What kind of drawing a view's caption names.
 *
 * Takes the caption alone and no sheet number: a view's caption sits under the
 * drawing and has nothing to do with the discipline letter on the sheet, and
 * passing one would let an A-series sheet nudge an elevation towards being
 * measured.
 */
export function viewKind(caption: string | null | undefined): ViewVerdict {
  const name = (caption ?? "").trim();
  if (name === "") return { kind: "check", why: "this drawing has no caption" };

  const rank = takeoffRank(null, name);
  if (rank.why === RECOGNISED_NOTHING) {
    return { kind: "check", why: `the caption does not say what kind of drawing this is` };
  }
  if (rank.score <= NOT_A_PLAN_AT_OR_BELOW) return { kind: "not-a-plan", why: rank.why };
  return { kind: "plan", why: rank.why };
}

/** Is this caption a drawing whose walls should be measured? */
export function isPlanView(caption: string | null | undefined): boolean {
  return viewKind(caption).kind === "plan";
}

/**
 * How the caution should name a set of left-out drawings.
 *
 * "Left out: 8 elevations, 1 schedule" rather than "8 views excluded", because
 * an estimator can check the first against the sheet in front of them and can
 * only worry about the second. Counted by REASON, which is already the
 * estimator's own word for the thing.
 */
export function leftOutSummary(reasons: readonly string[]): string {
  if (reasons.length === 0) return "";
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const parts = [...counts].map(([reason, count]) => {
    if (count === 1) return reason;
    // "an elevation" -> "8 elevations". The article goes and the noun takes an
    // s, which is right for every phrase this list can produce.
    const noun = reason.replace(/^(a|an|the)\s+/i, "");
    return `${count} ${noun.endsWith("s") ? noun : `${noun}s`}`;
  });
  return parts.join(", ");
}

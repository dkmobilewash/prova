import { isPropagatedTag, isSiblingTag } from "./planTextTags";
import { settledType, verdictFor, type WallGroup } from "./wallGroups";
import type { MatchableWallType } from "./wallTypeMatch";
import { autoPosts } from "./autoPost";

/**
 * ── SUGGEST, DON'T POST: NO WALL TYPE IS PRICED WITHOUT A PERSON ──
 *
 * Diego, 2026-11-05: a wrong type misprices a bid silently. The first rule was
 * to post only sources right 95% of the time on training; printed legend-code
 * tags made it (95.6%) and were 47.6% right on held-out. So nothing posts.
 * Every group goes to "Walls — untyped" and the review queue with the
 * drawing's type pre-filled and where it came from (`suggestion`); the
 * estimator confirms it per group.
 *
 * `POSTS` stays as the switch, each line with the rate it was measured at,
 * so a source that earns it later is one line and its evidence.
 *
 * The eval (`wallTypes.eval.ts`) reads this same function, so what it scores is
 * what the stage posts. Change a line here only with a new measurement beside it.
 */
export type PostSource = "tag" | "tag-variant" | "carried" | "sibling" | "note" | "thickness";

/**
 * Whether each source posts without a person: read off its measurement in
 * `autoPost.ts` (≥97% training AND ≥95% held-out). Every source is off until
 * one measures past that bar; the numbers live beside the rule there.
 */
export const POSTS: Record<PostSource, boolean> = Object.fromEntries(
  (["tag", "tag-variant", "carried", "sibling", "note", "thickness"] as const).map((s) => [s, autoPosts(s)]),
) as Record<PostSource, boolean>;

/** The type the drawing gives a group and how, before the gate; null where it gives none. */
export function typeSource(group: WallGroup): { type: MatchableWallType; source: PostSource } | null {
  const verdict = verdictFor(group);
  const settled = settledType(verdict);
  if (settled !== null) {
    if (group.source.kind !== "TAG") return { type: settled, source: "thickness" };
    if (isPropagatedTag(group.source.tag)) return { type: settled, source: "carried" };
    if (isSiblingTag(group.source.tag)) return { type: settled, source: "sibling" };
    // A variant is a code the legend never printed (`withVariantTypes`): the
    // reader's inference that A3 is A's 3-5/8" stud, and on Joplin the A3
    // leaders end on walls the key calls plain A.
    return { type: settled, source: settled.family === undefined ? "tag" : "tag-variant" };
  }
  // The note's default, only where it is the ONE type that thick: Joplin's
  // 7-1/4 in bucket is its CMU default B and its 6 in stud partition A3 at
  // once, and that is a question for the person, not a priced line.
  if (verdict.state === "ASK" && group.source.kind === "GENERAL_NOTE" && verdict.suggested && group.candidates.length === 1) return { type: verdict.suggested, source: "note" };
  return null;
}

/**
 * The type the whole-set run posts a group as, and from which source, or null: the drawing's
 * type, where its source passes `POSTS` and the company has "Auto-post proven items" on.
 */
export function postedType(group: WallGroup, autoPostOn = true): { type: MatchableWallType; source: PostSource } | null {
  if (!autoPostOn) return null;
  const found = typeSource(group);
  return found !== null && POSTS[found.source] ? found : null;
}

/** How each source is named beside its suggestion. */
export const SOURCE_WORDS: Record<PostSource, string> = {
  tag: "printed tag",
  "tag-variant": "printed tag, read as a variant",
  carried: "tag carried along the wall",
  sibling: "tag on another sheet of this floor",
  note: "legend's \"unless noted otherwise\"",
  thickness: "the only type that thick",
};

/** The type the review queue pre-fills for a group, and where it came from. */
export function suggestion(group: WallGroup): { code: string; from: string } | null {
  const found = typeSource(group);
  return found === null ? null : { code: found.type.code, from: SOURCE_WORDS[found.source] };
}

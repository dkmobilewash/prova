import { isPropagatedTag, isSiblingTag } from "./planTextTags";
import { settledType, verdictFor, type WallGroup } from "./wallGroups";
import type { MatchableWallType } from "./wallTypeMatch";

/**
 * ── PRECISION FIRST: A TYPE IS POSTED ONLY FROM A SOURCE THAT IS RIGHT 95% OF THE TIME ──
 *
 * Diego, 2026-11-05: a wrong type misprices a bid silently, so the whole-set
 * run posts a type automatically only where its source's correct-of-typed rate
 * on the training keys is 95% or better. Every other group goes to "Walls —
 * untyped" and the review queue, with the type it would have had offered first
 * (`suggestedCode`), one press to accept.
 *
 * Each line of `POSTS` carries the rate it was set from.
 *
 * The eval (`wallTypes.eval.ts`) reads this same function, so what it scores is
 * what the stage posts. Change a line here only with a new measurement beside it.
 */
export type PostSource = "tag" | "tag-variant" | "carried" | "sibling" | "note" | "thickness";

/**
 * Measured on the 7 training sheets with type keys (labels-snap-r12b), every
 * training sheet run, correct share of the keyed footage each source typed:
 */
export const POSTS: Record<PostSource, boolean> = {
  /** A printed tag naming a code the legend defines: 1,022 ft, 95.6% (5 of 6 sheets 100%; Joplin 65%). */
  tag: true,
  /** A printed tag the reader made a variant of a legend family (Joplin's A3 of A): 435 ft, 76.8%. */
  "tag-variant": false,
  /** A tag carried along the wall past where it was printed: 164 ft, 82.0%. */
  carried: false,
  /** A tag read off another sheet of the same floor (Green Bay A3.1 from A3.2): 278 ft, 71.9%. */
  sibling: false,
  /** The legend's or sheet's "unless noted otherwise": 1,086 ft, 90.6%. */
  note: false,
  /** The one type in the library at that thickness: none on the keyed sheets, so unmeasured. */
  thickness: false,
};

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

/** The type the whole-set run posts a group as, or null: the drawing's type, where its source passes `POSTS`. */
export function postedType(group: WallGroup): MatchableWallType | null {
  const found = typeSource(group);
  return found !== null && POSTS[found.source] ? found.type : null;
}

/** The code the review queue offers first for a group it did not post. */
export function suggestedCode(group: WallGroup): string | null {
  return typeSource(group)?.type.code ?? null;
}

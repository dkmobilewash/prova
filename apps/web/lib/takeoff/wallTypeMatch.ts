import type { TaggedFeet } from "./wallTags";

/**
 * THE LAST LINK BETWEEN A DETECTED WALL AND A PRICED LINE.
 *
 * Everything either side of this already existed. The finder returns groups by
 * thickness and `wallTags.ts` already reads the drawing's own labels and says
 * which runs carry which — so the app has known "this 4⅞″ group is tagged W1"
 * and shown it on screen, while the estimator picked the wall type by hand for
 * every group anyway. This closes it.
 *
 * ── WHY THE TAG AND NOT THE THICKNESS ──
 *
 * The obvious design is to match a detected thickness against the wall type's
 * thickness. It is not available and should not be invented: `WallType` has
 * `code`, `name`, `defaultHeightFt`, `sides` and `studSpacingIn` — NO thickness
 * — and deriving one from its components means parsing "⅝″ Type X" out of a
 * description, which is a guess wearing a measurement's clothes. Two types also
 * routinely share a thickness and differ in rating and layers, so thickness
 * cannot identify a type even in principle.
 *
 * The drawing already says which wall is which. `WallType.code` is the same
 * designation the drafter printed beside the wall. So this is an IDENTITY
 * match, not a similarity score, and that is the whole reason it can be trusted
 * enough to price from.
 *
 * ── IT REFUSES MORE THAN IT MATCHES, AND THAT IS THE DESIGN ──
 *
 * This produces a priced line on a GC-facing bid. So every outcome short of one
 * unambiguous tag naming one of the company's own types is a refusal that SAYS
 * WHAT IS MISSING, because the estimator can act on each of them differently:
 *
 *   NO_TAG       the drawing named nothing in this group. Pick a type by hand.
 *   NO_SUCH_TYPE the drawing says W1 and this company has no W1 with layers.
 *                That is the actionable one — the partition schedule on the
 *                sheet usually says what W1 is, and `SCHEDULE_ROWS` has already
 *                read it.
 *   MIXED        more than one name, with no clear majority. The group spans
 *                two types that share a thickness, and pricing it as either
 *                prices part of it wrong.
 *
 * Nothing here applies anything. It returns a proposal for one group, which the
 * person accepts with that group drawn on the sheet in front of them — the same
 * posture as the scale prefill and the sheet index.
 */

/** A wall type this company can actually post against: it has layers, so it
 *  produces line items. `postableWallTypes` on the takeoff page is already
 *  filtered to these. */
export type PostableWallType = {
  id: string;
  code: string;
  name: string;
};

export type WallTypeMatch =
  | { state: "MATCH"; type: PostableWallType; tag: string; feet: number; share: number }
  | { state: "NO_TAG" }
  | { state: "NO_SUCH_TYPE"; tag: string }
  | { state: "MIXED"; tags: string[] };

/**
 * How much of a group's TAGGED footage must carry one name before that name
 * identifies the group.
 *
 * Not 1.0, because a single run picking up a neighbouring room's tag should not
 * cost the estimator the whole group — `tagByRun` assigns by proximity and a
 * corner run genuinely sits near two labels. Not 0.5 either: a bare majority of
 * a group spanning two types still prices the minority wrong, and this writes
 * to a bid.
 *
 * 0.85 is the judgement, and the test beside it is what makes it a decision
 * rather than a number: a 50/50 group refuses, a 90/10 group matches, and the
 * 10% is named on screen so nobody is surprised by it later.
 */
export const TAG_MAJORITY = 0.85;

/** Compare a drawing's label with a company's code.
 *
 * Upper-cased with non-alphanumerics removed, so "W-1", "W 1" and "w1" are the
 * same designation — which they are on every drawing anybody has sent us. It
 * goes no further than that deliberately: stripping digits or collapsing
 * letters would make "W1" match "W11", and that is a different wall at a
 * different price. */
export function sameDesignation(a: string, b: string): boolean {
  const normal = (one: string) => one.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const left = normal(a);
  return left !== "" && left === normal(b);
}

export function matchClusterToWallType(
  tagged: readonly TaggedFeet[],
  wallTypes: readonly PostableWallType[],
): WallTypeMatch {
  // `one.feet > 0` is REDUNDANT against the total guard below, and kept:
  // mutation confirms removing it changes no answer, because a set of
  // zero-footage tags sums to zero and falls through there anyway. It stays
  // because it states the intent where the filter is read — a tag with no
  // length names nothing — rather than leaving that to arithmetic two lines
  // down. Noted so the next reader does not spend a mutation on it.
  const named = tagged.filter((one) => one.name.trim() !== "" && one.feet > 0);
  if (named.length === 0) return { state: "NO_TAG" };

  const total = named.reduce((sum, one) => sum + one.feet, 0);
  if (!(total > 0)) return { state: "NO_TAG" };

  // `taggedFeetForClusters` sorts by feet, so the first is the dominant name —
  // but this does not rely on that, because a caller assembling the list by
  // hand would then get a silently different answer.
  const leader = named.reduce((best, one) => (one.feet > best.feet ? one : best), named[0]);
  const share = leader.feet / total;
  if (share < TAG_MAJORITY) {
    return { state: "MIXED", tags: named.map((one) => one.name) };
  }

  const type = wallTypes.find((one) => sameDesignation(one.code, leader.name));
  if (!type) return { state: "NO_SUCH_TYPE", tag: leader.name };

  return { state: "MATCH", type, tag: leader.name, feet: leader.feet, share };
}

/**
 * What to put on the button and beside it.
 *
 * The sentence names the TYPE's own code and name rather than echoing the tag,
 * so an estimator can see the app matched the drawing to the right thing — "the
 * drawing says W1 and your W1 is ⅝″ Type X both sides" is checkable, and "W1
 * matched" is not.
 */
export function matchSentence(match: WallTypeMatch): string | null {
  switch (match.state) {
    case "MATCH": {
      const rest =
        match.share < 1
          ? ` ${Math.round(match.share * 100)}% of the tagged length here is ${match.tag}; the rest will be priced as it too.`
          : "";
      return `The drawing tags these ${match.tag}, which is your ${match.type.code} — ${match.type.name}.${rest}`;
    }
    case "NO_SUCH_TYPE":
      return (
        `The drawing tags these ${match.tag}, and you have no wall type ${match.tag} with layers on it. ` +
        `Add one on the Wall types page — this sheet's partition schedule usually says what ${match.tag} is — ` +
        `or add these as plain measurements and price them by hand.`
      );
    case "MIXED":
      return (
        `The drawing names more than one type in this group (${match.tags.join(", ")}), so it cannot be priced ` +
        `as one. Add them as plain measurements, or trace the types separately.`
      );
    case "NO_TAG":
      return null;
  }
}

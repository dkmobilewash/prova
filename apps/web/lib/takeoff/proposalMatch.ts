/**
 * ── WHICH TAKEOFF ITEM A DETECTED GROUP BELONGS TO ──
 *
 * The wall finder returns groups of runs, each with a thickness and sometimes
 * the tag the drawing printed beside them. This decides which of the job's
 * items each group is proposing into — so detection ADDS to a condition an
 * estimator named, instead of landing in a pile called "Add these".
 *
 * Pure, and the rules are in an order somebody will want to argue with, which
 * is why they are here rather than inside a query.
 */

export type MatchableItem = {
  id: string;
  name: string;
  thicknessIn: number | null;
  /** The code of the assembly this item is priced by, when it has one. */
  assemblyCode: string | null;
};

export type ProposalGroup = {
  /** The tag the drawing printed, when the finder read one. */
  namedCode: string | null;
  thicknessInches: number;
};

/**
 * How far apart two thicknesses may be and still be the same wall, in inches.
 *
 * ── AN EIGHTH, WHICH IS TIGHTER THAN THE SCHEDULE TEST ──
 *
 * `duplicateCoverage.ts` uses a half-inch band, but that is a COVERAGE test:
 * it asks whether two measurements describe the same piece of building, where
 * the two numbers come from different engines and are expected to disagree a
 * little. This is a direct comparison between a measured thickness and a
 * number somebody typed into an item, and 3⅝" and 4" are different walls that
 * a half-inch band would merge.
 */
export const THICKNESS_INCHES = 0.125;

const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The item this group belongs to, or null.
 *
 * ── THE ORDER IS THE POINT, AND IT RUNS STRONGEST FIRST ──
 *
 *  1. **The drawing's own tag equals an assembly's code.** The strongest
 *     signal there is: the architect wrote `W1` beside the wall and the
 *     estimator's library has a `W1`. Nothing a measurement says beats what
 *     the drawing says.
 *  2. **The tag equals an item's name.** Weaker only because an item's name is
 *     the estimator's own words rather than a code, and people write
 *     "6in partition" where the sheet says "W2".
 *  3. **The thickness matches**, within an eighth. The fallback, and the only
 *     rule that can fire on the majority of real sheets — none of the five
 *     real sets in this repo prints a wall tag on every run.
 *
 * A TIE IS A REFUSAL. When two items are the same thickness and nothing else
 * distinguishes them, this returns null and the group goes to Unassigned
 * rather than being given to whichever was created first. An estimator
 * sorting one pile is a minute's work; finding the wrong one of two 3⅝" walls
 * silently priced against the other is a bid.
 */
export function matchGroupToItem(
  group: ProposalGroup,
  items: readonly MatchableItem[],
): { itemId: string; by: "assembly-code" | "item-name" | "thickness" } | null {
  const tag = group.namedCode === null ? "" : normalise(group.namedCode);

  if (tag) {
    const byCode = items.filter((item) => item.assemblyCode && normalise(item.assemblyCode) === tag);
    if (byCode.length === 1) return { itemId: byCode[0].id, by: "assembly-code" };
    // Two items on the same assembly is ordinary — an estimator splits a wall
    // type by floor. The tag cannot choose between them, so fall through to
    // the thickness, which cannot either, and end at Unassigned.
    if (byCode.length === 0) {
      const byName = items.filter((item) => normalise(item.name) === tag);
      if (byName.length === 1) return { itemId: byName[0].id, by: "item-name" };
    }
  }

  const byThickness = items.filter(
    (item) =>
      item.thicknessIn !== null && Math.abs(item.thicknessIn - group.thicknessInches) <= THICKNESS_INCHES,
  );
  if (byThickness.length === 1) return { itemId: byThickness[0].id, by: "thickness" };

  return null;
}

/** Every group's destination, and a count of what could not be placed. */
export function matchGroups(
  groups: readonly ProposalGroup[],
  items: readonly MatchableItem[],
): { matched: Map<number, string>; unmatched: number } {
  const matched = new Map<number, string>();
  let unmatched = 0;
  groups.forEach((group, index) => {
    const hit = matchGroupToItem(group, items);
    if (hit) matched.set(index, hit.itemId);
    else unmatched += 1;
  });
  return { matched, unmatched };
}

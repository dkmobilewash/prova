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

import { toEighth } from "./wallVectors";

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
 * ── THERE IS NO TOLERANCE HERE ANY MORE, AND THAT IS THE POINT ──
 *
 * This was `THICKNESS_INCHES = 0.125`, a band either side of the measured
 * value. It was replaced by rounding both numbers to the nearest eighth — see
 * `toEighth` in `wallVectors.ts` — and the constant is gone rather than left
 * unused, because a named tolerance sitting in this file is an invitation to
 * reintroduce one.
 *
 * The band was not wrong about walls. It was wrong about the SCREEN: the panel
 * rounds to the eighth to draw its label, so a tolerance around the raw
 * measurement could match a condition whose label disagreed with the row the
 * estimator was looking at. Rounding first makes the comparison the one they
 * can see.
 *
 * `duplicateCoverage.ts` still uses a half-inch band and should: that asks
 * whether two measurements describe the same piece of building, where the
 * numbers come from different engines and are expected to disagree a little.
 * This asks whether a measured wall is the condition somebody typed in.
 */

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

  // ── THE SAME NUMBER THE PANEL SHOWS, NOT ONE NEAR IT ──
  //
  // This was `Math.abs(item.thicknessIn - group.thicknessInches) <= 1/8`, and
  // the band is not the problem — a measured 4.33333277" IS a 4-3/8" wall and
  // has to meet a condition typed as 4.375. The problem is that the panel
  // ROUNDS to the nearest eighth to draw its label, so a tolerance of an
  // eighth either side of the raw value can match a condition the label
  // disagrees with: the screen says 4-3/8", the match ran on 4.333, and
  // nothing on it explains why a 4-1/4" condition took the group.
  //
  // Rounding both to the eighth first makes the comparison the one an
  // estimator can see and check. It is not a looser test or a tighter one; it
  // is the same test performed on the numbers that are on the screen.
  const byThickness = items.filter(
    (item) => item.thicknessIn !== null && toEighth(item.thicknessIn) === toEighth(group.thicknessInches),
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

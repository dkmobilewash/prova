import type { WallCandidate, WallCluster } from "./wallVectors";

/**
 * ── WHAT THE DRAWING CALLS THE WALLS IT HAS ALREADY GROUPED BY THICKNESS ──
 *
 * The panel says "47 runs at 4-7/8in" today. An estimator then has to work out
 * which of their own assemblies a 4-7/8in wall is. The drawing already answers
 * that: every floor plan carries wall-type TAGS — `EXT-1`, `A1`, `B1` — placed
 * beside the walls they label. This attaches those names to the thickness
 * groups, so the panel can say "47 runs at 4-7/8in, tagged A1 and A2".
 *
 * ── WHAT WAS LOOKED FOR FIRST AND IS NOT THERE ──
 *
 * A partition schedule, naming each type and its thickness. **This set has
 * none** — checked rather than assumed: its A-601 sheets are a DOOR SCHEDULE
 * and a WINDOW SCHEDULE, and **zero thickness strings appear on any page** of
 * the document. There is no list of valid thicknesses to snap to.
 *
 * ── AND THE BIGGER VERSION THAT WAS BUILT, MEASURED, AND CUT ──
 *
 * The ambition was to group walls BY TAG instead of by thickness, giving each
 * run its assembly directly. The pairing works — measured on two pages, every
 * tag sits 0.5-2.2 ft from its run with the runner-up past 4, and **zero tags
 * are orphaned**:
 *
 *   | page | tags | runs | cleanly paired | ambiguous | orphaned |
 *   | --- | --- | --- | --- | --- | --- |
 *   | 1 | 41 | 202 | 31 | 10 | **0** |
 *   | 28 | 30 | 151 | 26 | 4 | **0** |
 *
 * It still does not work as a grouping, and the reason is a drawing convention
 * rather than a bug: **an architect tags representative walls, not every wall.**
 * 41 tags against 202 detected runs, so tagging claimed only 25-43% of the
 * footage per page:
 *
 *   | page | tagged | untagged |
 *   | --- | --- | --- |
 *   | 1 | 539 ft (27%) | 1,423 ft in 171 runs |
 *   | 28 | 698 ft (43%) | 933 ft |
 *   | 41 | 524 ft (26%) | 1,509 ft |
 *
 * Two ways to propagate a tag to its neighbours were considered and both fail.
 * **By thickness**: `A1` and `A2` both measure 4.75in, so it would merge two
 * different assemblies. **By collinearity**: `mergeWalls` already joins
 * collinear runs, so the 202 are genuinely distinct walls with nothing to
 * propagate along.
 *
 * So the tags are used for what they can carry — a NAME on a group somebody is
 * already deciding about — and not for a per-wall assignment the drawing does
 * not contain. Recorded at this length because the measurement is the useful
 * part: the next person to have this idea can read why it shrank instead of
 * re-running it.
 *
 * ── ONE MORE THING THE NUMBERS SAID, WHICH IS WORTH MORE THAN THE FEATURE ──
 *
 * `A1` measured 4.75, 4.75, 4.75 and 5.00 inches across four pages. The tags
 * are independent of the geometry, so that is the drawing CONFIRMING the
 * thickness measurement for the dominant partition. The low-count tags do not
 * confirm anything — `EXT-1` read 6.75, 10.25 and 6.00 on three pages off two
 * runs each — which is why a name is offered as a name and never as a
 * thickness.
 */

/**
 * A wall-type tag as architects write one: `EXT-1`, `EXT 2`, `A1`, `C1A`.
 *
 * Anchored at both ends, so a tag is the WHOLE of its text item and never a
 * fragment of a sentence. The leading letters are limited to the ones that name
 * a partition — a bare number is a room or door number, and a single letter is
 * a column grid bubble.
 */
const TYPE_TAG = /^(EXT|INT|P|A|B|C|D)[-\s]?\d{1,2}[A-Z]?$/i;

/** How far a tag may sit from a run and still be labelling it, in FEET of
 *  building. A tag is set just off the wall it names; measured, the real ones
 *  land at 0.5-2.2 ft and the runner-up is typically past 4. */
export const TAG_REACH_FEET = 4;

/**
 * How much nearer the winning run must be than the next, as a multiple.
 *
 * Below this the pairing is a coin flip — two faces of one wall, or two walls
 * meeting at a corner — and the tag is DROPPED rather than guessed. On the
 * measured pages that is 24% of tags. Dropping them is the point: a group
 * labelled with the wrong assembly name is worse than one with no name, because
 * a name is what the estimator will map to their catalogue.
 */
export const TAG_CLEAR_MARGIN = 2;

export type WallTypeTag = {
  /** As printed, upper-cased: `EXT-1`. */
  name: string;
  /** Centre of the text, in page-width units. */
  x: number;
  y: number;
};

/** Text items as the page reports them, in POINTS. */
export type PageTextItem = { str: string; x: number; y: number; width: number; height: number };

/**
 * The wall-type tags on a sheet, in page-width units.
 *
 * Deliberately NOT filtered by how often a name repeats. A filter like "a real
 * type labels more than one wall" would be right about this set and wrong about
 * a sheet with one of something, and a stray name on a group is visible to the
 * person reading it in a way a silently dropped one is not.
 */
export function wallTypeTags(items: readonly PageTextItem[], widthPt: number): WallTypeTag[] {
  if (!(widthPt > 0)) return [];
  const out: WallTypeTag[] = [];
  for (const item of items) {
    const name = item.str.trim();
    if (!TYPE_TAG.test(name)) continue;
    out.push({
      name: name.toUpperCase(),
      x: (item.x + item.width / 2) / widthPt,
      y: (item.y + item.height / 2) / widthPt,
    });
  }
  return out;
}

/** Feet from a point to a RUN, measured to the nearest point on the segment
 *  rather than its midpoint — a tag beside a long wall is near the wall, not
 *  near its centre, and using the midpoint would orphan every long run. */
function distanceFeet(px: number, py: number, wall: WallCandidate, feetPerUnit: number): number {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - wall.x1) * dx + (py - wall.y1) * dy) / len2));
  return Math.hypot(px - (wall.x1 + t * dx), py - (wall.y1 + t * dy)) * feetPerUnit;
}

/**
 * Which run each tag labels, as a map from run to tag name.
 *
 * A tag claims its nearest run, and only when that run is clearly nearer than
 * the next — see `TAG_CLEAR_MARGIN`. A run is claimed at most once; where two
 * tags reach the same run, the nearer tag keeps it and the other is dropped.
 *
 * Exported for the test, and because the pairing is the measured part of this
 * module while the grouping below is a presentation decision.
 */
export function tagByRun(
  walls: readonly WallCandidate[],
  tags: readonly WallTypeTag[],
  feetPerUnit: number,
): Map<WallCandidate, string> {
  const out = new Map<WallCandidate, string>();
  if (!(feetPerUnit > 0) || walls.length === 0 || tags.length === 0) return out;

  // Every tag's best claim first, so the NEAREST tag wins a contested run
  // rather than whichever happened to come first in the page's text order.
  const claims: { name: string; wall: WallCandidate; feet: number }[] = [];
  for (const tag of tags) {
    let best = Infinity;
    let second = Infinity;
    let bestWall: WallCandidate | null = null;
    for (const wall of walls) {
      const d = distanceFeet(tag.x, tag.y, wall, feetPerUnit);
      if (d < best) {
        second = best;
        best = d;
        bestWall = wall;
      } else if (d < second) {
        second = d;
      }
    }
    if (bestWall === null || best > TAG_REACH_FEET || second < best * TAG_CLEAR_MARGIN) continue;
    claims.push({ name: tag.name, wall: bestWall, feet: best });
  }

  claims.sort((a, b) => a.feet - b.feet);
  for (const claim of claims) {
    if (out.has(claim.wall)) continue;
    out.set(claim.wall, claim.name);
  }
  return out;
}

/**
 * The assembly names the drawing uses for each thickness group, in the same
 * order as the groups.
 *
 * Names are ordered by how much of the group's TAGGED footage carries each one,
 * so the dominant assembly reads first. A group whose runs carry no tag gets an
 * empty list, which is the common case and the reason the caller must treat an
 * empty list as "the drawing did not say" rather than as an error — only 25-43%
 * of footage is tagged at all.
 */
export function namesForClusters(
  clusters: readonly WallCluster[],
  walls: readonly WallCandidate[],
  tags: readonly WallTypeTag[],
  feetPerUnit: number,
): string[][] {
  const byRun = tagByRun(walls, tags, feetPerUnit);
  if (byRun.size === 0) return clusters.map(() => []);
  return clusters.map((cluster) => {
    const feetByName = new Map<string, number>();
    for (const run of cluster.runs) {
      const name = byRun.get(run);
      if (name === undefined) continue;
      feetByName.set(name, (feetByName.get(name) ?? 0) + run.lengthFeet);
    }
    return [...feetByName.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  });
}

/**
 * The sentence for a group, or null when the drawing named nothing in it.
 *
 * Null rather than a hedge, because a group with no tagged run is the ordinary
 * case and a reassuring phrase on every one of them would make the real names
 * harder to notice.
 */
export function tagSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The drawing tags ${names.length === 1 ? "this" : "these"} ${list}.`;
}

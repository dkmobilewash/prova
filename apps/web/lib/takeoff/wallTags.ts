import type { WallCandidate, WallCluster } from "./wallVectors";
import { sameDesignation, type MatchableWallType } from "./wallTypeMatch";
import { THICKNESS_SLACK_IN } from "./wallGroups";

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

/** The nearest run to a tag and the runner-up's distance, which is what the
 *  clear-margin test needs. Returns `wall: null` for an empty field. */
function nearest(
  tag: WallTypeTag,
  walls: readonly WallCandidate[],
  feetPerUnit: number,
): { wall: WallCandidate | null; best: number; second: number } {
  let best = Infinity;
  let second = Infinity;
  let wall: WallCandidate | null = null;
  for (const one of walls) {
    const d = distanceFeet(tag.x, tag.y, one, feetPerUnit);
    if (d < best) {
      second = best;
      best = d;
      wall = one;
    } else if (d < second) {
      second = d;
    }
  }
  return { wall, best, second };
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
  wallTypes: readonly MatchableWallType[] = [],
): Map<WallCandidate, string> {
  const out = new Map<WallCandidate, string>();
  if (!(feetPerUnit > 0) || walls.length === 0 || tags.length === 0) return out;

  /**
   * ── THE TAG'S OWN NAME IS EVIDENCE ABOUT WHICH RUN IT MEANS ──
   *
   * Proximity alone picks the wrong wall where two run side by side, and
   * School-01's A-101 has three such cases, measured rather than argued:
   *
   *   EXT-1 at (0.805,0.282) — 4-7/8" at 0.47 ft WON; 8-7/8" at 2.32 ft lost
   *   B1    at (0.641,0.203) — 6-3/4"  at 1.21 ft WON; 7-1/4" at 5.84 ft lost
   *   B1    at (0.656,0.196) — 7-1/4"  at 1.71 ft was NEAREST and was DROPPED,
   *                            because 6-3/4" at 3.34 ft failed the clear margin
   *
   * In all three the company HAS a wall type of that exact name, with a
   * thickness, and exactly one candidate matches it. The drawing is not being
   * ambiguous; the reader was throwing away the half of the evidence that
   * settles it.
   *
   * SO THE NAME NARROWS THE FIELD FIRST, and distance decides among what is
   * left. Where no candidate fits the named type — which is every EXT tag on
   * the long perimeter runs, because the plan draws 6-5/8" of framing and the
   * schedule totals 8-7/8" with sheathing and cladding — this changes nothing
   * and the old rule stands. That disagreement is real and must keep reaching
   * the screen rather than being tidied away by a better guess.
   *
   * IT NARROWS, IT NEVER REACHES. A fitting run still has to be within
   * `TAG_REACH_FEET` and still has to beat its rivals by `TAG_CLEAR_MARGIN` —
   * measured against the other FITTING runs, since a non-fitting neighbour is
   * no longer a rival for a tag whose name rules it out.
   */
  const named = (name: string): MatchableWallType | null =>
    wallTypes.find((type) => type.thicknessIn !== null && sameDesignation(type.code, name)) ?? null;

  const claims: { name: string; wall: WallCandidate; feet: number }[] = [];
  for (const tag of tags) {
    const type = named(tag.name);
    const inches = type?.thicknessIn ?? null;
    // The runs this tag is allowed to claim: the ones its name fits, when the
    // name resolves to a thickness and anything fits it at all. Otherwise all
    // of them, which is the behaviour this function has always had.
    const fitting =
      inches === null
        ? []
        : walls.filter((wall) => Math.abs(wall.thicknessFeet * 12 - inches) <= THICKNESS_SLACK_IN);

    // WITHIN REACH, NOT ANYWHERE ON THE SHEET — and the first draft of this got
    // it wrong in a way its own probe caught. Asking "does a fitting run exist"
    // globally dropped four tags that were right: the perimeter EXT tags, whose
    // nearest 8-7/8" run is most of a building away, fell back to nothing
    // instead of to the 6-5/8" run beside them. That silently deleted the
    // drawing-vs-schedule disagreement this change exists to preserve.
    const fromFitting = nearest(tag, fitting, feetPerUnit);
    const chosen =
      fromFitting.wall !== null && fromFitting.best <= TAG_REACH_FEET
        ? fromFitting
        : nearest(tag, walls, feetPerUnit);

    const { best, second, wall: bestWall } = chosen;
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
/** A name the drawing put on part of a group, with how much of it carries that
 *  name. The FEET are what makes a match decidable: "mostly W1" and "half W1,
 *  half W2" look identical as a list of names and must not be treated alike,
 *  because pricing the second as W1 prices half the group wrong. */
export type TaggedFeet = { name: string; feet: number };

/**
 * Per group, what the drawing named in it and how many feet carry each name.
 *
 * `namesForClusters` is derived from this rather than computing its own, which
 * is deliberate: two functions walking the same runs would be the second list
 * CLAUDE.md warns about, and the one that drifted would be the one nobody was
 * reading.
 */
export function taggedFeetForClusters(
  clusters: readonly WallCluster[],
  walls: readonly WallCandidate[],
  tags: readonly WallTypeTag[],
  feetPerUnit: number,
): TaggedFeet[][] {
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
      .map(([name, feet]) => ({ name, feet }));
  });
}

export function namesForClusters(
  clusters: readonly WallCluster[],
  walls: readonly WallCandidate[],
  tags: readonly WallTypeTag[],
  feetPerUnit: number,
): string[][] {
  return taggedFeetForClusters(clusters, walls, tags, feetPerUnit).map((tagged) =>
    tagged.map((one) => one.name),
  );
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

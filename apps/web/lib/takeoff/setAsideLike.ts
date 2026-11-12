import { runAt, wallsLikeThese, type Line } from "./userExclusions";
import type { WallGroup } from "./wallGroups";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── "SET ASIDE ALL WALLS DRAWN LIKE THIS ONE", FROM THE REVIEW QUEUE ──
 *
 * A renovation sheet cannot be cleaned automatically: no rule tells an existing wall from a new
 * one on an unseen sheet (NOTES.md, 2026-10-30). The person can, at a glance — the drafter drew
 * the two differently. So the queue offers one step: pick one existing wall, see how many walls
 * and feet on the sheet are drawn the same way (`wallsLikeThese`, the rule the server applies to
 * an EXCLUDE_LIKE exclusion), Enter sets them aside, one Undo puts them back.
 *
 * These run on the groups ON SCREEN, so they work whether the sheet's walls came from Find in this
 * browser or from the ones stored with its scale (Run takeoff) — the existing tool needed the
 * former and said "Find the walls first" after a Run takeoff.
 */

/** The run under a click, among the groups on screen. */
export function pickedRun(groups: readonly WallGroup[], at: { x: number; y: number }, feetPerUnit: number): WallCandidate | null {
  const runs = groups.flatMap((g) => g.runs);
  const reach = 0.5 / feetPerUnit;
  return (
    runAt({ x1: at.x - reach, y1: at.y, x2: at.x + reach, y2: at.y }, runs, feetPerUnit) ??
    runAt({ x1: at.x, y1: at.y - reach, x2: at.x, y2: at.y + reach }, runs, feetPerUnit)
  );
}

/** Every run on screen drawn like `picked`, with the count and feet the preview says. */
export function likeOnSheet(input: {
  groups: readonly WallGroup[];
  picked: Line;
  /** The page's strokes in page-width units, as the walls are. */
  segments: readonly StrokeSegment[];
  feetPerUnit: number;
}): { runs: Set<WallCandidate>; n: number; feet: number } {
  const runs = input.groups.flatMap((g) => g.runs);
  const { excluded } = wallsLikeThese([input.picked], runs, input.segments, input.feetPerUnit);
  let feet = 0;
  for (const r of excluded) feet += r.lengthFeet;
  return { runs: excluded, n: excluded.size, feet };
}

/** The groups without those runs, each total recomputed; a group left empty goes. */
export function withoutRuns(groups: readonly WallGroup[], gone: ReadonlySet<WallCandidate>): WallGroup[] {
  return groups
    .map((g) => {
      const runs = g.runs.filter((r) => !gone.has(r));
      return runs.length === g.runs.length ? g : { ...g, runs, feet: runs.reduce((n, r) => n + r.lengthFeet, 0) };
    })
    .filter((g) => g.runs.length > 0);
}

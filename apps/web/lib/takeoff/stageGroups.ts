import { clusterByThickness, type StrokeSegment, type WallCandidate } from "./wallVectors";
import type { FoundOnSheet } from "./findWallsOnSheet";
import { planTextTagByRun } from "./planTextTags";
import { tagByRun, wallTypeTags, type PageTextItem } from "./wallTags";
import { defaultWallTypeFromNotes } from "./wallNotes";
import { wallGroups, type WallGroup } from "./wallGroups";
import type { MatchableWallType } from "./wallTypeMatch";

/**
 * ── THE WHOLE-SET RUN'S GROUPS, BUILT BESIDE THE FINDER RATHER THAN INSIDE IT ──
 *
 * Diego's call (2026-10-29): the WALLS stage does not pass wall-type
 * thicknesses to the finder, so a takeoff is identical with or without wall
 * types. The finder reads every typed thickness as a scheduled one to pair
 * by (`findWallsOnSheet` → `wallVectors.ts`), and measured on Joplin A-101
 * that moved 145 ft of real wall off the count. So the stage hands the
 * finder types WITHOUT thickness — and that breaks the finder's own
 * grouping, which needs them: a type with no thickness is "offered" for
 * every bucket, so the legend's U.N.O. default would cover the whole sheet.
 *
 * This rebuilds the groups the way the finder's `regroup` does — the same
 * clusters, the same tag map, the same note — with the thick types. It
 * decides only which NAME each of the finder's runs sits under; the runs
 * and their feet are the finder's, unchanged.
 *
 * ── AND A HATCHED BAND NEVER TAKES A DRYWALL DEFAULT ──
 *
 * Joplin's masonry walls are cross-hatched between their faces and were
 * read at 4.3–5.0 in, which is the drywall default's thickness, so "all
 * interior drywall partitions are type A" typed them A. A run with hatch
 * strokes across its band is a filled wall: it takes a default only if the
 * default's own sentence says masonry, and otherwise stays untyped.
 */
/**
 * Hatch is OBLIQUE: the strokes cross the band at 25–65°. A door's jambs,
 * a wall's end caps and a dimension's witness lines cross it square on,
 * and the first cut (anything over 20° off the run's axis, three per wall)
 * called 150 of Joplin's 190 runs hatched — every partition with two doors
 * in it. Masonry hatch is dense as well: a stroke a foot at least.
 */
export const HATCH_MIN_DEGREES = 25;
export const HATCH_MAX_DEGREES = 65;
/** Cross strokes per foot of run that make a band hatched, and the floor on the count. */
export const HATCH_PER_FOOT = 1;
export const HATCH_MIN_STROKES = 4;

/** The runs whose band holds hatch strokes: short strokes across the run, both ends inside it. */
export function hatchedRuns(walls: readonly WallCandidate[], strokes: readonly StrokeSegment[], feetPerUnit: number): Set<WallCandidate> {
  const out = new Set<WallCandidate>();
  if (!(feetPerUnit > 0)) return out;
  const steepest = Math.cos((HATCH_MAX_DEGREES * Math.PI) / 180), shallowest = Math.cos((HATCH_MIN_DEGREES * Math.PI) / 180);
  const slack = 1 / 12 / feetPerUnit;
  for (const w of walls) {
    if (w.curved) continue;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len, uy = dy / len;
    const half = Math.max(w.thicknessFeet / 2 / feetPerUnit, slack) + slack;
    const inside = (x: number, y: number) => {
      const px = x - w.x1, py = y - w.y1;
      const along = px * ux + py * uy, across = Math.abs(px * -uy + py * ux);
      return along >= -slack && along <= len + slack && across <= half;
    };
    let count = 0;
    for (const s of strokes) {
      if (s.curved) continue;
      const sx = s.x2 - s.x1, sy = s.y2 - s.y1, sl = Math.hypot(sx, sy);
      if (sl === 0 || sl > 4 * half) continue;
      const cos = Math.abs((sx * ux + sy * uy) / sl);
      if (cos > shallowest || cos < steepest) continue;
      if (inside(s.x1, s.y1) && inside(s.x2, s.y2)) count += 1;
    }
    if (count >= Math.max(HATCH_MIN_STROKES, HATCH_PER_FOOT * w.lengthFeet)) out.add(w);
  }
  return out;
}

export function groupsForStage(input: {
  found: FoundOnSheet;
  /** The sheet's strokes in POINTS, for the symbol pass. */
  segmentsPt: readonly StrokeSegment[];
  textItems: readonly PageTextItem[];
  widthPt: number;
  feetPerUnit: number;
  /** The company's types WITH their thicknesses — the grouping wants them; the finder was not given them. */
  wallTypes: readonly MatchableWallType[];
  /** The vocabulary the plan-text pass filters by, or null when the switch is off. */
  legendCodes: readonly string[] | null;
}): { groups: WallGroup[]; hatched: Set<WallCandidate> } {
  const { found, segmentsPt, textItems, widthPt, feetPerUnit, wallTypes, legendCodes } = input;
  const tags = wallTypeTags(textItems, widthPt);
  const fromNote = defaultWallTypeFromNotes(textItems, wallTypes);
  const byRun =
    legendCodes === null
      ? tagByRun(found.walls, tags, feetPerUnit, wallTypes)
      : planTextTagByRun({ segments: segmentsPt, text: textItems, widthPt, walls: found.walls, feetPerUnit, legendCodes, textTags: tags, wallTypes }).byRun;
  const hatched = hatchedRuns(found.walls, found.inUnits, feetPerUnit);
  return { groups: wallGroups(clusterByThickness(found.walls), byRun, wallTypes, fromNote, hatched), hatched };
}

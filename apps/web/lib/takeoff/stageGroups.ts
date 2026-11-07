import { clusterByThickness, segmentGeometry, type StrokeSegment, type WallCandidate } from "./wallVectors";
import type { FoundOnSheet } from "./findWallsOnSheet";
import { planTextTagByRun, siblingTag } from "./planTextTags";
import { MIN_VOTES } from "./planCompare";
import { alignViews, longFaces } from "./viewAlign";
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
/**
 * ── HATCH IS ONE OR TWO FAMILIES OF LINES, ALL ALONG THE WALL ──
 *
 * Round 12's key called every hatched run on Joplin A-101 drywall, and the
 * crops agree: the oblique strokes were dimension ticks (slashes where a
 * dimension string meets the wall), the little crosses marking plumbing
 * fixtures along a wet wall, and pipe fittings — 117 ft of partition typed B
 * by "all interior masonry partitions". Those strokes run every which way and
 * bunch where the dimensions land.
 *
 * A drafted hatch is one angle repeated, or two crossed (Bunkie's
 * cross-hatched masonry), and it fills the band end to end. So the two
 * commonest angle families (`HATCH_FAMILY_DEGREES` wide) must hold this share
 * of the strokes, and the strokes must fall in `HATCH_COVER` of the run's
 * one-foot lengths. Bunkie's: 92-100% and 75-100%. Joplin's ticks and
 * fittings: 38-84% and 6-69%.
 */
export const HATCH_FAMILY_SHARE = 0.8;
export const HATCH_COVER = 0.7;
export const HATCH_FAMILY_DEGREES = 5;

/** The runs whose band holds hatch strokes: short strokes across the run, both ends inside it. */
export function hatchedRuns(walls: readonly WallCandidate[], strokes: readonly StrokeSegment[], feetPerUnit: number): Set<WallCandidate> {
  const out = new Set<WallCandidate>();
  if (!(feetPerUnit > 0)) return out;
  const steepest = Math.cos((HATCH_MAX_DEGREES * Math.PI) / 180), shallowest = Math.cos((HATCH_MIN_DEGREES * Math.PI) / 180);
  const slack = 1 / 12 / feetPerUnit;
  const geometry = segmentGeometry(strokes);
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
    // The band's bounding box: a stroke `inside` must have both ends in it, so
    // one end outside is refused before the rotated test — never a different answer.
    const cx = [-slack, len + slack].flatMap((a) => [-half, half].map((c) => w.x1 + a * ux - c * uy));
    const cy = [-slack, len + slack].flatMap((a) => [-half, half].map((c) => w.y1 + a * uy + c * ux));
    // A hair wider than the band, so rounding at its edge can only let a stroke through to the exact test.
    const eps = 1e-9;
    const minX = Math.min(...cx) - eps, maxX = Math.max(...cx) + eps, minY = Math.min(...cy) - eps, maxY = Math.max(...cy) + eps;
    const inBox = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
    const angles: number[] = [], along: number[] = [];
    for (let k = 0; k < strokes.length; k += 1) {
      const s = strokes[k];
      if (s.curved) continue;
      const sl = geometry.length[k];
      if (sl === 0 || sl > 4 * half) continue;
      if (!inBox(s.x1, s.y1) || !inBox(s.x2, s.y2)) continue;
      const sx = s.x2 - s.x1, sy = s.y2 - s.y1;
      const cos = Math.abs((sx * ux + sy * uy) / sl);
      if (cos > shallowest || cos < steepest) continue;
      // Direction without sense, 0–180°.
      if (!inside(s.x1, s.y1) || !inside(s.x2, s.y2)) continue;
      // Direction without sense, 0–180°, and how far along the run.
      angles.push((((Math.atan2(sy, sx) * 180) / Math.PI) % 180 + 180) % 180);
      along.push(((s.x1 + s.x2) / 2 - w.x1) * ux + ((s.y1 + s.y2) / 2 - w.y1) * uy);
    }
    if (angles.length < Math.max(HATCH_MIN_STROKES, HATCH_PER_FOOT * w.lengthFeet)) continue;
    const near = (a: number, b: number) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)) <= HATCH_FAMILY_DEGREES;
    const commonest = (pool: number[]) => pool.reduce((best, a) => { const n = pool.filter((b) => near(a, b)).length; return n > best.n ? { n, at: a } : best; }, { n: 0, at: 0 });
    const first = commonest(angles);
    const second = commonest(angles.filter((a) => !near(a, first.at)));
    if (first.n + second.n < HATCH_FAMILY_SHARE * angles.length) continue;
    const feet = Math.max(1, Math.round(w.lengthFeet));
    const filled = new Set(along.map((p) => Math.min(feet - 1, Math.max(0, Math.floor((p / len) * feet))))).size;
    if (filled >= HATCH_COVER * feet) out.add(w);
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
  /** Another sheet of the same floor at the same size, read for tags when this one prints none. */
  sibling?: SiblingSheet | null;
}): { groups: WallGroup[]; hatched: Set<WallCandidate> } {
  const { found, segmentsPt, textItems, widthPt, feetPerUnit, wallTypes, legendCodes } = input;
  const tags = wallTypeTags(textItems, widthPt);
  const fromNote = defaultWallTypeFromNotes(textItems, wallTypes);
  const own =
    legendCodes === null
      ? { byRun: tagByRun(found.walls, tags, feetPerUnit, wallTypes), wallTypes: [...wallTypes] }
      : planTextTagByRun({ segments: segmentsPt, text: textItems, widthPt, walls: found.walls, feetPerUnit, legendCodes, textTags: tags, wallTypes });
  const fromSibling = own.byRun.size === 0 && legendCodes !== null && input.sibling ? tagsFromSibling({ ...input, sibling: input.sibling, legendCodes }) : null;
  const read = fromSibling ?? own;
  const hatched = hatchedRuns(found.walls, found.inUnits, feetPerUnit);
  // The types with the plan's tag variants (C6 of family C), so a variant tag names a type.
  return { groups: wallGroups(clusterByThickness(found.walls), read.byRun, read.wallTypes, fromNote, hatched), hatched };
}

export type SiblingSheet = { segmentsPt: readonly StrokeSegment[]; textItems: readonly PageTextItem[]; widthPt: number };

/**
 * ── A FLOOR PLAN WITH NO WALL TAGS, READ FROM THE SHEET OF THE SAME FLOOR THAT HAS THEM ──
 *
 * Green Bay's A3.1 (floor plan) prints keynote diamonds, door and room tags and
 * not one wall tag; its A3.2 (dimension plan) tags every partition IW-1…IW-9.
 * The two draw the same building on the same paper, so this sheet's walls are
 * moved onto the other by the views' own alignment (`alignViews`, the plan
 * comparison's) and the tag reader runs THERE, with the other sheet's symbols
 * and callouts. Every type it gives is marked (`siblingTag`): read elsewhere,
 * never printed here. Nothing when the paper differs or the views do not line
 * up by `MIN_VOTES` walls.
 */
export function tagsFromSibling(input: {
  found: FoundOnSheet;
  segmentsPt: readonly StrokeSegment[];
  widthPt: number;
  feetPerUnit: number;
  wallTypes: readonly MatchableWallType[];
  legendCodes: readonly string[];
  sibling: SiblingSheet;
}): { byRun: Map<WallCandidate, string>; wallTypes: MatchableWallType[] } | null {
  const { found, segmentsPt, widthPt, feetPerUnit, wallTypes, legendCodes, sibling } = input;
  if (Math.abs(sibling.widthPt / widthPt - 1) > 0.01) return null;
  const shift = alignViews(longFaces(segmentsPt, widthPt, feetPerUnit), longFaces(sibling.segmentsPt, sibling.widthPt, feetPerUnit), feetPerUnit);
  if (shift === null || shift.votes < MIN_VOTES) return null;
  // `shift` moves the other sheet onto this one; this sheet's walls go the other way.
  const moved = found.walls.map((w) => ({ ...w, x1: w.x1 - shift.dx, y1: w.y1 - shift.dy, x2: w.x2 - shift.dx, y2: w.y2 - shift.dy }));
  const read = planTextTagByRun({ segments: sibling.segmentsPt, text: sibling.textItems, widthPt, walls: moved, feetPerUnit, legendCodes, textTags: wallTypeTags(sibling.textItems, widthPt), wallTypes });
  const byRun = new Map<WallCandidate, string>();
  moved.forEach((w, i) => {
    const tag = read.byRun.get(w);
    if (tag !== undefined) byRun.set(found.walls[i]!, siblingTag(tag));
  });
  return byRun.size === 0 ? null : { byRun, wallTypes: read.wallTypes };
}

/**
 * The other sheets of this floor, by sheet number: A3.1's are A3.2, A3.3 — the
 * same number up to its last point. A demolition plan is not one (its tags are
 * the old building's). The views' alignment still decides; this only says
 * where to look.
 */
export function siblingPages(sheets: readonly { pageNumber: number; sheetNumber: string | null; title: string | null }[], pageNumber: number): number[] {
  const stem = (n: string | null) => (n === null || !/\.\d+$/.test(n.trim()) ? null : n.trim().toUpperCase().replace(/\.\d+$/, ""));
  const mine = stem(sheets.find((s) => s.pageNumber === pageNumber)?.sheetNumber ?? null);
  if (mine === null) return [];
  return sheets.filter((s) => s.pageNumber !== pageNumber && stem(s.sheetNumber) === mine && !/\bDEMO/i.test(s.title ?? "")).map((s) => s.pageNumber);
}

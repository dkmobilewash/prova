import { DOOR_TAG_REACH_FEET, exteriorWalls, WINDOW_TAG_REACH_FEET, type DoorArcCandidate, type DoorSymbol, type WindowSymbol } from "./doorWindowSymbols";
import type { KeyPoint } from "./heldOutScore";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── ONE ROW OF SIGNALS PER FOUND DOOR AND PER FOUND WINDOW: WHAT THE LEARNED SCORERS READ ──
 *
 * METHOD v2 (AUTOMATION-PLAN.md, 2026-11-13), for openings: the finder's doors (every swing
 * `doorSymbols` keeps, before `onlyMarkedDoors`) and windows (every frame `windowSymbols` keeps,
 * plus a tag the product placed with no frame) each become a row, and a small model decides
 * real or false. The second's `wallRunFeatures.ts` is the pattern: the same function feeds the
 * eval's table and, later, the product, so a model is scored on what the app will hand it.
 *
 * Units: page-width units throughout (the finder's `inUnits`), `feetPerUnit` to feet.
 * No set or sheet identity is a column: only what the drawing says.
 */

type Pt = { x: number; y: number };
type Line = { x1: number; y1: number; x2: number; y2: number };
/** A symbol's text and centre, page-width units (`tagSymbols` output divided by the page width). */
export type PlacedText = { text: string; x: number; y: number };

/** Columns, in order. Bump `DOOR_FEATURES_VERSION` when this list changes. */
export const DOOR_FEATURE_NAMES = [
  "widthFeet", "leaves", "sweepDegrees", "fitWorst", "arcPoints", "standardWidthOff",
  "onWall", "wallThicknessIn", "wallExterior", "wallLinesAcross",
  "markFeet", "marked", "markNumeric",
  "sheetDoors", "sheetMarkedShare", "droppedByMarkedShare",
  "arcsNear3", "segmentsInSwing", "wordsNear6", "roomWordNear10", "existWordNear10",
  "renovation", "feetPerPoint",
] as const;
export const DOOR_FEATURES_VERSION = 1;

export const WINDOW_FEATURE_NAMES = [
  "hasFrame", "widthFeet", "frameLines", "glassLines",
  "onWall", "wallThicknessIn", "wallExterior", "widthOverThickness",
  "tagFeet", "tagged", "tagIsW", "countedByTag", "sheetEveryWindowTagged", "scheduleInSet",
  "sheetWindows", "windowsNear4", "doorFeet", "existWordNear10",
  "renovation", "feetPerPoint",
] as const;
export const WINDOW_FEATURES_VERSION = 1;

/** Room names as plans print them: a door beside one is a doorway into a room. */
const ROOM_WORDS = /\b(OFFICE|TOILET|RESTROOM|R\.?R\.?|WOMEN|MEN|CLOSET|CLO|STOR(AGE)?|JAN(ITOR)?|CORR(IDOR)?|LOBBY|CONF(ERENCE)?|BREAK|KITCHEN|MECH|ELEC|ROOM|BEDROOM|BATH|VEST(IBULE)?|EXAM|LAB|CLASS(ROOM)?|STAIR|ENTRY|DINING|LOUNGE|SUITE|WORK)\b/i;
const EXIST_WORDS = /\bN\.?\s?I\.?\s?C\b|NOT IN CONTRACT|\bEXIST|\(E\)|TO REMAIN/i;
/** Door leaf widths a schedule prints, feet (2'-0" to 4'-0", and pairs). */
const STANDARD_WIDTHS = [2, 2.333, 2.5, 2.667, 2.833, 3, 3.333, 3.5, 4, 5, 6, 7, 8];
const CAP_FEET = 30;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (l: Line): Pt => ({ x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 });

function toSegment(p: Pt, l: Line): number {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const n = dx * dx + dy * dy;
  const t = n === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / n));
  return Math.hypot(p.x - (l.x1 + t * dx), p.y - (l.y1 + t * dy));
}

function insidePolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function nearestFeet(p: Pt, points: readonly Pt[], feetPerUnit: number): number {
  let best = Infinity;
  for (const q of points) best = Math.min(best, dist(p, q));
  return Math.min(CAP_FEET, best * feetPerUnit);
}

/**
 * Each door's swing as polygons (hinge, then the arc), one per leaf: what a reviewer's click
 * anywhere in the quarter circle lands inside. The leaf candidate is found again by its hinge.
 */
export function doorSwings(doors: readonly DoorSymbol[], arcs: readonly DoorArcCandidate[], feetPerUnit: number): { arc: DoorArcCandidate | null; polygons: Pt[][] }[] {
  const same = 0.3 / feetPerUnit;
  const leaves = arcs.filter((a) => a.door !== null);
  const leafAt = (hinge: Pt) => leaves.find((a) => dist(a.door!.hinge, hinge) <= same) ?? null;
  return doors.map((d) => {
    const first = leafAt(d.hinge);
    const second = d.leaves === 2 ? leafAt(d.strike) : null;
    const polygons = [first, second].filter((a): a is DoorArcCandidate => a !== null).map((a) => [a.door!.hinge, ...a.chain]);
    if (polygons.length === 0) polygons.push([d.hinge, d.strike]);
    return { arc: first, polygons };
  });
}

/**
 * ── WHICH FOUND OPENING IS A KEY OPENING ──
 *
 * A key point belongs to a found opening when it is inside its shape (a door's swing) or within
 * `reachFeet` of it (2 ft, `OPENING_MATCH_FEET`), each key point to one opening and each opening to
 * one key point, closest pairs first. Returns 1 (real) or 0 (false) per found opening.
 */
export function openingLabels(shapes: readonly Pt[][], key: readonly KeyPoint[], feetPerUnit: number, reachFeet = 2): number[] {
  const reach = reachFeet / feetPerUnit;
  const pairs: { i: number; j: number; d: number }[] = [];
  shapes.forEach((shape, i) => {
    const edges: Line[] = shape.length === 1 ? [{ x1: shape[0]!.x, y1: shape[0]!.y, x2: shape[0]!.x, y2: shape[0]!.y }] : shape.map((a, k) => { const b = shape[(k + 1) % shape.length]!; return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }; });
    const centre = { x: shape.reduce((n, p) => n + p.x, 0) / shape.length, y: shape.reduce((n, p) => n + p.y, 0) / shape.length };
    key.forEach((p, j) => {
      const inside = shape.length >= 3 && insidePolygon(p, shape);
      const edge = Math.min(...edges.map((e) => toSegment(p, e)));
      if (inside || edge <= reach) pairs.push({ i, j, d: inside ? 0 : dist(p, centre) });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedI = new Set<number>(), usedJ = new Set<number>();
  for (const { i, j } of pairs) {
    if (usedI.has(i) || usedJ.has(j)) continue;
    usedI.add(i);
    usedJ.add(j);
  }
  return shapes.map((_, i) => (usedI.has(i) ? 1 : 0));
}

/** Share of the closed leaf's span (hinge to strike) that wall-direction lines run across: a doorway is a gap (0). */
function linesAcross(d: DoorSymbol, segments: readonly StrokeSegment[], bandUnits: number): number {
  const L = dist(d.hinge, d.strike);
  if (L === 0) return 0;
  const ux = (d.strike.x - d.hinge.x) / L, uy = (d.strike.y - d.hinge.y) / L;
  const spans: [number, number][] = [];
  for (const s of segments) {
    if (s.curved) continue;
    const sl = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (sl === 0 || Math.abs(((s.x2 - s.x1) * ux + (s.y2 - s.y1) * uy) / sl) < 0.985) continue;
    const off = Math.abs((mid(s).x - d.hinge.x) * -uy + (mid(s).y - d.hinge.y) * ux);
    if (off > bandUnits) continue;
    const t1 = (s.x1 - d.hinge.x) * ux + (s.y1 - d.hinge.y) * uy, t2 = (s.x2 - d.hinge.x) * ux + (s.y2 - d.hinge.y) * uy;
    const a = Math.max(0.1 * L, Math.min(t1, t2)), b = Math.min(0.9 * L, Math.max(t1, t2));
    if (b > a) spans.push([a, b]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let covered = 0, end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    covered += b - Math.max(a, end);
    end = b;
  }
  return covered / (0.8 * L);
}

export type SheetContext = {
  segments: readonly StrokeSegment[];
  walls: readonly WallCandidate[];
  /** Page text, page-width units, each item's centre. */
  words: readonly PlacedText[];
  feetPerUnit: number;
  /** Page width in points: feet per point is the drawing's scale, the one sheet-level number. */
  widthPt: number;
  renovation: boolean;
};

/** One row per door, in `doors` order, with `DOOR_FEATURE_NAMES` columns. */
export function doorFeatureRows(input: SheetContext & { doors: readonly DoorSymbol[]; arcs: readonly DoorArcCandidate[]; marks: readonly PlacedText[]; keptByProduct: ReadonlySet<DoorSymbol> }): number[][] {
  const { doors, walls, feetPerUnit: fpu } = input;
  const exterior = exteriorWalls(walls, fpu);
  const swings = doorSwings(doors, input.arcs, fpu);
  const reach = DOOR_TAG_REACH_FEET / fpu;
  const centres = doors.map((d) => ({ x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2 }));
  const markedShare = doors.length === 0 ? 0 : centres.filter((c) => input.marks.some((m) => dist(m, c) <= reach)).length / doors.length;
  const arcHinges = input.arcs.filter((a) => a.fit !== null).map((a) => ({ x: a.fit!.cx, y: a.fit!.cy }));
  const roomWords = input.words.filter((w) => ROOM_WORDS.test(w.text));
  const existWords = input.words.filter((w) => EXIST_WORDS.test(w.text));
  const straight = input.segments.filter((s) => !s.curved);
  return doors.map((d, i) => {
    const c = centres[i]!;
    const wall = d.wall === null ? null : walls[d.wall]!;
    const markFeet = nearestFeet(c, input.marks, fpu);
    const nearest = input.marks.reduce<PlacedText | null>((b, m) => (b === null || dist(m, c) < dist(b, c) ? m : b), null);
    const swing = swings[i]!;
    const inSwing = straight.filter((s) => swing.polygons.some((poly) => poly.length >= 3 && insidePolygon(mid(s), poly))).length;
    const band = ((wall?.thicknessFeet ?? 0.5) / 2 + 0.25) / fpu;
    return [
      d.widthFeet, d.leaves, d.sweepDegrees, swing.arc?.fit?.worst ?? -1, swing.arc?.chain.length ?? 0,
      Math.min(...STANDARD_WIDTHS.map((w) => Math.abs(d.widthFeet - w))),
      wall === null ? 0 : 1, wall === null ? -1 : wall.thicknessFeet * 12, d.wall !== null && exterior[d.wall] ? 1 : 0, linesAcross(d, input.segments, band),
      markFeet, markFeet <= DOOR_TAG_REACH_FEET ? 1 : 0, nearest !== null && markFeet <= DOOR_TAG_REACH_FEET && /^\d/.test(nearest.text) ? 1 : 0,
      doors.length, markedShare, input.keptByProduct.has(d) ? 0 : 1,
      arcHinges.filter((h) => dist(h, d.hinge) * fpu <= 3).length - 1, inSwing,
      input.words.filter((w) => dist(w, c) * fpu <= 6).length, nearestFeet(c, roomWords, fpu) <= 10 ? 1 : 0, nearestFeet(c, existWords, fpu) <= 10 ? 1 : 0,
      input.renovation ? 1 : 0, fpu / input.widthPt,
    ];
  });
}

/** A window candidate: a frame the finder drew, or a tag the product placed with no frame. */
export type WindowCandidate = { frame: WindowSymbol | null; at: Pt; countedTag: string | null };

/** The shape a key point is matched against: the frame's line, or the placed point. */
export const windowShape = (w: WindowCandidate): Pt[] => (w.frame === null ? [w.at] : [{ x: w.frame.x1, y: w.frame.y1 }, { x: w.frame.x2, y: w.frame.y2 }]);

/** One row per window candidate, with `WINDOW_FEATURE_NAMES` columns. */
export function windowFeatureRows(input: SheetContext & { windows: readonly WindowCandidate[]; tags: readonly PlacedText[]; doors: readonly DoorSymbol[]; everyWindowTagged: boolean; scheduleInSet: boolean }): number[][] {
  const { walls, feetPerUnit: fpu } = input;
  const exterior = exteriorWalls(walls, fpu);
  const existWords = input.words.filter((w) => EXIST_WORDS.test(w.text));
  const doorCentres = input.doors.map((d) => ({ x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2 }));
  return input.windows.map((w) => {
    const f = w.frame;
    const wall = f === null || f.wall < 0 ? null : walls[f.wall]!;
    const tagFeet = nearestFeet(w.at, input.tags, fpu);
    const nearest = input.tags.reduce<PlacedText | null>((b, t) => (b === null || dist(t, w.at) < dist(b, w.at) ? t : b), null);
    return [
      f === null ? 0 : 1, f?.widthFeet ?? -1, f?.lines ?? -1, f === null ? -1 : Math.max(0, f.lines - 2),
      wall === null ? 0 : 1, wall === null ? -1 : wall.thicknessFeet * 12, f !== null && f.wall >= 0 && exterior[f.wall] ? 1 : 0, wall === null || f === null ? -1 : f.widthFeet / Math.max(0.1, wall.thicknessFeet),
      tagFeet, tagFeet <= WINDOW_TAG_REACH_FEET ? 1 : 0, nearest !== null && tagFeet <= WINDOW_TAG_REACH_FEET && /^W/i.test(nearest.text) ? 1 : 0, w.countedTag === null ? 0 : 1, input.everyWindowTagged ? 1 : 0, input.scheduleInSet ? 1 : 0,
      input.windows.length, input.windows.filter((o) => o !== w && dist(o.at, w.at) * fpu <= 4).length, nearestFeet(w.at, doorCentres, fpu), nearestFeet(w.at, existWords, fpu) <= 10 ? 1 : 0,
      input.renovation ? 1 : 0, fpu / input.widthPt,
    ];
  });
}

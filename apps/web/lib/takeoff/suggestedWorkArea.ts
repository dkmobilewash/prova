import { dashLines } from "./demoWalls";
import { textRows, type TextItem } from "./existingWalls";
import { roomsFromWalls } from "./roomsFromWalls";
import type { Polygon } from "./userExclusions";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── A WORK AREA THE SHEET SUGGESTS AND THE USER CONFIRMS ──
 *
 * The drawn work area is the one tool that cost no recall, but it costs the
 * person a drawing step. This proposes it from what the sheet itself says:
 *
 *   BASE — a dashed line labelled LIMIT OF WORK, or else the extent of the
 *   paired demolition plan's walls to remove, or else the whole plan.
 *   CUT OUT — a room labelled NIC / NO WORK / (E) <name>, and a hatched field
 *   holding an NIC label. A room is cut out inset, so its bounding walls stay.
 *
 * Nothing on the sheet means no suggestion, never a guess. Rectangles only, so
 * a person can read one at a glance and it can be saved as ordinary work-area
 * polygons. The constants were fixed before anything was scored.
 */
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Suggestion = { polygons: Polygon[]; sources: string[] };

/** Past the demolition extent, for the new work that meets it, in feet. */
export const DEMO_PAD_FEET = 5;
/** Demolition under this many feet says too little about the extent of the work. */
export const DEMO_MIN_FEET = 30;
/** A limit line starts this close to its label, and its pieces join this close, in feet. */
export const LIMIT_REACH_FEET = 3;
export const LIMIT_JOIN_FEET = 2;
/** A limit line encloses at least this in each direction, in feet. */
export const LIMIT_MIN_FEET = 10;
/** A room is cut out this far inside its bounds, so the walls round it stay offered. */
export const ROOM_INSET_FEET = 1;
export const HATCH_CELL_FEET = 4;
export const HATCH_CELL_STROKES = 6;

const LIMIT = /^(?:LIMITS?\s+OF\s+(?:WORK|CONSTRUCTION|RENOVATION|SCOPE)|(?:AREA|SCOPE)\s+OF\s+WORK|WORK\s+AREA)\b/i;
const NIC = /^(?:AREA\s+)?["']?(?:N\.?\s?I\.?\s?C\.?|NOT\s+IN\s+(?:THIS\s+)?CONTRACT|NO\s+WORK(?:\s+(?:IN\s+)?THIS\s+AREA)?)(?![A-Z])/i;
const NIC_ITEM = /\b(?:TYP|ALL|FURNITURE|EQUIPMENT|FIXTURE|ITEM)\b/i;
const EXISTING_ROOM = /^\(E\)\s+(?:[A-Z0-9#&'./-]+\s*){1,4}$/i;
const NOT_A_ROOM = /\b(?:WALLS?|PARTITIONS?|DEMISING|DOORS?|WINDOWS?|OVERHEAD|CMU|MASONRY|BRICK|CONC(?:RETE)?|CEILING|FLOOR|SLAB|ROOF|BEAM|COLUMNS?|FOOTING|CURB|EQUIP(?:MENT)?|GRID|FIXTURE|DUCT|PIPE|PANEL|METER|BOX|FRAME|TILE|MIRROR)\b/i;

/** `rect` with `hole` taken out, as up to four rectangles. */
export function subtractRect(rect: Rect, hole: Rect): Rect[] {
  const x0 = Math.max(rect.x0, hole.x0), x1 = Math.min(rect.x1, hole.x1), y0 = Math.max(rect.y0, hole.y0), y1 = Math.min(rect.y1, hole.y1);
  if (x0 >= x1 || y0 >= y1) return [rect];
  const out: Rect[] = [];
  if (rect.y0 < y0) out.push({ ...rect, y1: y0 });
  if (y1 < rect.y1) out.push({ ...rect, y0: y1 });
  if (rect.x0 < x0) out.push({ x0: rect.x0, y0, x1: x0, y1 });
  if (x1 < rect.x1) out.push({ x0: x1, y0, x1: rect.x1, y1 });
  return out;
}

const toPolygon = (r: Rect): Polygon => ({ xs: [r.x0, r.x1, r.x1, r.x0], ys: [r.y0, r.y0, r.y1, r.y1] });
const centre = (t: TextItem, w: number) => ({ x: (t.x + t.width / 2) / w, y: (t.y - t.height / 2) / w });

/** The box of the dashed line a limit-of-work label names, or null. */
function limitBox(labels: readonly TextItem[], segments: readonly StrokeSegment[], widthPt: number, feetPerUnit: number): Rect | null {
  if (labels.length === 0) return null;
  const lines = dashLines(segments).map((d) => {
    const ux = Math.cos(d.theta), uy = Math.sin(d.theta);
    const at = (t: number) => ({ x: (t * ux - d.perp * uy) / widthPt, y: (t * uy + d.perp * ux) / widthPt });
    return { a: at(d.t0), b: at(d.t1) };
  });
  const feet = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) * feetPerUnit;
  const toSegmentFeet = (p: { x: number; y: number }, l: { a: { x: number; y: number }; b: { x: number; y: number } }) => {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p.x - l.a.x) * dx + (p.y - l.a.y) * dy) / l2));
    return feet(p, { x: l.a.x + t * dx, y: l.a.y + t * dy });
  };
  const seen = new Set<number>();
  const queue: number[] = [];
  lines.forEach((l, i) => {
    if (labels.some((t) => toSegmentFeet(centre(t, widthPt), l) <= LIMIT_REACH_FEET)) {
      seen.add(i);
      queue.push(i);
    }
  });
  while (queue.length > 0) {
    const l = lines[queue.pop() as number];
    lines.forEach((o, i) => {
      if (!seen.has(i) && Math.min(feet(l.a, o.a), feet(l.a, o.b), feet(l.b, o.a), feet(l.b, o.b)) <= LIMIT_JOIN_FEET) {
        seen.add(i);
        queue.push(i);
      }
    });
  }
  if (seen.size === 0) return null;
  const pts = [...seen].flatMap((i) => [lines[i].a, lines[i].b]);
  const box = { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
  return (box.x1 - box.x0) * feetPerUnit >= LIMIT_MIN_FEET && (box.y1 - box.y0) * feetPerUnit >= LIMIT_MIN_FEET ? box : null;
}

/** The connected field of hatch cells round a point, or null when the point is not in one. */
function hatchBox(at: { x: number; y: number }, segments: readonly StrokeSegment[], widthPt: number, feetPerUnit: number): Rect | null {
  const cell = HATCH_CELL_FEET / feetPerUnit;
  const counts = new Map<string, number>();
  for (const s of segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const feet = (Math.hypot(dx, dy) / widthPt) * feetPerUnit;
    if (feet === 0 || feet > HATCH_CELL_FEET * 2) continue;
    const off = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI % 90;
    if (off < 20 || off > 70) continue;
    const k = `${Math.floor((s.x1 + s.x2) / 2 / widthPt / cell)},${Math.floor((s.y1 + s.y2) / 2 / widthPt / cell)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const hot = (k: string) => (counts.get(k) ?? 0) >= HATCH_CELL_STROKES;
  const start = `${Math.floor(at.x / cell)},${Math.floor(at.y / cell)}`;
  if (!hot(start)) return null;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const [cx, cy] = (queue.pop() as string).split(",").map(Number);
    for (const k of [`${cx + 1},${cy}`, `${cx - 1},${cy}`, `${cx},${cy + 1}`, `${cx},${cy - 1}`]) {
      if (!seen.has(k) && hot(k)) {
        seen.add(k);
        queue.push(k);
      }
    }
  }
  const xy = [...seen].map((k) => k.split(",").map(Number));
  return { x0: Math.min(...xy.map((p) => p[0])) * cell, y0: Math.min(...xy.map((p) => p[1])) * cell, x1: (Math.max(...xy.map((p) => p[0])) + 1) * cell, y1: (Math.max(...xy.map((p) => p[1])) + 1) * cell };
}

function insidePolygon(px: number, py: number, xs: readonly number[], ys: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) {
    if (ys[i] > py !== ys[j] > py && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
  }
  return inside;
}

export function suggestedWorkArea(input: {
  /** The offered runs, page-width units. */
  runs: readonly WallCandidate[];
  /** The page's strokes, in points. */
  segments: readonly StrokeSegment[];
  textItems: readonly TextItem[];
  widthPt: number;
  feetPerUnit: number;
  /** The paired demolition plan's walls to remove, moved onto this sheet, page-width units. */
  demoRemoved?: readonly { x1: number; y1: number; x2: number; y2: number; lengthFeet: number }[];
}): Suggestion | null {
  const { runs, segments, widthPt, feetPerUnit } = input;
  if (runs.length === 0) return null;
  const rows = textRows(input.textItems).filter((r) => r.str.length <= 60);
  const sources: string[] = [];
  const pad = DEMO_PAD_FEET / feetPerUnit;
  const boxOf = (ls: readonly { x1: number; y1: number; x2: number; y2: number }[]): Rect => ({
    x0: Math.min(...ls.flatMap((l) => [l.x1, l.x2])) - pad,
    y0: Math.min(...ls.flatMap((l) => [l.y1, l.y2])) - pad,
    x1: Math.max(...ls.flatMap((l) => [l.x1, l.x2])) + pad,
    y1: Math.max(...ls.flatMap((l) => [l.y1, l.y2])) + pad,
  });
  const removed = input.demoRemoved ?? [];
  let base = limitBox(rows.filter((r) => LIMIT.test(r.str.trim())), segments, widthPt, feetPerUnit);
  if (base !== null) sources.push("limit-of-work line");
  else if (removed.reduce((n, r) => n + r.lengthFeet, 0) >= DEMO_MIN_FEET) {
    base = boxOf(removed);
    sources.push("demolition plan extent");
  } else base = boxOf(runs);

  const labels = rows.filter((r) => (NIC.test(r.str.trim()) && !NIC_ITEM.test(r.str)) || (EXISTING_ROOM.test(r.str.trim()) && !NOT_A_ROOM.test(r.str)));
  const holes: Rect[] = [];
  if (labels.length > 0) {
    const { rooms } = roomsFromWalls({ walls: runs.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet })), feetPerUnit });
    const inset = ROOM_INSET_FEET / feetPerUnit;
    for (const label of labels) {
      const at = centre(label, widthPt);
      const room = rooms.find((r) => insidePolygon(at.x, at.y, r.xs, r.ys));
      if (room !== undefined) {
        holes.push({ x0: Math.min(...room.xs) + inset, y0: Math.min(...room.ys) + inset, x1: Math.max(...room.xs) - inset, y1: Math.max(...room.ys) - inset });
        if (!sources.includes("rooms marked NIC or existing")) sources.push("rooms marked NIC or existing");
        continue;
      }
      if (!NIC.test(label.str.trim())) continue;
      const field = hatchBox(at, segments, widthPt, feetPerUnit);
      if (field !== null) {
        holes.push(field);
        if (!sources.includes("hatched NIC area")) sources.push("hatched NIC area");
      }
    }
  }
  if (sources.length === 0) return null;
  let rects: Rect[] = [base];
  for (const hole of holes) if (hole.x0 < hole.x1 && hole.y0 < hole.y1) rects = rects.flatMap((r) => subtractRect(r, hole));
  return { polygons: rects.map(toPolygon), sources };
}

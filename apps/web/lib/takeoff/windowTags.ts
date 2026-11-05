import { WINDOW_TAGS_MEAN_ALL, type WindowSymbol } from "./doorWindowSymbols";
import { widthAndHeight, type ScheduledOpening } from "./openingMarks";
import type { TagSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";

/**
 * ── WINDOWS COUNTED BY THEIR OPENINGS, TYPED BY THE NEAREST TAG ──
 *
 * One tag often names several windows: Topeka draws an "A" hexagon by each
 * group of units' windows, 24 of them read against 50–61 windows a sheet, so
 * counting tags undercounted by half. A window is an OPENING — the frame the
 * finder draws in an exterior wall (`windowSymbols`) — and the tag is what it
 * is: the nearest tag of the sheet's vocabulary within `WINDOW_TAG_TYPES_FEET`
 * of the frame gives its type. A frame with no tag that near is not counted
 * (casework, a porch's sliding door, a section bubble: on training the false
 * frames sat 3 ft and more from any tag, the windows within 2.8 ft).
 *
 * The vocabulary is the window schedule's marks where the set has one read,
 * else W-numbered tags when the sheet carries enough to mean it tags its
 * windows (`tagsNameEveryWindow`). With neither, or no frame tagged, nothing
 * is counted and windows stay "to check".
 */
export type TaggedWindow = {
  tag: string;
  /** Where the window is: on the frame drawn by the tag, else on the nearest wall. Page-width units. */
  x: number;
  y: number;
  /** The schedule row the tag names, when a schedule was read. */
  row: ScheduledOpening | null;
  /** The frame placed with it, as an index into the frames given, or null. */
  frame: number | null;
};

export type TaggedWindows = {
  /** Whether the sheet's tags could be read as windows at all. */
  counted: boolean;
  vocabulary: "schedule" | "w-tags" | null;
  windows: TaggedWindow[];
  /** Count per tag, in schedule order (else tag order). */
  byTag: { tag: string; count: number; row: ScheduledOpening | null }[];
};

/** A tag farther than this from every wall and every frame is a legend, an elevation or a note. */
export const WINDOW_TAG_WALL_FEET = 6;
/** A frame within this of a tag is that tag's window. */
export const WINDOW_FRAME_REACH_FEET = 6;
/** A tag within this of a frame's line gives that frame its type; farther, the frame is not counted. Training: windows ≤ 2.8 ft, false frames ≥ 3. */
export const WINDOW_TAG_TYPES_FEET = 3;
const W_TAG = /^W\d{1,2}[A-Z]?$/;

/** "W-1", "w 1" and "W1" are one tag. */
export const normaliseTag = (text: string) => text.trim().toUpperCase().replace(/[\s-]+/g, "");

function nearestOnRun(p: { x: number; y: number }, w: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / l2));
  const x = w.x1 + t * dx, y = w.y1 + t * dy;
  return { x, y, d: Math.hypot(p.x - x, p.y - y) };
}

export function windowsByTag(input: {
  /** `tagSymbols` over the sheet, in page POINTS. */
  symbols: readonly TagSymbol[];
  widthPt: number;
  /** The WINDOW schedule rows the set's ingest read, if any. */
  windowRows: readonly { mark: string; size?: string | null; description?: string | null }[];
  /** The frame finder's windows, page-width units. */
  frames: readonly WindowSymbol[];
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  /** The set's wall legend codes: a W4 that is a wall type is not a window. */
  wallCodes?: readonly string[];
}): TaggedWindows {
  const W = input.widthPt;
  const rows: ScheduledOpening[] = input.windowRows
    .filter((r) => typeof r.mark === "string" && normaliseTag(r.mark) !== "")
    .map((r) => ({ mark: r.mark.trim(), ...widthAndHeight(r.size ?? null), description: r.description ?? null }));
  const rowOf = new Map(rows.map((r) => [normaliseTag(r.mark), r]));
  const wallCodes = new Set((input.wallCodes ?? []).map(normaliseTag));
  const isWTag = (s: TagSymbol) => s.rejected === null && W_TAG.test(normaliseTag(s.text)) && !wallCodes.has(normaliseTag(s.text));
  const wTags = input.symbols.filter(isWTag);
  const vocabulary: TaggedWindows["vocabulary"] = rowOf.size > 0 ? "schedule" : wTags.length >= WINDOW_TAGS_MEAN_ALL ? "w-tags" : null;
  if (vocabulary === null || !(input.feetPerUnit > 0)) return { counted: false, vocabulary: null, windows: [], byTag: [] };

  // A schedule's mark, or a W-numbered tag even where the schedule read has no
  // such row: the tag is the drawing's own statement, and a row the reader
  // missed (Baker's W5) shows as a window with no row rather than vanishing.
  const scheduled = (s: TagSymbol) => rowOf.has(normaliseTag(s.text)) && (s.rejected === null || s.rejected === "sheet-reference");
  // ── A TAG SHAPED LIKE THE SCHEDULE'S IS ONE, WHERE THE READ MISSED ITS ROW ──
  // Topeka's schedule read has A, D, E and F; its plans tag B and C windows in
  // the same hexagons. Where every mark is a single letter, a single letter in a
  // symbol of a scheduled mark's shape is a window tag too (never a wall code).
  const letters = rows.length > 0 && rows.every((r) => /^[A-Z]$/.test(normaliseTag(r.mark)));
  const shapes = new Set(input.symbols.filter(scheduled).map((s) => s.shape));
  const likeScheduled = (s: TagSymbol) => letters && s.rejected === null && /^[A-Z]$/.test(normaliseTag(s.text)) && shapes.has(s.shape) && !wallCodes.has(normaliseTag(s.text));
  const isTag = (s: TagSymbol) => scheduled(s) || isWTag(s) || likeScheduled(s);
  // Every tag of the vocabulary, where it was read and where its leader points.
  const tags = input.symbols.filter(isTag).map((s) => ({ tag: normaliseTag(s.text), points: [{ x: s.x / W, y: s.y / W }, ...(s.leader ? [{ x: s.leader.x / W, y: s.leader.y / W }] : [])] }));
  const reach = WINDOW_TAG_TYPES_FEET / input.feetPerUnit;
  const windows: TaggedWindow[] = [];
  input.frames.forEach((f, i) => {
    let tag: string | null = null, best = reach;
    for (const t of tags) for (const p of t.points) {
      const d = nearestOnRun(p, f).d;
      if (d <= best) { best = d; tag = t.tag; }
    }
    if (tag === null) return;
    windows.push({ tag, x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2, row: rowOf.get(tag) ?? null, frame: i });
  });
  // A schedule with no tag read on this sheet is not a count of zero windows.
  if (windows.length === 0) return { counted: false, vocabulary: null, windows: [], byTag: [] };
  const order = [...new Set([...rowOf.keys(), ...windows.map((w) => w.tag)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const byTag = order
    .map((tag) => ({ tag, count: windows.filter((w) => w.tag === tag).length, row: rowOf.get(tag) ?? null }))
    .filter((t) => t.count > 0 || vocabulary === "schedule");
  return { counted: true, vocabulary, windows, byTag };
}

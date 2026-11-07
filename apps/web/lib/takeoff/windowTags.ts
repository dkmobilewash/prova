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
  /** The frame placed with it, as an index into the frames given (the first piece of a joined one), or null. */
  frame: number | null;
  /** The whole window's line, where pieces of one frame were joined (`joinedFrames`). */
  span?: { x1: number; y1: number; x2: number; y2: number };
};

/** Two frame pieces whose ends are this close, on one wall line, are one window drawn in two strokes. */
export const FRAME_JOIN_FEET = 0.25;

/**
 * ── ONE WINDOW DRAWN AS TWO FRAME PIECES IS ONE WINDOW ──
 *
 * Topeka draws some windows as two frame pieces either side of a mullion, and each
 * piece was counted: 16 of its 46 false windows on training were a second count of a
 * window already counted. Pieces on the same wall run, collinear, whose ends are
 * within `FRAME_JOIN_FEET`, are joined into one frame before they are typed. Two
 * windows with wall between them stay two: the gap is the wall.
 */
export function joinedFrames(frames: readonly WindowSymbol[], feetPerUnit: number): { f: WindowSymbol; first: number }[] {
  const gap = FRAME_JOIN_FEET / feetPerUnit;
  const out: { f: WindowSymbol; first: number }[] = [];
  frames.forEach((f, i) => {
    const same = out.find(({ f: o }) => {
      if (o.wall < 0 || o.wall !== f.wall) return false;
      const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy);
      if (len === 0) return false;
      const ux = dx / len, uy = dy / len;
      // Collinear: the piece's ends sit on the frame's line.
      const off = (px: number, py: number) => Math.abs((px - o.x1) * uy - (py - o.y1) * ux);
      if (off(f.x1, f.y1) > gap / 2 || off(f.x2, f.y2) > gap / 2) return false;
      const a = (f.x1 - o.x1) * ux + (f.y1 - o.y1) * uy, b = (f.x2 - o.x1) * ux + (f.y2 - o.y1) * uy;
      return Math.max(Math.min(a, b) - len, -Math.max(a, b)) <= gap;
    });
    if (same === undefined) {
      out.push({ f, first: i });
      return;
    }
    const o = same.f;
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const ts = [0, len, (f.x1 - o.x1) * ux + (f.y1 - o.y1) * uy, (f.x2 - o.x1) * ux + (f.y2 - o.y1) * uy];
    const lo = Math.min(...ts), hi = Math.max(...ts);
    same.f = { ...o, x1: o.x1 + lo * ux, y1: o.y1 + lo * uy, x2: o.x1 + hi * ux, y2: o.y1 + hi * uy, widthFeet: (hi - lo) * feetPerUnit };
  });
  return out;
}

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
/** Two same-tag windows whose centres are closer than this are one window drawn twice. */
export const WINDOW_SAME_FEET = 4;
const W_TAG = /^W\d{1,2}[A-Z]?$/;

/** "W-1", "w 1" and "W1" are one tag. */
export const normaliseTag = (text: string) => text.trim().toUpperCase().replace(/[\s-]+/g, "");

function nearestOnRun(p: { x: number; y: number }, w: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / l2));
  const x = w.x1 + t * dx, y = w.y1 + t * dy;
  return { x, y, d: Math.hypot(p.x - x, p.y - y) };
}

/**
 * ── WHICH TAG SYMBOLS NAME WINDOWS ON THIS SHEET ──
 *
 * One definition, used by `windowsByTag` to type the frames and by the frame
 * finder to decide whether the sheet tags every window. A schedule's mark, or
 * a W-numbered tag even where the schedule read has no such row (the tag is
 * the drawing's own statement: Baker's W5), or, where every mark is a single
 * letter, a single letter in a symbol of a scheduled mark's shape (Topeka's
 * read has A, D, E and F; its plans tag B and C in the same hexagons). Never a
 * wall code spelled like one.
 */
export function windowTagVocabulary(
  symbols: readonly TagSymbol[],
  windowRows: readonly { mark: string }[],
  wallCodesIn: readonly string[],
): { vocabulary: TaggedWindows["vocabulary"]; isTag: (s: TagSymbol) => boolean } {
  const marks = new Set(windowRows.filter((r) => typeof r.mark === "string" && normaliseTag(r.mark) !== "").map((r) => normaliseTag(r.mark)));
  const wallCodes = new Set(wallCodesIn.map(normaliseTag));
  const isWTag = (s: TagSymbol) => s.rejected === null && W_TAG.test(normaliseTag(s.text)) && !wallCodes.has(normaliseTag(s.text));
  const vocabulary: TaggedWindows["vocabulary"] = marks.size > 0 ? "schedule" : symbols.filter(isWTag).length >= WINDOW_TAGS_MEAN_ALL ? "w-tags" : null;
  const scheduled = (s: TagSymbol) => marks.has(normaliseTag(s.text)) && (s.rejected === null || s.rejected === "sheet-reference");
  const letters = marks.size > 0 && [...marks].every((m) => /^[A-Z]$/.test(m));
  const shapes = new Set(symbols.filter(scheduled).map((s) => s.shape));
  const likeScheduled = (s: TagSymbol) => letters && s.rejected === null && /^[A-Z]$/.test(normaliseTag(s.text)) && shapes.has(s.shape) && !wallCodes.has(normaliseTag(s.text));
  return { vocabulary, isTag: (s) => scheduled(s) || isWTag(s) || likeScheduled(s) };
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
  const { vocabulary, isTag } = windowTagVocabulary(input.symbols, input.windowRows, input.wallCodes ?? []);
  if (vocabulary === null || !(input.feetPerUnit > 0)) return { counted: false, vocabulary: null, windows: [], byTag: [] };
  // Every tag of the vocabulary, where it was read and where its leader points.
  const tags = input.symbols.filter(isTag).map((s) => ({ tag: normaliseTag(s.text), points: [{ x: s.x / W, y: s.y / W }, ...(s.leader ? [{ x: s.leader.x / W, y: s.leader.y / W }] : [])] }));
  const reach = WINDOW_TAG_TYPES_FEET / input.feetPerUnit;
  const windows: TaggedWindow[] = [];
  for (const { f, first } of joinedFrames(input.frames, input.feetPerUnit)) {
    let tag: string | null = null, best = reach;
    for (const t of tags) for (const p of t.points) {
      const d = nearestOnRun(p, f).d;
      if (d <= best) { best = d; tag = t.tag; }
    }
    if (tag === null) continue;
    // ── ONE WINDOW DRAWN TWICE IS COUNTED ONCE ──
    // A frame offered twice (two outlines of one window, a sill line beside its
    // glass) lands two same-tag windows a hand apart. No two real windows' centres
    // sit closer than a window is wide, so a same-tag centre within
    // `WINDOW_SAME_FEET` of one already counted is the same window.
    const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2;
    if (windows.some((w) => w.tag === tag && Math.hypot(w.x - cx, w.y - cy) * input.feetPerUnit < WINDOW_SAME_FEET)) continue;
    windows.push({ tag, x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2, row: rowOf.get(tag) ?? null, frame: first, span: { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2 } });
  }
  // A schedule with no tag read on this sheet is not a count of zero windows.
  if (windows.length === 0) return { counted: false, vocabulary: null, windows: [], byTag: [] };
  const order = [...new Set([...rowOf.keys(), ...windows.map((w) => w.tag)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const byTag = order
    .map((tag) => ({ tag, count: windows.filter((w) => w.tag === tag).length, row: rowOf.get(tag) ?? null }))
    .filter((t) => t.count > 0 || vocabulary === "schedule");
  return { counted: true, vocabulary, windows, byTag };
}

/**
 * ── WHAT A COUNTED SHEET LEAVES FOR THE REVIEW QUEUE ──
 *
 * Counted windows are a SUGGESTION, the way wall types are: the ingest stores
 * them on the sheet as this read, the review queue shows them as one count to
 * confirm (false hits dropped there), and only the confirmed windows become
 * count items on the estimate (`confirmWindows`). Nothing posts before that.
 */
export const WINDOWS_SUGGESTED = "WINDOWS_SUGGESTED";
export type StoredWindow = { tag: string; x1: number; y1: number; x2: number; y2: number };
export type StoredWindows = { windows: StoredWindow[]; decided?: boolean };

/** The counted windows as stored: each on its frame's line, so the queue can light it. Null when the sheet was not counted. */
export function windowsToStore(tagged: TaggedWindows, frames: readonly WindowSymbol[]): StoredWindows | null {
  if (!tagged.counted) return null;
  const windows = tagged.windows.flatMap((w) => {
    const f = w.span ?? (w.frame === null ? undefined : frames[w.frame]);
    return f === undefined ? [] : [{ tag: w.tag, x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2 }];
  });
  return windows.length === 0 ? null : { windows };
}

/** A stored read, or null when it is not one (an older shape, or hand-edited). */
export function storedWindowsOf(value: unknown): StoredWindows | null {
  const v = value as Partial<StoredWindows> | null;
  if (v === null || typeof v !== "object" || !Array.isArray(v.windows)) return null;
  const windows = v.windows.filter((w): w is StoredWindow => typeof w?.tag === "string" && [w.x1, w.y1, w.x2, w.y2].every((n) => Number.isFinite(n)));
  return { windows, decided: v.decided === true };
}

/** The count item a confirmed window of this type joins. */
export const windowItemName = (tag: string) => `Windows — ${tag}`;

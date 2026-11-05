import { WINDOW_TAGS_MEAN_ALL, type WindowSymbol } from "./doorWindowSymbols";
import { widthAndHeight, type ScheduledOpening } from "./openingMarks";
import type { TagSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";

/**
 * ── WINDOWS COUNTED BY THEIR TAGS, THE WAY DOORS ARE NAMED BY THEIR MARKS ──
 *
 * A window on a floor plan carries a tag in a symbol beside it — W1, W2 —
 * and the window schedule (or the window-type elevations) says what each tag
 * is. So the count is the drawing's own lettering: every window tag drawn in
 * a symbol near a wall is one window of that type. The frame finder
 * (`windowSymbols`) only backs a tag up: it places the window where a frame
 * is drawn near the tag, and never counts a window by itself — three
 * parallel lines across a wall are also casework, a storefront mullion, or
 * the line between new and existing (Baker A101: 32 frames, none a window).
 *
 * The tags' vocabulary is the window schedule's marks where the set has one
 * read; else W-numbered tags, when the sheet carries enough of them to mean
 * it tags its windows (`tagsNameEveryWindow`). With neither, nothing is
 * counted and windows stay "to check".
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
/** Two of the same tag closer than this are one symbol read twice. */
const SAME_TAG_FEET = 0.5;
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
  const isTag = (s: TagSymbol) => (rowOf.has(normaliseTag(s.text)) && (s.rejected === null || s.rejected === "sheet-reference")) || isWTag(s);
  const reachWall = WINDOW_TAG_WALL_FEET / input.feetPerUnit;
  const reachFrame = WINDOW_FRAME_REACH_FEET / input.feetPerUnit;
  const same = SAME_TAG_FEET / input.feetPerUnit;
  const usedFrames = new Set<number>();
  const windows: TaggedWindow[] = [];
  for (const s of input.symbols.filter(isTag)) {
    const tag = normaliseTag(s.text);
    // Where the tag points: its leader's end when it has one, else its centre.
    const at = s.leader ? { x: s.leader.x / W, y: s.leader.y / W } : { x: s.x / W, y: s.y / W };
    if (windows.some((w) => w.tag === tag && Math.hypot(w.x - at.x, w.y - at.y) <= same)) continue;
    let frame: number | null = null, best = reachFrame;
    input.frames.forEach((f, i) => {
      if (usedFrames.has(i)) return;
      const d = nearestOnRun(at, f).d;
      if (d <= best) { best = d; frame = i; }
    });
    let place: { x: number; y: number } | null = null;
    if (frame !== null) {
      usedFrames.add(frame);
      const f = input.frames[frame]!;
      place = { x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2 };
    } else {
      const near = input.walls.map((w) => nearestOnRun(at, w)).sort((a, b) => a.d - b.d)[0];
      if (near !== undefined && near.d <= reachWall) place = { x: near.x, y: near.y };
    }
    // Near no wall and no frame: a legend, an elevation or a note, not a window.
    if (place === null) continue;
    windows.push({ tag, ...place, row: rowOf.get(tag) ?? null, frame });
  }
  const order = [...new Set([...rowOf.keys(), ...windows.map((w) => w.tag)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const byTag = order
    .map((tag) => ({ tag, count: windows.filter((w) => w.tag === tag).length, row: rowOf.get(tag) ?? null }))
    .filter((t) => t.count > 0 || vocabulary === "schedule");
  return { counted: true, vocabulary, windows, byTag };
}

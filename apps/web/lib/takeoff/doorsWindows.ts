import type { StrokeSegment, WallCandidate } from "./wallVectors";
import { DOOR_TAG_REACH_FEET, doorSymbols, WIDEST_DOOR_LEAF_FEET, onlyMarkedDoors, tagsNameEveryWindow, windowSymbols, WINDOW_TAGS_MEAN_ALL, type DoorSymbol, type WindowSymbol } from "./doorWindowSymbols";
import { existingDoors, insideLegendBox, type ExistingDoor, type ExistingDoorEvidence } from "./existingDoors";
import { textRows } from "./existingWalls";
import { joinOpeningsToSchedule, widthAndHeight, type OpeningJoin, type PlacedMark, type ScheduledOpening } from "./openingMarks";
import { tagSymbols, type TextForSymbol } from "./tagSymbols";
import { windowsByTag, windowTagVocabulary, type TaggedWindows } from "./windowTags";

/**
 * ── ONE SHEET'S DOORS AND WINDOWS, FROM ITS SYMBOLS, JOINED TO ITS SCHEDULE ──
 *
 * The viewer calls this after Find the walls, with what it already holds:
 * the strokes in page-width units for the symbols, the strokes and text in
 * page POINTS for the mark symbols (`tagSymbols` measures them in paper
 * inches), the found walls, and the door schedule rows the ingest read, if
 * any. Pure, so the eval and the tests call the same function.
 *
 * The join is the second session's `joinOpeningsToSchedule`: a mark drawn
 * in a symbol beside a door is the schedule's row, and the row's width is
 * the better witness when it disagrees with the drawn leaf. Here the drawn
 * width is the leaf's own radius rather than a wall gap, so the two agree
 * to the inch on every door measured — the join's job becomes naming the
 * door, and catching the schedule row with no door drawn.
 */
export type DoorsWindowsResult = {
  doors: DoorSymbol[];
  windows: WindowSymbol[];
  /** Null when the set has no door schedule rows to join to. */
  join: OpeningJoin | null;
  /**
   * Schedule rows no door on this sheet carries, by mark — the rows a
   * reviewer reconciles by hand: a door on another sheet of the set, or one
   * drawn with no swing and no readable tag. Empty when there is no schedule.
   */
  unplacedMarks: string[];
  /** Windows counted by their tags (`windowsByTag`); `counted: false` leaves them to check. */
  tagged: TaggedWindows;
  /**
   * Each door's printed mark, in `doors` order: the nearest door-mark symbol within
   * DOOR_TAG_REACH_FEET of its leaf, the reach `onlyMarkedDoors` uses; null for none.
   * A marked door is the auto-post door source (`autoPost.ts`).
   */
  doorMarks: (string | null)[];
  /** Found doors set aside as existing (`existingDoors.ts`): never in `doors`, shown with their reason. */
  existingDoors: ExistingDoor[];
};

/** The doors on the sheet: those drawn, plus those the schedule placed from a mark with no swing. */
export function doorCount(result: DoorsWindowsResult): number {
  return result.doors.length + (result.join?.placedByMark ?? 0);
}

/** A window tag is a short code in a symbol: W1, W2, A, 1. A door mark (101) is not one. */
export const WINDOW_TAG = /^W?\d{1,2}[A-Z]?$|^[A-Z]$/;

/**
 * The doors in scope: every swing found, less those set aside as existing (`existingDoors.ts`), then
 * `onlyMarkedDoors`. Shared with the door training rows (`productOpenings.ts`), so the rows are the
 * doors the product offers.
 */
/**
 * An angle dimension's own word: "110.00°". An arc with one inside its swing is the dimension's arc, not a door's
 * (Substation A-101's storefront angles, Mack A-101's 86.00°, Holabird A-1.1's second find of X23 through its 110.00°;
 * the retired Round-23 pool, 2026-11-17). Not a radius word: Substation's "R 3'-0"" sits inside the swing of the real
 * door 1118 beside the curved wall it dimensions, and rejecting on it lost that door.
 */
const DIMENSION_WORD = /^\d{1,3}(?:\.\d{1,2})?\s?°$/;

/** Whether a point lies in a single door's swing: within its radius of the hinge, between the strike and the open leaf. */
function inSwing(d: DoorSymbol, p: { x: number; y: number }, feetPerUnit: number): boolean {
  if (d.leaves !== 1 || d.open === undefined) return false;
  const r = d.widthFeet / feetPerUnit;
  if (Math.hypot(p.x - d.hinge.x, p.y - d.hinge.y) > r * 1.15) return false;
  const ang = (q: { x: number; y: number }) => Math.atan2(q.y - d.hinge.y, q.x - d.hinge.x);
  const norm = (t: number) => { while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI; return t; };
  const a0 = ang(d.strike), span = norm(ang(d.open) - a0), u = norm(ang(p) - a0);
  return span >= 0 ? u >= -0.1 && u <= span + 0.1 : u <= 0.1 && u >= span - 0.1;
}

/** Two found doors are copies when hinge and strike move by the same offset, within this, feet. */
export const COPY_TOLERANCE_FEET = 1;
/** A copy is another view only this far away, feet: a door beside its twin is a pair or a neighbour, not a view. */
export const COPY_MIN_OFFSET_FEET = 20;
/** An offset is a view's when this many door pairs share it. */
export const VIEW_OFFSET_MIN_DOORS = 3;
/** A view title: a line naming a PLAN, not a block of notes, a legend, a schedule or a key plan. */
const VIEW_TITLE = /\bPLAN\b/i;
const NOT_A_VIEW_TITLE = /\b(?:NOTES?|LEGEND|SCHEDULE|KEY)\b/i;
/** A view whose doors are not the work: finishes, lighting, ceilings, furniture, power, signage, equipment, demolition. */
export const NON_DOOR_VIEW = /\b(?:FINISH(?:ES)?|LIGHTING|REFLECTED|CEILING|RCP|FURNITURE|FURNISHINGS?|POWER|ELECTRICAL|SIGNAGE|EQUIPMENT|DEMOLITION|DEMO)\b/i;

/**
 * The doors found again in another view of the same plan, where that view is not the one the doors are counted in.
 * HPL I-110 draws one unit three times at 1/4" (finish plan, decorative lighting plan, partition plan) and Kirkland
 * df9e0224 A100 its demolition floor plan above its floor plan; each copy of a door is found at full size, so the
 * leaf cap (which caught Mack's 1/4" enlargements of a 1/8" plan) cannot see them. A door goes only when its own view's
 * title names a non-door view AND a copy of it stands in a view whose title does not: a single-view finish plan, or
 * copies with no titles to tell them apart, keep every door.
 */
export function copiedIntoOtherViews(doors: readonly DoorSymbol[], textPt: readonly TextForSymbol[], widthPt: number, feetPerUnit: number): Set<DoorSymbol> {
  const out = new Set<DoorSymbol>();
  if (doors.length < 2 * VIEW_OFFSET_MIN_DOORS || !(widthPt > 0) || !(feetPerUnit > 0)) return out;
  const tol = COPY_TOLERANCE_FEET / feetPerUnit, far = COPY_MIN_OFFSET_FEET / feetPerUnit;
  const pairs: { a: number; b: number; dx: number; dy: number }[] = [];
  for (let a = 0; a < doors.length; a++) for (let b = 0; b < doors.length; b++) {
    if (a === b) continue;
    const A = doors[a]!, B = doors[b]!;
    const dx = B.hinge.x - A.hinge.x, dy = B.hinge.y - A.hinge.y;
    if (Math.hypot(dx, dy) < far) continue;
    if (Math.hypot(B.strike.x - A.strike.x - dx, B.strike.y - A.strike.y - dy) > tol) continue;
    pairs.push({ a, b, dx, dy });
  }
  const viewPairs = pairs.filter((p) => pairs.filter((q) => Math.hypot(q.dx - p.dx, q.dy - p.dy) <= tol).length >= VIEW_OFFSET_MIN_DOORS);
  if (viewPairs.length === 0) return out;
  const titles = textRows(textPt as never)
    .filter((r) => r.str.length <= 60 && VIEW_TITLE.test(r.str) && !NOT_A_VIEW_TITLE.test(r.str))
    .map((r) => ({ str: r.str, x: (r.x + r.width / 2) / widthPt, y: (r.y - r.height / 2) / widthPt }));
  const titleOf = (d: DoorSymbol): string | null => {
    const m = { x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2 };
    let best: { d: number; str: string } | null = null;
    for (const t of titles) {
      if (t.y <= m.y) continue;
      const dist = Math.hypot(t.x - m.x, t.y - m.y);
      if (best === null || dist < best.d) best = { d: dist, str: t.str };
    }
    return best?.str ?? null;
  };
  const nonDoor = (i: number) => { const t = titleOf(doors[i]!); return t !== null && NON_DOOR_VIEW.test(t); };
  const counted = (i: number) => { const t = titleOf(doors[i]!); return t !== null && !NON_DOOR_VIEW.test(t); };
  for (const p of viewPairs) if (nonDoor(p.a) && counted(p.b)) out.add(doors[p.a]!);
  return out;
}

export function doorsInScope(input: {
  segments: readonly StrokeSegment[];
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  textPt: readonly TextForSymbol[];
  widthPt: number;
  marks: readonly { x: number; y: number }[];
  existing?: ExistingDoorEvidence;
}): { all: DoorSymbol[]; existing: ExistingDoor[]; doors: DoorSymbol[] } {
  const legend = (input.existing?.asideWalls ?? []).filter((w) => w.legend);
  const dims = input.textPt.filter((t) => DIMENSION_WORD.test(t.str.trim())).map((t) => ({ x: (t.x + t.width / 2) / input.widthPt, y: (t.y - t.height / 2) / input.widthPt }));
  const found = doorSymbols(input.segments, input.walls, input.feetPerUnit)
    .filter((d) => legend.length === 0 || !insideLegendBox({ x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2 }, legend))
    .filter((d) => d.widthFeet / d.leaves <= WIDEST_DOOR_LEAF_FEET)
    .filter((d) => !dims.some((p) => inSwing(d, p, input.feetPerUnit)));
  const copied = copiedIntoOtherViews(found, input.textPt, input.widthPt, input.feetPerUnit);
  const all = found.filter((d) => !copied.has(d));
  const existing = existingDoors({ doors: all, segments: input.segments, textPt: input.textPt, widthPt: input.widthPt, feetPerUnit: input.feetPerUnit, ...(input.existing === undefined ? {} : { evidence: input.existing }) });
  const aside = new Set(existing.map((e) => e.door));
  return { all, existing, doors: onlyMarkedDoors(all.filter((d) => !aside.has(d)), input.marks, input.feetPerUnit) };
}

/** The door marks a sheet prints, page-width units: every read symbol that is not a window tag. Shared with the door training rows (`productOpenings.ts`). */
export function doorMarkTexts(symbols: ReturnType<typeof tagSymbols>, widthPt: number): { text: string; x: number; y: number }[] {
  return symbols.filter((s) => s.rejected === null && !WINDOW_TAG.test(s.text.trim().toUpperCase())).map((s) => ({ text: s.text.trim().toUpperCase(), x: s.x / widthPt, y: s.y / widthPt }));
}

/** The window tags read in symbols on a sheet (W1, W2…), each once, in reading order of first appearance. */
export function windowTagsOnSheet(segmentsPt: readonly StrokeSegment[], textPt: readonly TextForSymbol[]): string[] {
  const symbols = tagSymbols({ segments: segmentsPt, text: textPt, unitsPerPaperInch: 72 });
  const tags = symbols.filter((s) => s.rejected === null && WINDOW_TAG.test(s.text.trim().toUpperCase())).map((s) => s.text.trim().toUpperCase());
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** A door schedule row as the ingest stores it (`PlanScheduleProposal.rows`). */
export type StoredScheduleRow = { mark: string; size?: string | null; description?: string | null };

export function scheduledOpenings(rows: readonly StoredScheduleRow[]): ScheduledOpening[] {
  return rows
    .filter((r) => typeof r.mark === "string" && r.mark.trim() !== "")
    .map((r) => {
      const { widthFt, heightFt } = widthAndHeight(r.size ?? null);
      return { mark: r.mark.trim(), widthFt, heightFt, description: r.description ?? null };
    });
}

export function doorsAndWindowsForSheet(input: {
  /** Strokes in page-width units (the finder's `inUnits`). */
  segments: readonly StrokeSegment[];
  /** The same strokes in page points, for the mark symbols. */
  segmentsPt: readonly StrokeSegment[];
  textPt: readonly TextForSymbol[];
  widthPt: number;
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  scheduleRows: readonly StoredScheduleRow[];
  /** The set's WINDOW schedule rows, when its ingest read one. */
  windowRows?: readonly StoredScheduleRow[];
  /** The set's wall legend codes, so a wall tag shaped like W4 is not read as a window. */
  wallCodes?: readonly string[];
  /** What the caller knows about existing work beyond the page: walls set aside, the demolition plan's doors. */
  existing?: ExistingDoorEvidence;
}): DoorsWindowsResult {
  const symbols = tagSymbols({ segments: input.segmentsPt, text: input.textPt, unitsPerPaperInch: 72 });
  const W = input.widthPt;
  const markTexts = doorMarkTexts(symbols, W);
  const { doors, existing } = doorsInScope({ segments: input.segments, walls: input.walls, feetPerUnit: input.feetPerUnit, textPt: input.textPt, widthPt: W, marks: markTexts, ...(input.existing === undefined ? {} : { existing: input.existing }) });
  const reach = DOOR_TAG_REACH_FEET / input.feetPerUnit;
  const markOfDoor = doors.map((d) => {
    const x = (d.hinge.x + d.strike.x) / 2, y = (d.hinge.y + d.strike.y) / 2;
    let best: { text: string; d: number } | null = null;
    for (const m of markTexts) {
      const dist = Math.hypot(m.x - x, m.y - y);
      if (dist <= reach && (best === null || dist < best.d)) best = { text: m.text, d: dist };
    }
    return best?.text ?? null;
  });
  const wTagged = symbols.filter((s) => s.rejected === null && WINDOW_TAG.test(s.text.trim().toUpperCase()));
  const tagWords = symbols.filter((s) => s.rejected === null).map((s) => s.text);
  // ── A SHEET TAGGED BY ITS WINDOW SCHEDULE TAGS EVERY WINDOW, AS W-NUMBERS DO ──
  // Topeka tags its windows A to F, the schedule's own marks, so the W-number
  // test never saw them: every frame had to sit on a wall the exterior test
  // accepts, and a courtyard plan's outside walls often read as inside — 15
  // of its 22 unread windows. The same vocabulary `windowsByTag` types with.
  const vocab = windowTagVocabulary(symbols, input.windowRows ?? [], input.wallCodes ?? []);
  const scheduleTagged = vocab.vocabulary === "schedule" ? symbols.filter(vocab.isTag) : [];
  const windowTags = [...new Set([...wTagged, ...scheduleTagged])].map((s) => ({ x: s.x / W, y: s.y / W }));
  const everyWindowTagged = tagsNameEveryWindow(tagWords) || scheduleTagged.length >= WINDOW_TAGS_MEAN_ALL;
  const byScheduleOnly = !tagsNameEveryWindow(tagWords) && scheduleTagged.length >= WINDOW_TAGS_MEAN_ALL;
  const windows = windowSymbols(input.segments, input.walls, input.feetPerUnit, windowTags, everyWindowTagged, byScheduleOnly);
  const tagged = windowsByTag({ symbols, widthPt: W, windowRows: input.windowRows ?? [], frames: windows, walls: input.walls, feetPerUnit: input.feetPerUnit, wallCodes: input.wallCodes ?? [] });
  const rows = scheduledOpenings(input.scheduleRows);
  if (rows.length === 0) return { doors, windows, join: null, unplacedMarks: [], tagged, doorMarks: markOfDoor, existingDoors: existing };
  const scheduled = new Set(rows.map((r) => r.mark.toUpperCase()));
  const marks: PlacedMark[] = symbols
    .filter((s) => s.rejected === null || (s.rejected === "sheet-reference" && scheduled.has(s.text.trim().toUpperCase())))
    .map((s) => ({ text: s.text, x: s.x / W, y: s.y / W, inSymbol: true }));
  // ── A MARK PRINTED LOOSE, OR IN A PILL THE SYMBOL PASS DOES NOT DRAW ──
  // Bunkie prints its door marks in rounded pills, which `tagSymbols` does
  // not see; E101 and E102 went unnamed for it. A text item that IS a
  // schedule mark, and sits in no symbol already read, is a mark too — the
  // schedule is the vocabulary, so a room number that happens to match a
  // row is the same risk the symbol marks already carry, and the join's
  // nearest-a-wall rule is what sorts the two.
  for (const item of input.textPt) {
    const text = item.str.trim();
    if (!scheduled.has(text.toUpperCase())) continue;
    const x = (item.x + item.width / 2) / W, y = (item.y - item.height / 2) / W;
    if (symbols.some((s) => Math.hypot(s.x / W - x, s.y / W - y) <= (s.radius / W) * 1.2)) continue;
    marks.push({ text, x, y, inSymbol: false });
  }
  const join = joinOpeningsToSchedule({
    openings: doors.map((d) => ({ x1: d.hinge.x, y1: d.hinge.y, x2: d.strike.x, y2: d.strike.y, widthFeet: d.widthFeet })),
    marks,
    rows,
    feetPerUnit: input.feetPerUnit,
    walls: input.walls,
  });
  const carried = new Set(join.openings.map((o) => (o.mark ?? "").trim().toUpperCase()));
  const unplacedMarks = [...new Set(rows.map((r) => r.mark.toUpperCase()))].filter((m) => !carried.has(m)).map((m) => rows.find((r) => r.mark.toUpperCase() === m)!.mark);
  return { doors, windows, join, unplacedMarks, tagged, doorMarks: markOfDoor, existingDoors: existing };
}

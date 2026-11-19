import { DOOR_TAG_REACH_FEET, type DoorSymbol } from "./doorWindowSymbols";
import { GREY_PEN, nicHatch, textRows, type TextItem } from "./existingWalls";
import { renovationMarks, showsExistingWork } from "./renovationMarks";
import { segmentGrid } from "./segmentGrid";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── AN EXISTING DOOR IS NOT A DOOR TO TAKE OFF ──
 *
 * Diego's call (2026-11-13), after the UCCS A2.1.2 audit: 19 of its 23 "false" found doors were
 * real doors in the building that stays (the existing restrooms N141 (E) / N142 (E) inside a
 * dashed boundary, two (E) corridor doors, a row along the hatched existing-scope edge), and they
 * outscored every new door. Walls already have an existing set-aside (`existingWalls.ts`, plan
 * comparison); found doors had none. A found door is SET ASIDE as existing, never dropped, when:
 *
 *   1. `wall`: it sits on a wall the product already set aside as existing by the sheet's own marks
 *      (the `existing` set-aside of `offeredCandidates`: a tag, the legend's pen, grey, a NIC hatch).
 *      NOT a wall plan comparison set aside: there the demolition plan is the witness for the door
 *      too (route 4). E Street A2.1's doors 1 and 6 are new openings cut into walls the comparison
 *      set aside, and the first cut of this rule lost them (the original's audit, 2026-11-13); the
 *      demolition plan draws no door within 7 ft of either;
 *   2. `area`: it is inside a HATCHED area labelled not in contract / existing (`nicHatch`, the
 *      wall rule's own reading), or inside a closed DASHED box with such a label in it;
 *   3. `tag`: its tag carries (E): a mark ending `(E)` (`N141 (E)`) or `EXISTING DOOR` within a
 *      leaf and a foot of it, or a bare `(E)` INSIDE its swing (UCCS's corridor doors). A bare `(E)`
 *      across the wall from the swing is the DIMENSION's, not the door's tag: E Street A2.1 prints
 *      `(E)` under the opening dimension of doors E-9 to E-11. Those doors are in fact existing (the
 *      paired demolition plan keys them C11.04, "existing wood door to remain"), and route 4 sets them
 *      aside when the sheet is paired; route 3 stays with the door's own tag, as Diego worded it;
 *   4. `demo`: the paired demolition plan draws a door in the same place on a wall it does not
 *      remove (`priorPlanFor`'s `doors`): existing to remain;
 *   5. `series`: its own mark (the nearest mark-shaped word, within the mark reach) is in a series
 *      the set calls existing: `E-9` where E Street's door schedule says DOORS WITH PREFIX "E" ARE
 *      EXISTING DOORS TO REMAIN. Round 22c's door line failed on exactly these: 12 E-numbered doors,
 *      printed tags and all, out of the key and scoring like perfect doors. A prefix counts only with
 *      support, never from its letter: a definition on the sheet or on the set's door schedule page
 *      (`existingPrefixes`), or a paired demolition plan that keeps most of the series' doors. An
 *      `E-` series with neither (an east wing's doors) is left alone;
 *   6. `grey`: its arc and leaf are drawn in the existing pen, the wall rule's route 3 for doors (Diego,
 *      2026-11-14): on a sheet whose words say it shows existing work, a door drawn mostly grey (at least
 *      `GREY_DOOR_SHARE` of its arc by length, at most `DARK_DOOR_SHARE` dark; `doorPen`) where most of the
 *      sheet's doors are drawn dark; on a sheet with no such words, only a door nearly all grey
 *      (`NO_WORDS_GREY_DOOR_SHARE`) where at least `NO_WORDS_DARK_DOORS` of the doors are dark. The 2020-09-24
 *      set's A1.1 draws an existing door open at 45 degrees in grey beside its existing-work keynotes.
 *
 * Pure. Positions in page-width units.
 */
export type ExistingDoor = { door: DoorSymbol; route: "wall" | "area" | "tag" | "demo" | "series" | "grey" | "nic"; why: string };

/** What a caller knows beyond the page itself. Both optional: without them routes 1 and 4 are silent. */
export type ExistingDoorEvidence = {
  /** Walls set aside as existing, page-width units; `legend` marks a framed legend box's lines instead (`doorsInScope`). */
  asideWalls?: readonly { x1: number; y1: number; x2: number; y2: number; thicknessFeet?: number; legend?: true }[];
  /** Doors the paired demolition plan keeps, moved onto this sheet. */
  priorDoors?: readonly { hinge: { x: number; y: number }; strike: { x: number; y: number } }[];
  /** The demolition plan's sheet number, for the sentence. */
  priorSheet?: string;
  /** Mark prefixes the set's door schedule page(s) define as existing (`existingPrefixes` over their text). */
  existingPrefixes?: readonly string[];
  /** Marks the set's door schedule lists under an EXISTING section (`existingScheduleMarks`), normalised (`normalMark`). */
  existingMarks?: readonly string[];
  /** A person chose to count this sheet's existing doors (`existingDoorsCounted.ts`): nothing is set aside. */
  counted?: boolean;
};

/** How far beyond a set-aside wall's face a door's leaf may sit and still be in it. */
export const ON_WALL_FEET = 0.75;
/** A demolition-plan door within this of a found one, at its middle, is the same door. */
export const SAME_DOOR_FEET = 1;
/** A dash: a short straight piece, on a line with others and gaps between. */
export const DASH_SHORTEST_FEET = 0.15;
export const DASH_LONGEST_FEET = 3;
export const DASH_GAP_FEET = 2.5;
export const DASHED_LINE_PIECES = 4;
/** A dashed box's sides end this close to the sides across from them (rounded corners). */
export const BOX_CORNER_FEET = 3;
export const BOX_LARGEST_FEET = 200;
/** Route 6: a door's arc and leaf grey by length at least this share, dark at most this, on a sheet showing existing work... */
export const GREY_DOOR_SHARE = 0.6;
export const DARK_DOOR_SHARE = 0.2;
/** ...or, with no renovation words, grey at least this share where at least this share of the sheet's doors are dark. */
export const NO_WORDS_GREY_DOOR_SHARE = 0.9;
export const NO_WORDS_DARK_DOORS = 0.75;
/** A door's own strokes: within this of its arc's circle, or of its open leaf. */
const ON_DOOR_FEET = 0.12;

/**
 * How much of a door's arc and open leaf, by length, is drawn grey and how much dark; null with no pen to read.
 * The arc is the circle of the leaf's radius about the hinge, between the strike and the open leaf; the leaf the
 * hinge-to-open radius. A stroke with no colour is black, as `existingMarks` reads it.
 *
 * ── THE PEN IS READ OFF THE ARC ALONE ── The arc is always the door's own stroke; a straight line from the
 * hinge may not be. UCCS A2.1.2's grey exterior doors are drawn open, and the finder's "open leaf" there is
 * the dark dashed boundary line along the jamb (it passes the leaf test), so leaf and arc together read 58%
 * grey for a door drawn entirely in the grey pen. The leaf counts only for a door with no arc stroke read.
 * An arc stroke is one with both ends on the circle, so a straight line crossing it does not count as arc.
 */
export function doorPen(d: DoorSymbol, segments: readonly StrokeSegment[], feetPerUnit: number): { grey: number; dark: number } | null {
  if (d.open === undefined) return null;
  const r = d.widthFeet / d.leaves / feetPerUnit, on = ON_DOOR_FEET / feetPerUnit;
  if (!(r > 0)) return null;
  const ang = (p: { x: number; y: number }) => Math.atan2(p.y - d.hinge.y, p.x - d.hinge.x);
  const a0 = ang(d.leaves === 2 ? { x: d.hinge.x + (d.strike.x - d.hinge.x) / 2, y: d.hinge.y + (d.strike.y - d.hinge.y) / 2 } : d.strike), a1 = ang(d.open);
  let span = a1 - a0;
  while (span > Math.PI) span -= 2 * Math.PI;
  while (span < -Math.PI) span += 2 * Math.PI;
  const within = (t: number) => { let u = t - a0; while (u > Math.PI) u -= 2 * Math.PI; while (u < -Math.PI) u += 2 * Math.PI; return span >= 0 ? u >= -0.05 && u <= span + 0.05 : u <= 0.05 && u >= span - 0.05; };
  const ux = (d.open.x - d.hinge.x) / r, uy = (d.open.y - d.hinge.y) / r;
  const arcPen = { grey: 0, dark: 0 }, leafPen = { grey: 0, dark: 0 };
  for (const i of segmentGrid(segments).near(d.hinge.x - r - on, d.hinge.y - r - on, d.hinge.x + r + on, d.hinge.y + r + on)) {
    const s = segments[i]!;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len === 0) continue;
    const m = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    // An arc stroke has BOTH ends on the circle; a long wall line can cross it with only its middle there
    // (UCCS A2.1.2's grey pair: two dark 8.3 ft jamb lines, each with its midpoint on the circle).
    const onCircle = (p: { x: number; y: number }) => Math.abs(Math.hypot(p.x - d.hinge.x, p.y - d.hinge.y) - r) <= on;
    const onArc = onCircle(m) && onCircle({ x: s.x1, y: s.y1 }) && onCircle({ x: s.x2, y: s.y2 }) && within(ang(m));
    const t = (m.x - d.hinge.x) * ux + (m.y - d.hinge.y) * uy, off = Math.abs(-(m.x - d.hinge.x) * uy + (m.y - d.hinge.y) * ux);
    const onLeaf = off <= on && t >= 0 && t <= r;
    if (!onArc && !onLeaf) continue;
    const pen = onArc ? arcPen : leafPen;
    if ((s.gray ?? 0) >= GREY_PEN) pen.grey += len;
    else pen.dark += len;
  }
  const { grey, dark } = arcPen.grey + arcPen.dark > 0 ? arcPen : leafPen;
  const total = grey + dark;
  return total === 0 ? null : { grey: grey / total, dark: dark / total };
}

/** Route 6b: the jambs of a grey door are this grey, by length, for the wall it stands in to read existing. */
export const GREY_JAMB_SHARE = 0.6;
/** How near the hinge or strike a stroke must come to be the jamb's, feet. */
export const JAMB_FEET = 1;

/**
 * The share of the strokes at a door's two jambs drawn grey, by length — the wall the door stands in, not the door:
 * within `JAMB_FEET` of the hinge or the strike, less the door's own arc and leaf. Null with nothing there.
 * Kirkland df9e0224 A100 draws its existing doors AND walls grey (3,013 ft at grey 0.5) and its new work black, but
 * most of its doors are the existing ones, so route 6's "most doors dark" never holds there.
 */
export function jambPen(d: DoorSymbol, segments: readonly StrokeSegment[], feetPerUnit: number): number | null {
  if (d.open === undefined) return null;
  const r = d.widthFeet / d.leaves / feetPerUnit, near = JAMB_FEET / feetPerUnit, on = ON_DOOR_FEET / feetPerUnit;
  const onCircle = (x: number, y: number) => Math.abs(Math.hypot(x - d.hinge.x, y - d.hinge.y) - r) <= on;
  const ux = (d.open.x - d.hinge.x) / r, uy = (d.open.y - d.hinge.y) / r;
  const onLeaf = (x: number, y: number) => { const t = (x - d.hinge.x) * ux + (y - d.hinge.y) * uy; return Math.abs(-(x - d.hinge.x) * uy + (y - d.hinge.y) * ux) <= on && t >= -on && t <= r + on; };
  let grey = 0, total = 0;
  const seen = new Set<number>();
  for (const at of [d.hinge, d.strike]) {
    for (const i of segmentGrid(segments).near(at.x - near, at.y - near, at.x + near, at.y + near)) {
      if (seen.has(i)) continue;
      const s = segments[i]!;
      if (toSegment(at, s).d > near) continue;
      seen.add(i);
      if (onCircle(s.x1, s.y1) && onCircle(s.x2, s.y2)) continue;
      if (onLeaf(s.x1, s.y1) && onLeaf(s.x2, s.y2)) continue;
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      total += len;
      if ((s.gray ?? 0) >= GREY_PEN) grey += len;
    }
  }
  return total === 0 ? null : grey / total;
}

/** A demolition plan supports a series when it keeps at least this many of its doors, and at least half. */
export const SERIES_KEPT_MIN = 2;

/** A short label that puts an area outside the new work. */
/** A point inside a single door's swing: half a leaf from the hinge, between the closed and open leaves. Null with no open leaf. */
function swingPoint(d: DoorSymbol, fpu: number): { x: number; y: number } | null {
  if (d.open === undefined) return null;
  const r = d.widthFeet / d.leaves / fpu;
  const ux = d.strike.x - d.hinge.x, uy = d.strike.y - d.hinge.y, vx = d.open.x - d.hinge.x, vy = d.open.y - d.hinge.y;
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return null;
  const bx = ux / lu + vx / lv, by = uy / lu + vy / lv, lb = Math.hypot(bx, by);
  return lb === 0 ? null : { x: d.hinge.x + (0.5 * r * bx) / lb, y: d.hinge.y + (0.5 * r * by) / lb };
}

/**
 * How many hatch strokes (nicHatch's reading: >= 2 ft long, 20-70 degrees) pass within 1 ft of a point. nicHatch's
 * 3 ft cells are coarser than a door, so they cannot tell a swing from the boundary wall it starts at.
 */
function hatchStrokesNear(segments: readonly StrokeSegment[], p: { x: number; y: number }, fpu: number): number {
  const reach = 1 / fpu;
  let n = 0;
  for (const i of segmentGrid(segments).near(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
    const s = segments[i]!;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
    if (len * fpu < 2) continue;
    const cos = Math.abs(dx) / len;
    if (cos < Math.cos((70 * Math.PI) / 180) || cos > Math.cos((20 * Math.PI) / 180)) continue;
    if (toSegment(p, s).d <= reach) n += 1;
  }
  return n;
}

/** A door mark as a schedule's MARK column prints it: E118, E-118, S104, 101, 102A. */
export const SCHEDULE_MARK = /^[A-Z]{0,2}-?\d{1,4}[A-Z]?$/;
/** A mark as compared: upper case, hyphens and spaces gone (E-118 = E118). */
export const normalMark = (m: string): string => m.toUpperCase().replace(/[\s-]+/g, "");
const EXISTING_SCHEDULE = /\bDOOR\b.*\bSCHEDULE\b.*\bEXIST(?:ING\b|\.)|\bEXISTING\b.*\bDOOR\b.*\bSCHEDULE\b/i;
/** A rehung door is new work even when the existing schedule lists it (Sedgwick's S104-S107: SALVAGE DOOR AND HARDWARE). */
const SALVAGE = /\b(?:SALVAGE[DS]?|RELOCATED?|REUSED?|REINSTALL(?:ED)?)\b/i;
/** A schedule cell that says existing on its own: NG-Lakewood A9.0's "(E)", Bluetooth's "EXST.". */
const EXISTING_CELL = /^(?:\(E\)|EXST\.?|EXIST\.?|EXISTING)$/i;
/** A row is the existing door's when at least this many of its cells say so on their own: its door AND its frame. */
export const EXISTING_CELLS_MIN = 2;

/**
 * The marks a set's door schedule lists under a section titled EXISTING ("DOOR & FRAME SCHEDULE - EXISTING",
 * Sedgwick County Courthouse Annex p63), less those its remarks salvage, relocate, reuse or reinstall. Each page is
 * its positioned text, page points. Empty when no schedule page has such a section: then nothing changes.
 */
export function existingScheduleMarks(pages: readonly (readonly TextItem[])[]): string[] {
  const out = new Set<string>();
  const IN = 72;
  for (const items of pages) {
    const rows = textRows(items);
    const headings = rows.filter((r) => /\bSCHEDULE\b/i.test(r.str));
    for (const h of rows.filter((r) => EXISTING_SCHEDULE.test(r.str))) {
      const markHead = rows.filter((r) => r.str.trim().toUpperCase() === "MARK" && r.y > h.y && r.y - h.y <= IN && Math.abs(r.x - h.x) <= 1.5 * IN).sort((a, b) => a.y - b.y)[0];
      const colX = markHead?.x ?? h.x, top = markHead?.y ?? h.y;
      const rightEdge = Math.min(...headings.filter((o) => o !== h && o.x > h.x + h.width / 2 && Math.abs(o.y - h.y) <= IN).map((o) => o.x), Infinity);
      const marks = rows.filter((r) => r.y > top && Math.abs(r.x - colX) <= 0.3 * IN && SCHEDULE_MARK.test(r.str.trim())).sort((a, b) => a.y - b.y);
      let prev = top;
      for (const m of marks) {
        if (m.y - prev > 0.5 * IN) break;
        prev = m.y;
        const remarks = rows.filter((r) => r !== m && Math.abs(r.y - m.y) <= 2 && r.x > m.x && r.x < rightEdge).map((r) => r.str).join(" ");
        if (!SALVAGE.test(remarks)) out.add(normalMark(m.str.trim()));
      }
    }
    // E1 (Diego, 2026-11-19): a row whose spec cells say existing on their own, door AND frame, with no section
    // heading to say so: NG-Lakewood A9.0's 500A "(E) (E) (E)...", Green Bay's 111A, UCCS's NE180B, Bluetooth's 318
    // "EXST.". Read along the mark's own baseline in the PDF's own text items: the joined-row reader splits
    // NG-Lakewood's cells off the mark's row and merges Bluetooth's five "EXST." (5 pt apart) into one string.
    for (const m of items.filter((r) => SCHEDULE_MARK.test(r.str.trim()))) {
      const line = items.filter((r) => r !== m && Math.abs(r.y - m.y) <= 2 && r.x > m.x && r.x - m.x <= 12 * IN);
      if (line.filter((r) => EXISTING_CELL.test(r.str.trim())).length >= EXISTING_CELLS_MIN && !line.some((r) => SALVAGE.test(r.str))) out.add(normalMark(m.str.trim()));
    }
  }
  return [...out].sort();
}

/** "NOT IN CONSTRUCTION" on one line (route 2). */
const NOT_IN_CONSTRUCTION = /^NOT\s+IN\s+CONSTRUCTION\b/i;
/**
 * "NOT IN" with CONSTRUCTION, CONTRACT or SCOPE one line below it at the same centre: the label stacked over two rows,
 * as Sedgwick A22.1 prints its "NOT IN / CONSTRUCTION" areas (4 of them). Read row by row, neither line says anything.
 */
function stackedNotIn(r: TextItem, rows: readonly TextItem[]): boolean {
  if (!/^NOT\s+IN$/i.test(r.str.trim())) return false;
  const cx = r.x + r.width / 2;
  return rows.some((s) => s !== r && /^(?:CONSTRUCTION|CONTRACT|SCOPE)\b/i.test(s.str.trim()) && Math.abs(s.x + s.width / 2 - cx) <= 72 && s.y > r.y && s.y - s.height - r.y <= 2 * Math.max(r.height, s.height));
}
const AREA_LABEL = /^(?:EXISTING\b|EXIST\.|\(E\)|NOT\s+IN\s+(?:CONTRACT|SCOPE)\b|N\.?\s?I\.?\s?C\.?\b|BY\s+OTHERS\b|NO\s+WORK\b)|\(E\)$/i;
/** A door's own tag saying it is existing: `N141 (E)`, `EXISTING DOOR`. A bare `(E)` must sit in the swing (`BARE_E`). */
const DOOR_TAG = /\S\s*\(E\)$|^EXIST(?:ING|\.|'G)?\s+DOOR\b/i;
/** A bare word in the swing: `(E)` (UCCS), or `EXIST.` / `EXIST` / `EXISTING` under the mark (Garden Square A100's 102B, 102C). */
const BARE_E = /^(?:\(E\)|EXIST(?:ING|\s*\.)?)$/i;

const mid = (d: { hinge: { x: number; y: number }; strike: { x: number; y: number } }) => ({ x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2 });

function toSegment(p: { x: number; y: number }, l: { x1: number; y1: number; x2: number; y2: number }): { d: number; t: number } {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1, L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / L2;
  const c = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p.x - (l.x1 + c * dx), p.y - (l.y1 + c * dy)), t };
}

/** Which side of the closed leaf (hinge to strike) the swing lies on: the side its open leaf ends on, or 0 unknown. */
export function swingSide(d: DoorSymbol): -1 | 0 | 1 {
  const lx = d.strike.x - d.hinge.x, ly = d.strike.y - d.hinge.y;
  if (d.open === undefined || (lx === 0 && ly === 0)) return 0;
  const v = (d.open.x - d.hinge.x) * -ly + (d.open.y - d.hinge.y) * lx;
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/**
 * The door-mark prefixes a text defines as existing: `DOORS WITH PREFIX "E" ARE EXISTING DOORS TO REMAIN`
 * (E Street p31), `PREFIX "E" INDICATES EXISTING`, `EX = EXISTING`. Each text is one page's words joined.
 */
export function existingPrefixes(texts: readonly string[]): string[] {
  const out = new Set<string>();
  const Q = `["\u201c\u201d']?`;
  const patterns = [
    new RegExp(`\\b(?:DOORS?|MARKS?|TAGS?|NUMBERS?|OPENINGS?)\\s+(?:WITH|HAVING|W/)\\s+(?:AN?\\s+|THE\\s+)?PREFIX\\s+${Q}([A-Z]{1,2})-?${Q}\\s+(?:ARE|IS|INDICATES?|DENOTES?|MEANS|=)\\s+(?:AN?\\s+)?EXIST`, "g"),
    new RegExp(`\\bPREFIX\\s+${Q}([A-Z]{1,2})-?${Q}\\s+(?:INDICATES?|DENOTES?|MEANS|=)\\s+(?:AN?\\s+)?EXIST`, "g"),
    new RegExp(`(?:^|\\s)${Q}([A-Z]{1,2})-?${Q}\\s*[=:]\\s*EXIST(?:ING|\\.)?\\b`, "g"),
  ];
  for (const text of texts) {
    const t = text.toUpperCase().replace(/\s+/g, " ");
    for (const re of patterns) for (const m of t.matchAll(re)) out.add(m[1]!);
  }
  return [...out].sort();
}

/** A door mark with a prefix (`E-9`, `E-14.1`) or a plain number (`6`, `12.1`); never a keynote (`E23.04`) or a room name. */
const PREFIXED_MARK = /^([A-Z]{1,2})-(\d{1,3}(?:\.\d)?[A-Z]?)$/;
const PLAIN_MARK = /^\d{1,3}(?:\.\d)?[A-Z]?$/;

type DashedLine = { at: number; a: number; b: number };

/** Horizontal and vertical dashed lines: at least `DASHED_LINE_PIECES` short pieces on one line, joined across short gaps. */
export function dashedLines(segments: readonly StrokeSegment[], feetPerUnit: number): { across: DashedLine[]; down: DashedLine[] } {
  const lo = DASH_SHORTEST_FEET / feetPerUnit, hi = DASH_LONGEST_FEET / feetPerUnit, gap = DASH_GAP_FEET / feetPerUnit, same = 0.15 / feetPerUnit;
  const pieces: { across: DashedLine[]; down: DashedLine[] } = { across: [], down: [] };
  for (const s of segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
    if (len < lo || len > hi) continue;
    if (Math.abs(dy) <= 0.035 * len) pieces.across.push({ at: (s.y1 + s.y2) / 2, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2) });
    else if (Math.abs(dx) <= 0.035 * len) pieces.down.push({ at: (s.x1 + s.x2) / 2, a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2) });
  }
  const join = (list: DashedLine[]): DashedLine[] => {
    list.sort((p, q) => p.at - q.at || p.a - q.a);
    const out: DashedLine[] = [];
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j + 1 < list.length && list[j + 1]!.at - list[i]!.at <= same) j += 1;
      const band = list.slice(i, j + 1).sort((p, q) => p.a - q.a);
      let run = [band[0]!];
      const close = () => {
        // A dashed line has gaps between its pieces; a solid line broken into touching pieces does not.
        const gaps = run.slice(1).filter((p, k) => p.a - run[k]!.b > 0.05 / feetPerUnit).length;
        if (run.length >= DASHED_LINE_PIECES && gaps >= 0.6 * (run.length - 1)) out.push({ at: run.reduce((n, p) => n + p.at, 0) / run.length, a: run[0]!.a, b: Math.max(...run.map((p) => p.b)) });
      };
      for (const p of band.slice(1)) {
        const end = Math.max(...run.map((q) => q.b));
        if (p.a - end <= gap) run.push(p);
        else { close(); run = [p]; }
      }
      close();
      i = j + 1;
    }
    return out;
  };
  return { across: join(pieces.across), down: join(pieces.down) };
}

/** The closed dashed box round a point, or null: the nearest dashed line on each side, whose ends meet at the corners. */
export function dashedBoxAround(p: { x: number; y: number }, lines: ReturnType<typeof dashedLines>, feetPerUnit: number): { x1: number; y1: number; x2: number; y2: number } | null {
  const corner = BOX_CORNER_FEET / feetPerUnit, largest = BOX_LARGEST_FEET / feetPerUnit;
  const pick = (list: DashedLine[], along: number, cross: number, below: boolean) =>
    list
      .filter((l) => l.a <= along && along <= l.b && (below ? l.at < cross : l.at > cross) && Math.abs(l.at - cross) <= largest)
      .sort((l, m) => Math.abs(l.at - cross) - Math.abs(m.at - cross))[0];
  const top = pick(lines.across, p.x, p.y, true), bottom = pick(lines.across, p.x, p.y, false);
  const left = pick(lines.down, p.y, p.x, true), right = pick(lines.down, p.y, p.x, false);
  if (!top || !bottom || !left || !right) return null;
  const meets = (l: DashedLine, from: number, to: number) => Math.abs(l.a - from) <= corner && Math.abs(l.b - to) <= corner;
  if (!meets(top, left.at, right.at) || !meets(bottom, left.at, right.at) || !meets(left, top.at, bottom.at) || !meets(right, top.at, bottom.at)) return null;
  return { x1: left.at, y1: top.at, x2: right.at, y2: bottom.at };
}

export function existingDoors(input: {
  doors: readonly DoorSymbol[];
  /** The page's strokes in page-width units. */
  segments: readonly StrokeSegment[];
  /** The page's words, page points, `y` at the baseline. */
  textPt: readonly TextItem[];
  widthPt: number;
  feetPerUnit: number;
  evidence?: ExistingDoorEvidence;
}): ExistingDoor[] {
  const { doors, segments, widthPt: W, feetPerUnit: fpu } = input;
  if (doors.length === 0 || !(W > 0) || !(fpu > 0) || input.evidence?.counted === true) return [];
  const rows = textRows(input.textPt).filter((r) => r.str.length <= 40);
  const centre = (r: TextItem) => ({ x: (r.x + r.width / 2) / W, y: (r.y - r.height / 2) / W });
  const out = new Map<DoorSymbol, ExistingDoor>();
  const set = (door: DoorSymbol, route: ExistingDoor["route"], why: string) => { if (!out.has(door)) out.set(door, { door, route, why }); };

  // 1. On a wall already set aside as existing.
  for (const w of input.evidence?.asideWalls ?? []) {
    if (w.legend) continue;
    const reach = ((w.thicknessFeet ?? 0.5) / 2 + ON_WALL_FEET) / fpu;
    for (const d of doors) {
      const { d: off, t } = toSegment(mid(d), w);
      if (off <= reach && t >= -0.02 && t <= 1.02) set(d, "wall", "on a wall set aside as existing");
    }
  }
  // 3. Its tag carries (E).
  for (const r of rows.filter((r) => DOOR_TAG.test(r.str))) {
    const at = centre(r);
    for (const d of doors) {
      if (Math.hypot(at.x - mid(d).x, at.y - mid(d).y) * fpu <= d.widthFeet + 1) set(d, "tag", `tagged "${r.str}"`);
    }
  }
  const bare = rows.filter((r) => BARE_E.test(r.str)).map((r) => ({ ...centre(r), str: r.str }));
  if (bare.length > 0) {
    for (const d of doors) {
      if (out.has(d)) continue;
      const r = d.widthFeet / d.leaves / fpu, lx = d.strike.x - d.hinge.x, ly = d.strike.y - d.hinge.y, L = Math.hypot(lx, ly);
      // A pair's word sits where its leaves meet, a leaf from either jamb (Garden Square A100's EXIST. pairs).
      const near = bare.filter((p) => Math.hypot(p.x - d.hinge.x, p.y - d.hinge.y) <= r || Math.hypot(p.x - d.strike.x, p.y - d.strike.y) <= r || (d.leaves === 2 && Math.hypot(p.x - mid(d).x, p.y - mid(d).y) <= r));
      if (near.length === 0 || L === 0) continue;
      const side = swingSide(d);
      if (side === 0) continue;
      // In the swing: on the arc's side of the closed leaf.
      const inSwing = near.find((p) => Math.sign((p.x - d.hinge.x) * (-ly / L) + (p.y - d.hinge.y) * (lx / L)) === side);
      if (inSwing) set(d, "tag", `"${inSwing.str}" printed inside its swing`);
    }
  }
  // 4. The paired demolition plan draws it and keeps it.
  const same = SAME_DOOR_FEET / fpu;
  for (const p of input.evidence?.priorDoors ?? []) {
    for (const d of doors) {
      if (Math.hypot(mid(p).x - mid(d).x, mid(p).y - mid(d).y) <= same) set(d, "demo", `drawn on ${input.evidence?.priorSheet ?? "the demolition plan"} and not removed — existing to remain`);
    }
  }
  // 5. Its mark is in a series the set calls existing.
  const marks = textRows(input.textPt).filter((r) => PREFIXED_MARK.test(r.str) || PLAIN_MARK.test(r.str)).map((r) => ({ str: r.str, at: centre(r) }));
  if (marks.some((m) => PREFIXED_MARK.test(m.str))) {
    const reach = DOOR_TAG_REACH_FEET / fpu;
    const series = new Map<string, { door: DoorSymbol; mark: string }[]>();
    for (const d of doors) {
      const own = marks.map((m) => ({ ...m, d: Math.hypot(m.at.x - mid(d).x, m.at.y - mid(d).y) })).filter((m) => m.d <= reach).sort((a, b) => a.d - b.d)[0];
      const prefix = own === undefined ? null : PREFIXED_MARK.exec(own.str)?.[1] ?? null;
      if (prefix !== null) (series.get(prefix) ?? series.set(prefix, []).get(prefix)!).push({ door: d, mark: own!.str });
    }
    const defined = new Set([...existingPrefixes([input.textPt.map((t) => t.str).join(" ")]), ...(input.evidence?.existingPrefixes ?? [])]);
    const prior = input.evidence?.priorDoors ?? [];
    for (const [prefix, list] of series) {
      const kept = list.filter((e) => prior.some((p) => Math.hypot(mid(p).x - mid(e.door).x, mid(p).y - mid(e.door).y) <= same)).length;
      const byPlan = prior.length > 0 && kept >= SERIES_KEPT_MIN && kept >= list.length / 2;
      if (!defined.has(prefix) && !byPlan) continue;
      const source = defined.has(prefix) ? `the set calls prefix "${prefix}" existing` : `${input.evidence?.priorSheet ?? "the demolition plan"} keeps ${kept} of the ${list.length} "${prefix}-" doors`;
      for (const e of list) set(e.door, "series", `tagged "${e.mark}": ${source}`);
    }
  }
  // 5b. Its own mark is one the door schedule lists under an EXISTING section (Sedgwick p63: E001 ... E229).
  const listed = new Set(input.evidence?.existingMarks ?? []);
  if (listed.size > 0) {
    const reach = DOOR_TAG_REACH_FEET / fpu;
    const tags = textRows(input.textPt).filter((r) => SCHEDULE_MARK.test(r.str.trim())).map((r) => ({ str: r.str.trim(), at: centre(r) }));
    for (const d of doors) {
      if (out.has(d)) continue;
      const own = tags.map((m) => ({ ...m, d: Math.hypot(m.at.x - mid(d).x, m.at.y - mid(d).y) })).filter((m) => m.d <= reach).sort((a, b) => a.d - b.d)[0];
      if (own !== undefined && listed.has(normalMark(own.str))) set(d, "series", `marked "${own.str}": the door schedule lists it as existing`);
    }
  }
  // 6. Drawn in the existing pen, where the sheet draws its doors dark.
  const pens = new Map(doors.map((d) => [d, doorPen(d, segments, fpu)] as const));
  const read = [...pens.values()].filter((p): p is { grey: number; dark: number } => p !== null);
  if (read.length > 0) {
    const darkDoors = read.filter((p) => p.dark >= 0.5).length / read.length;
    const words = showsExistingWork(renovationMarks(input.textPt.map((t) => t.str).join(" ")));
    for (const d of doors) {
      const p = pens.get(d);
      if (p === null || p === undefined) continue;
      const grey = words ? darkDoors > 0.5 && p.grey >= GREY_DOOR_SHARE && p.dark <= DARK_DOOR_SHARE : darkDoors >= NO_WORDS_DARK_DOORS && p.grey >= NO_WORDS_GREY_DOOR_SHARE;
      if (grey) set(d, "grey", words ? "drawn grey where the sheet draws its doors dark, on a sheet that shows existing work" : "drawn grey where the sheet draws nearly all its doors dark");
    }
    // 6b. Drawn grey in a grey wall, where the sheet draws new doors dark — whatever most doors are drawn in.
    if (words && read.some((p) => p.dark >= 0.5)) {
      for (const d of doors) {
        const p = pens.get(d);
        if (out.has(d) || p === null || p === undefined || p.grey < GREY_DOOR_SHARE || p.dark > DARK_DOOR_SHARE) continue;
        const j = jambPen(d, segments, fpu);
        if (j !== null && j >= GREY_JAMB_SHARE) set(d, "grey", "drawn grey in a grey wall, where the sheet draws its new doors dark");
      }
    }
  }
  // 2. Inside a hatched or dashed area labelled existing or not in contract.
  const labels = rows.filter((r) => AREA_LABEL.test(r.str) || NOT_IN_CONSTRUCTION.test(r.str) || stackedNotIn(r, rows));
  if (labels.length > 0 && doors.some((d) => !out.has(d))) {
    const hatch = nicHatch(segments, labels.map(centre), fpu);
    // The opening AND the swing inside the hatch: a door in the hatched area's boundary wall that swings out of it is
    // new work (Sedgwick A22.1's 201, from the NOT IN CONSTRUCTION restrooms' wall into Stair 007).
    if (hatch !== null) for (const d of doors) { const q = swingPoint(d, fpu); if (hatch(mid(d).x, mid(d).y) && (q === null || hatchStrokesNear(segments, q, fpu) >= 2)) set(d, "area", "inside a hatched area labelled existing or not in contract"); }
    const lines = dashedLines(segments, fpu);
    for (const r of labels) {
      const box = dashedBoxAround(centre(r), lines, fpu);
      if (box === null) continue;
      for (const d of doors) {
        const m = mid(d);
        if (m.x >= box.x1 && m.x <= box.x2 && m.y >= box.y1 && m.y <= box.y2) set(d, "area", `inside the dashed boundary round "${r.str}"`);
      }
    }
  }
  // 7. Standing on the grey the sheet calls not in contract, read in paint order.
  if (doors.some((d) => !out.has(d))) {
    const nic = nicGround(segments, input.textPt, W, fpu);
    if (nic !== null) for (const d of doors) if (!out.has(d) && nic(d)) set(d, "nic", "inside the grey the sheet calls not in contract");
  }
  return doors.filter((d) => out.has(d)).map((d) => out.get(d)!);
}

/** A filled path: its edges, its grey, its place in paint order (`StrokeSegment.path`). */
type Fill = { path: number; gray: number; edges: StrokeSegment[]; x1: number; y1: number; x2: number; y2: number };

/** The sheet's filled paths, from their edges, latest painted first. */
export function fillsOf(segments: readonly StrokeSegment[]): Fill[] {
  const by = new Map<number, Fill>();
  for (const s of segments) {
    if (s.path === undefined || s.fill === undefined) continue;
    const f = by.get(s.path) ?? by.set(s.path, { path: s.path, gray: s.fill, edges: [], x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }).get(s.path)!;
    f.edges.push(s);
    f.x1 = Math.min(f.x1, s.x1, s.x2); f.x2 = Math.max(f.x2, s.x1, s.x2);
    f.y1 = Math.min(f.y1, s.y1, s.y2); f.y2 = Math.max(f.y2, s.y1, s.y2);
  }
  return [...by.values()].sort((a, b) => b.path - a.path);
}

/** Even-odd: whether `p` is inside the region a fill's edges bound. */
function insideFill(f: Fill, p: { x: number; y: number }): boolean {
  if (p.x < f.x1 || p.x > f.x2 || p.y < f.y1 || p.y > f.y2) return false;
  let inside = false;
  for (const e of f.edges) {
    if ((e.y1 > p.y) !== (e.y2 > p.y) && e.x1 + ((p.y - e.y1) * (e.x2 - e.x1)) / (e.y2 - e.y1) > p.x) inside = !inside;
  }
  return inside;
}

/** What a reader sees at `p`: the last-painted fill containing it, of those given (latest first), or null for bare paper. */
export function visibleGround(fills: readonly Fill[], p: { x: number; y: number }): Fill | null {
  for (const f of fills) if (insideFill(f, p)) return f;
  return null;
}

/** "NOT IN CONTRACT", "NOT IN SCOPE", "NOT IN CONSTRUCTION", "NO WORK", "N.I.C." anywhere in a line, not inside a word (CLINIC, PANIC). Aldrich A111's swatch reads "EXISTING SCHOOL, NO WORK". */
export const NIC_PHRASE = /(?:^|[^A-Z])(?:NOT\s+IN\s+(?:CONTRACT|SCOPE|CONSTRUCTION)|NO\s+WORK|N\.?\s?I\.?\s?C\.?)(?![A-Z])/i;
/** A grey a reader reads as a tone: neither near black (poché) nor near white (paper). */
export const NIC_GREY_MIN = 0.35;
export const NIC_GREY_MAX = 0.95;
/** How close a plan's grey must be to an N.I.C. grey: NW C35NW's swatch is 0.80 and its plan area 0.757. */
export const NIC_GREY_TOLERANCE = 0.08;
/** A fill smaller than this, sq ft, is a door leaf, a symbol or a text mask, never the ground a door stands on. */
export const GROUND_MIN_SQ_FEET = 4;
/** Route 7's ring: this many points, this many leaf widths round the opening's middle. */
export const NIC_RING_POINTS = 8;
export const NIC_RING_LEAVES = 1.5;
/** A legend swatch on paper, inches: at most this on each side, and its label within this of it. */
export const SWATCH_MAX_INCHES = 1.5;
export const SWATCH_MIN_INCHES = 0.1;

/**
 * Route 7's reading: whether a door stands on the grey the sheet calls not in contract. The greys are the legend
 * swatch an N.I.C. phrase labels (the text beside it on the same line, as a legend row reads) and the ground under an
 * N.I.C. phrase printed in the plan. The ground is what is painted LAST at a point (NW C35NW's one grey rectangle
 * with new work painted white over it), read on a ring round the door, so only a door well inside the area goes,
 * never one in its boundary wall. Null when the sheet names no N.I.C. grey. Measured 2026-11-18: NW's false doors
 * 10 -> 3 (its exterior-wall doors stay), no real door lost on training or the retired pool.
 */
export function nicGround(segments: readonly StrokeSegment[], textPt: readonly TextItem[], W: number, fpu: number): ((d: DoorSymbol) => boolean) | null {
  const rows = textRows(textPt);
  const nicRows = rows.filter((r) => NIC_PHRASE.test(r.str));
  if (nicRows.length === 0) return null;
  const fills = fillsOf(segments);
  if (fills.length === 0) return null;
  const ground = fills.filter((f) => (f.x2 - f.x1) * (f.y2 - f.y1) * fpu * fpu >= GROUND_MIN_SQ_FEET);
  const isGrey = (g: number) => g >= NIC_GREY_MIN && g <= NIC_GREY_MAX;
  const greys: number[] = [];
  const max = (SWATCH_MAX_INCHES * 72) / W, min = (SWATCH_MIN_INCHES * 72) / W;
  for (const f of fills) {
    const w = f.x2 - f.x1, h = f.y2 - f.y1;
    if (!isGrey(f.gray) || w > max || h > max || w < min || h < min) continue;
    // Its label is the text to its RIGHT on the same line, as a legend row reads (NW C35NW: the legend's title
    // above the swatch is nearer than its own "N.I.C" beside it).
    const top = f.y1 * W - 7.2, bottom = f.y2 * W + 7.2, right = f.x2 * W;
    let best: { gap: number; str: string } | null = null;
    for (const r of rows) {
      if (r.y < top || r.y - r.height > bottom || r.x < right - 3.6) continue;
      const gap = Math.max(0, r.x - right);
      if (gap <= SWATCH_MAX_INCHES * 72 && (best === null || gap < best.gap)) best = { gap, str: r.str };
    }
    if (best !== null && NIC_PHRASE.test(best.str)) greys.push(f.gray);
  }
  for (const r of nicRows) {
    const g = visibleGround(ground, { x: (r.x + r.width / 2) / W, y: (r.y - r.height / 2) / W });
    if (g !== null && isGrey(g.gray)) greys.push(g.gray);
  }
  if (greys.length === 0) return null;
  return (d) => {
    // A RING of points 1.5 leaf widths round the opening's middle, all on the N.I.C. grey: the door stands well inside
    // the area, not in its boundary wall (HPL I-110's keyed door into the N.I.C. area, Appendix 5B's 421 beside the
    // stair tone). It does not depend on which leaf the finder took for the closed one.
    const w = d.widthFeet / fpu, R = NIC_RING_LEAVES * w;
    const cx = (d.hinge.x + d.strike.x) / 2, cy = (d.hinge.y + d.strike.y) / 2;
    for (let k = 0; k < NIC_RING_POINTS; k++) {
      const a = (2 * Math.PI * k) / NIC_RING_POINTS;
      const g = visibleGround(ground, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
      if (g === null || !isGrey(g.gray) || !greys.some((n) => Math.abs(n - g.gray) <= NIC_GREY_TOLERANCE)) return false;
    }
    return true;
  };
}

/**
 * The walls `offeredCandidates` set aside as existing by the sheet's own marks, for route 1. Never the
 * `on-prior-plan` ones: a new door cut into a wall the demolition plan keeps is new work, and the
 * demolition plan says which doors stay (route 4).
 */
export function asideExistingWalls(lines: readonly { kind: string; x1: number; y1: number; x2: number; y2: number }[]): NonNullable<ExistingDoorEvidence["asideWalls"]> {
  return [
    ...lines.filter((l) => l.kind === "existing").map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
    // A framed legend's lines ride along, so every door path drops the legend's door SAMPLES (`insideLegendBox`).
    ...lines.filter((l) => l.kind === "legend-box").map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2, legend: true as const })),
  ];
}

/**
 * ── A DOOR INSIDE A FRAMED LEGEND IS A SAMPLE, NOT A DOOR ──
 * Joplin A-101's FLOOR PLAN LEGEND draws "NEW DOOR" as a real swing with a door tag (101), and it scored as
 * the sheet's best door. The wall side already sets the frame aside whole (`legendBoxes.ts`, kind `legend-box`);
 * a point is inside it when that frame's lines bound it on at least three sides. Three, not four: a frame's top
 * rule under its title is often taken first as the title's underline (Joplin's is), so only three sides come
 * through as `legend-box`. Legend-box lines exist only round a framed, titled block, so three of them round a
 * point is the block; two (an L) is not.
 */
export function insideLegendBox(p: { x: number; y: number }, lines: readonly { x1: number; y1: number; x2: number; y2: number }[]): boolean {
  const spans = (a: number, b: number, v: number) => Math.min(a, b) <= v && v <= Math.max(a, b);
  const across = lines.filter((l) => Math.abs(l.y2 - l.y1) <= 0.1 * Math.abs(l.x2 - l.x1) && spans(l.x1, l.x2, p.x));
  const down = lines.filter((l) => Math.abs(l.x2 - l.x1) <= 0.1 * Math.abs(l.y2 - l.y1) && spans(l.y1, l.y2, p.y));
  const sides = [across.some((l) => (l.y1 + l.y2) / 2 < p.y), across.some((l) => (l.y1 + l.y2) / 2 > p.y), down.some((l) => (l.x1 + l.x2) / 2 < p.x), down.some((l) => (l.x1 + l.x2) / 2 > p.x)];
  return sides.filter(Boolean).length >= 3;
}

/** One sentence for the panel. */
export function existingDoorsSentence(list: readonly ExistingDoor[]): string {
  const n = (route: ExistingDoor["route"]) => list.filter((e) => e.route === route).length;
  const parts = [
    n("wall") > 0 ? `${n("wall")} on a wall set aside as existing` : "",
    n("area") > 0 ? `${n("area")} inside an area marked existing or not in contract` : "",
    n("tag") > 0 ? `${n("tag")} tagged (E)` : "",
    n("demo") > 0 ? `${n("demo")} kept on the demolition plan` : "",
    n("series") > 0 ? `${n("series")} in a door series the set calls existing` : "",
    n("grey") > 0 ? `${n("grey")} drawn in the existing (grey) pen` : "",
  ].filter((s) => s !== "");
  return `${list.length} existing door${list.length === 1 ? "" : "s"} set aside: ${parts.join("; ")}`;
}

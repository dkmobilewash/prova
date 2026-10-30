import type { StrokeSegment } from "./wallVectors";

/**
 * ── WHAT A SHEET SAYS ABOUT ITS EXISTING WALLS, READ OFF ITS OWN WORDS ──
 *
 * Diego's rule (2026-10-30): an existing wall that remains is NOT WALL on
 * every answer key, and the finder should set it aside rather than offer it.
 * Grey alone is not enough to call a line existing — Supreme Court's A111
 * draws EXISTING CONSTRUCTION in black and Camp Bow Wow draws new work in
 * grey — so the set-aside needs what THIS sheet uses, and the sheet says so
 * in three places, all text:
 *
 *   1. its FLOOR PLAN LEGEND: "EXISTING WALL TO REMAIN" beside a swatch,
 *      "NEW WALL" beside another, "AREA NOT IN CONTRACT" beside a third
 *      (Murray A101, Supreme Court A111, HPL p3, Bunkie A100, Joplin A-101).
 *      The swatch is the sheet's own pen for that kind, so it is sampled:
 *      how many strokes, how grey, how short the pieces, how many diagonal.
 *   2. a CONVENTION: "(E)" before a label — "(E) OFFICE", "(E) DEMISING" —
 *      or an abbreviation the sheet defines, glen-hazel's "EX = EXISTING
 *      TO REMAIN".
 *   3. LABELS on the drawing: "N.I.C.", "JAIL (NO WORK)", "NIC, TYP ALL",
 *      "(E) DEMISING … TO REMAIN", which mark an area or a wall in place.
 *
 * Measured on the eighteen marked TRAINING sheets of 2026-10-30 (the
 * `existingMarks.eval.ts` run in NOTES-wall-types.md §4). What was learned
 * and is built in: the swatch sits to the LEFT of the words and is
 * self-contained, so a plan line running past a label does not count as a
 * swatch; and keynote sentences ("PATCH ALL HOLES IN EXISTING SURFACES…")
 * outnumber legend entries ten to one, so only SHORT labels qualify.
 *
 * Deterministic and model-free, which is the half Diego asked for first.
 * The model legend read (`wallLegend.ts`) does not carry an existing entry
 * yet; when it does, it should return this shape so the consumer is one.
 *
 * Positions are in PAGE-WIDTH UNITS, as `wallTags.ts` reports tags; swatch
 * pieces are in INCHES OF PAPER, because a legend symbol is drawn at paper
 * scale and means the same thing at 1/8" and at 1/4".
 */

export type PageTextItem = { str: string; x: number; y: number; width: number; height: number };

export type ExistingKind = "EXISTING" | "NEW" | "NIC" | "DEMO";

/** The strokes drawn in a legend entry's swatch, summarised. */
export type SwatchPen = {
  strokes: number;
  /** 0 black … 1 white; an unset colour is black. */
  grayMedian: number;
  medianPieceIn: number;
  longestPieceIn: number;
  /** Share of strokes between 20° and 70° off the axes — a hatch. */
  diagonalShare: number;
  widthMaxPt: number;
  grey: boolean;
  dashed: boolean;
  hatched: boolean;
};

export type LegendEntry = {
  kind: ExistingKind;
  words: string;
  /** Centre of the words, page-width units. */
  x: number;
  y: number;
  swatch: SwatchPen;
};

export type ExistingTag = {
  kind: "EXISTING" | "NIC";
  words: string;
  x: number;
  y: number;
  /** The words' box, page-width units — a NIC label marks the area around it. */
  widthU: number;
  heightU: number;
};

export type ExistingMarks = {
  legend: LegendEntry[];
  /** Tokens the sheet defines as existing — "EX" from "EX = EXISTING TO REMAIN"; "(E)" is always one. */
  tokens: string[];
  tags: ExistingTag[];
};

export const SWATCH_REACH_IN = 1.5;
export const SWATCH_MIN_STROKES = 2;
export const SWATCH_CONFINED_SHARE = 0.6;
export const GREY_PEN = 0.3;
export const HATCH_SHARE = 0.25;
export const DASH_MAX_PIECE_IN = 0.12;
export const DASH_MAX_STROKES = 16;
export const SHORT_LABEL_CHARS = 48;
export const SWATCH_MIN_EXTENT_IN = 0.35;
export const SWATCH_RING_IN = 0.3;
export const SWATCH_RING_MAX_STROKES = 3;
export const SHORT_LABEL_WORDS = 6;
/** "(E) DEMISING", "EX", "PARTITION TO REMAIN": a tag; "EXISTING MASONRY OPENING DIMENSIONS MAY" is a note. */
export const EXISTING_TAG_WORDS = 4;

const WALL_WORDS = "(?:WALLS?|(?<!TOILET )PARTITIONS?|CONSTRUCTION|BUILDING|STRUCTURE|DEMISING)";
/** A legend row starts with its subject; a keynote fragment ("FOR THE NEW BUILDING.") does not, and ends with a stop. */
const ENTRY_START = /^(?:\(E\)|EXIST|NEW\b|AREA\b|NOT\b|N\.?\s?I\.?\s?C\b|NO\s+WORK|LIMITS?\b|WALLS?\b|PARTITIONS?\b|DEMO|REMOV|CONSTRUCTION|INTERIOR|EXTERIOR)/i;
/** An EXISTING label about one of these is about that thing, not a wall. */
const NOT_WALL = /\b(?:DOORS?|WINDOWS?|FLOORS?|FLOORING|CEILINGS?|LINTELS?|SILLS?|METERS?|BOX|FRAMES?|EQUIPMENT|FIXTURES?|SIDEWALK|TILE|MIRROR|STACKS?|GRID|POWER|CYLINDERS?|HVAC|FENCE|ROOF(?:ING)?|SHEATHING|PLYWOOD|TRIM|CABINET|COUNTER|SHELV|CONDUIT|PIPING|DUCT|LIGHT|SIGN|CURB|PAVING|RIGID|INSUL|GYP|BD\.|STUD|FURR)\b/i;
// "(E)" gets no \b: a parenthesis is not a word character, so \b\(E\) never matches at the start of a label.
const EXISTING_WORD = "(?:\\bEXIST(?:ING|'?G|\\.)?\\b|\\(E\\))";
const ENTRY_EXISTING = new RegExp(`${EXISTING_WORD}.*\\b${WALL_WORDS}\\b|\\b${WALL_WORDS}\\b.*\\bTO\\s+REMAIN\\b`, "i");
const ENTRY_NEW = new RegExp(`\\bNEW\\b.*\\b${WALL_WORDS}\\b`, "i");
const ENTRY_DEMO = new RegExp(`\\b(?:DEMO(?:LISH(?:ED)?)?|REMOVED?)\\b.*\\b${WALL_WORDS}\\b|\\b${WALL_WORDS}\\b.*\\bTO\\s+BE\\s+(?:REMOVED|DEMOLISHED)\\b`, "i");
const NIC = /NOT\s+IN\s+(?:THIS\s+)?CONTRACT|\bN\.?\s?I\.?\s?C\.?(?=\W|$)|\bNO\s+WORK\b|\bLIMITS?\s+OF\s+WORK\b|\bAREA\s+OF\s+WORK\b|\bNOT\s+IN\s+SCOPE\b/i;
const DEFINES = /^\(?([A-Z]{1,3})\)?\s*[=:–-]\s*EXIST/i;
const TO_REMAIN = /\bTO\s+REMAIN\b/i;

const isShort = (s: string) => s.length <= SHORT_LABEL_CHARS && s.split(/\s+/).length <= SHORT_LABEL_WORDS;

/** Which legend kind a short label names, else null. DEMO before EXISTING: "REMOVE EXISTING WALL" is a removal. */
export function entryKind(words: string): ExistingKind | null {
  // A full stop after three or more words is a sentence, not a row; "N.I.C." is a row.
  if (!isShort(words) || !ENTRY_START.test(words) || (/\.$/.test(words) && words.split(/\s+/).length >= 3)) return null;
  if (ENTRY_DEMO.test(words)) return "DEMO";
  if (NIC.test(words)) return "NIC";
  if (ENTRY_EXISTING.test(words)) return "EXISTING";
  if (ENTRY_NEW.test(words)) return "NEW";
  return null;
}

function penOf(pieces: readonly StrokeSegment[]): SwatchPen {
  const lens = pieces.map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 72).sort((a, b) => a - b);
  const grays = pieces.map((s) => s.gray ?? 0).sort((a, b) => a - b);
  const diagonal = pieces.filter((s) => {
    const a = (Math.abs(Math.atan2(s.y2 - s.y1, s.x2 - s.x1)) * 180) / Math.PI;
    const off = a > 90 ? 180 - a : a;
    return off > 20 && off < 70;
  }).length;
  const n = pieces.length;
  const diagonalShare = n === 0 ? 0 : diagonal / n;
  const medianPieceIn = n === 0 ? 0 : lens[n >> 1];
  const hatched = n >= 3 && diagonalShare >= HATCH_SHARE;
  return {
    strokes: n,
    grayMedian: n === 0 ? 0 : grays[n >> 1],
    medianPieceIn,
    longestPieceIn: n === 0 ? 0 : lens[n - 1],
    diagonalShare,
    widthMaxPt: pieces.reduce((m, s) => Math.max(m, s.width ?? 0), 0),
    grey: n > 0 && grays[n >> 1] >= GREY_PEN,
    // ponytail: "many short axis-aligned pieces" is a dash; a stipple fill
    // of 40 dots reads the same, hence the stroke ceiling. Count gaps along
    // one line if a legend ever needs it.
    dashed: !hatched && n >= 4 && n <= DASH_MAX_STROKES && medianPieceIn <= DASH_MAX_PIECE_IN && diagonalShare <= 0.1,
    hatched,
  };
}

/** The strokes wholly inside the swatch box to the left of a label, or null when there is no swatch there. */
function swatchLeftOf(item: PageTextItem, segments: readonly StrokeSegment[]): SwatchPen | null {
  const h = Math.max(item.height, 4);
  const x0 = item.x - SWATCH_REACH_IN * 72, x1 = item.x - 1;
  const y0 = item.y - 1.5 * h, y1 = item.y + 0.8 * h;
  const inBox = (x: number, y: number, slack: number) => x >= x0 - slack && x <= x1 + slack && y >= y0 - slack && y <= y1 + slack;
  const touching = segments.filter((s) => inBox((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, 0));
  if (touching.length < SWATCH_MIN_STROKES) return null;
  const confined = touching.filter((s) => inBox(s.x1, s.y1, 2) && inBox(s.x2, s.y2, 2));
  if (confined.length < SWATCH_MIN_STROKES || confined.length / touching.length < SWATCH_CONFINED_SHARE) return null;
  // A sample spans its box; three grey ticks of a room outline do not.
  const xs = confined.flatMap((s) => [s.x1, s.x2]);
  if ((Math.max(...xs) - Math.min(...xs)) / 72 < SWATCH_MIN_EXTENT_IN) return null;
  // And it stands alone: a label inside a hatched NIC area has confined
  // pieces too, but the hatch goes on to its left, where a legend has margin.
  const ring = SWATCH_RING_IN * 72;
  const left = segments.filter((s) => { const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2; return mx >= x0 - ring && mx < x0 && my >= y0 && my <= y1; });
  // Relative, because a hatched NEW swatch of thirty pieces may have a
  // neighbouring symbol's few pieces beside it, while a field of hatch has
  // as many to the left as inside.
  if (left.length > Math.max(SWATCH_RING_MAX_STROKES, confined.length / 4)) return null;
  return penOf(confined);
}

/**
 * The sheet's existing-wall marks. `segments` are the page's strokes in
 * POINTS, as `textItems` are; pass none to read the words alone.
 */
export function existingMarks(input: {
  textItems: readonly PageTextItem[];
  segments?: readonly StrokeSegment[];
  widthPt: number;
}): ExistingMarks {
  const { widthPt } = input;
  const segments = input.segments ?? [];
  const out: ExistingMarks = { legend: [], tokens: ["(E)"], tags: [] };
  if (!(widthPt > 0)) return out;
  const items = input.textItems.map((i) => ({ ...i, str: i.str.replace(/\s+/g, " ").trim() })).filter((i) => i.str !== "");

  for (const i of items) {
    const m = DEFINES.exec(i.str);
    if (m && !out.tokens.includes(m[1].toUpperCase())) out.tokens.push(m[1].toUpperCase());
  }
  const tokenStart = new RegExp(`^(?:${out.tokens.map((t) => t.replace(/[()]/g, "\\$&")).join("|")})(?=\\W|$)`, "i");

  for (const i of items) {
    const words = i.str;
    const x = (i.x + i.width / 2) / widthPt;
    const y = i.y / widthPt;
    const kind = entryKind(words);
    if (kind !== null) {
      const swatch = swatchLeftOf(i, segments);
      if (swatch !== null) {
        out.legend.push({ kind, words, x, y, swatch });
        continue;
      }
    }
    if (!isShort(words) || DEFINES.test(words)) continue;
    const tag: ExistingTag["kind"] | null = NIC.test(words)
      ? "NIC"
      : (tokenStart.test(words) || /^EXIST(?:ING|'?G|\.)?\b/i.test(words) || TO_REMAIN.test(words)) && !NOT_WALL.test(words) && words.split(/\s+/).length <= EXISTING_TAG_WORDS
        ? "EXISTING"
        : null;
    if (tag === null) continue;
    out.tags.push({ kind: tag, words, x, y, widthU: i.width / widthPt, heightU: i.height / widthPt });
  }
  return out;
}

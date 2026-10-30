import { takeoffRank } from "./sheetSuitability";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── A DRAWING'S TITLE IS DRAWN BIG AND RULED, WHETHER OR NOT A SCALE FOLLOWS ──
 *
 * `sheetViews` finds a view by its caption AND a printed scale beneath it, and
 * the step-1 measurement (2026-10-21, `zzViewCaptions.eval.ts`) showed why
 * that reports ONE view on sixteen of eighteen training sheets: 274 caption-
 * like strings, 31 printed scales, 32 views. Most sheets print one scale, in
 * the title block, and the detector can never find more views than scales.
 *
 * The convention that survives without a scale is typographic. A view title
 * is lettered LARGER than the sheet's notes and has a RULE drawn under it.
 * Measured on the same sheets: text at >= 1.4x the sheet's median height
 * gives 53 titles with a plausible per-sheet spread (Camp Bow Wow 9, Murray
 * 7, SW 4), and 48 of those 53 are also underlined. Either half alone is not
 * a signal — Camp Bow Wow A101 carries 65,512 horizontal strokes, so a stroke
 * under a piece of text is a coincidence there and 10 of 10 captions scored
 * underlined; and a big string with no rule is as likely a room name or a
 * sheet title. The CONJUNCTION is what this reads.
 *
 * ── THREE ELEVEN03 SHEETS HAVE NO BIG TITLE AT ALL ──
 *
 * Their titles are set at the notes' size, so this finds nothing on them, and
 * each is a single-plan sheet the caption route already reads. So a finder
 * that finds no titles must FALL BACK rather than filter everything away —
 * `sheetDrawings` in `sheetViews.ts` unions this with the caption route for
 * that reason, and a sheet with no titles and no captions is measured whole,
 * exactly as today.
 */

/** How much larger than the sheet's median text a title is lettered. */
export const TITLE_SIZE_RATIO = 1.4;

/**
 * How far below a title's baseline its rule may sit, in page-width units.
 * The step-1 probe's 0.018, kept: a rule is one line-gap under the lettering.
 */
const RULE_BELOW = 0.018;

/** A rule is horizontal: its rise is at most 2% of its run. */
const RULE_SLOPE = 0.02;

/**
 * Two text items on one baseline closer than this many text-heights apart are
 * one title — "FLOOR" and "PLAN" come out of a PDF as two items as often as
 * one, and a view bubble's number sits on the same line a little further off.
 */
const SAME_TITLE_GAP_HEIGHTS = 1.5;

/** The share of a title's own width its rule must cover. */
const RULE_COVER = 0.5;

/**
 * And no more than this many times the title's width: a rule is drawn FOR the
 * title, so it is about as long. A 600pt line of drawing work passing under a
 * 60pt word is the "needle that cannot fail to be found" the step-1 probe
 * warned about, and this is what refuses it.
 */
const RULE_OVERRUN = 3;

export type ViewClass =
  | "text-block"
  | "floor-plan"
  | "enlarged-plan"
  | "rcp"
  | "roof"
  | "elevation"
  | "section"
  | "detail"
  | "site"
  | "key-plan"
  | "other-plan"
  | "not-a-plan"
  | "unknown";

/**
 * What kind of drawing a title names, for the report and the caution.
 *
 * Built on `takeoffRank`'s own sentences rather than a second word list — the
 * CLAUDE.md rate-list scar. Whether a view is MEASURED is still `viewKind`'s
 * call; this only names the kind in the estimator's vocabulary.
 */
/**
 * A heading over words, not a drawing: a legend, a notes column, a keynote
 * list, a wall-types table. "FLOOR PLAN NOTES" says FLOOR PLAN and is a notes
 * column, so this is asked before the rank is.
 */
const TEXT_BLOCK = /\b(NOTES?|LEGENDS?|KEY ?NOTES?|KEYED NOTES?|TYPES|ABBREVIATIONS?|SYMBOLS?|SCHEDULES?|SCHED\.?|INDEX|SPECIFICATIONS?|TABLE|MATRIX)\b/i;

export function viewClass(title: string): { kind: ViewClass; why: string } {
  if (TEXT_BLOCK.test(title)) return { kind: "text-block", why: "a heading over notes, a legend or a table" };
  const rank = takeoffRank(null, title);
  // "PENTHOUSE FLOOR (P2)": a level and the word FLOOR with no PLAN after it.
  // `takeoffRank` has no opinion; it is a plan of that floor, and says so.
  if (/nothing in the title/.test(rank.why) && isLevelPlan(title)) return { kind: "floor-plan", why: "a floor plan, named by its level" };
  const why = rank.why;
  const kind: ViewClass =
    /dimensioned floor plan|a floor plan|a partition plan/.test(why) ? "floor-plan"
    : /enlarged plan/.test(why) ? "enlarged-plan"
    : /reflected ceiling/.test(why) ? "rcp"
    : /roof plan/.test(why) ? "roof"
    : /elevation/.test(why) ? "elevation"
    : /section/.test(why) ? "section"
    : /detail/.test(why) ? "detail"
    : /site plan/.test(why) ? "site"
    : /key plan/.test(why) ? "key-plan"
    : /plan of some kind/.test(why) ? "other-plan"
    : /nothing in the title/.test(why) ? "unknown"
    : "not-a-plan";
  return { kind, why };
}

export type ViewTitle = {
  /** The joined lettering, as the drafter wrote it. */
  text: string;
  /** Left edge and baseline, in page-width units. */
  x: number;
  y: number;
  /** Lettering height in points, and the sheet's median for comparison. */
  heightPt: number;
  medianPt: number;
  /** Where the rule under it runs, in page-width units. */
  ruleFrom: number;
  ruleTo: number;
};

type TextItem = { str: string; x: number; y: number; width: number; height: number };

/** Big AND ruled lettering, each a drawing's title. */
export function viewTitles(input: {
  items: readonly TextItem[];
  segments: readonly StrokeSegment[];
  widthPt: number;
  sizeRatio?: number;
}): ViewTitle[] {
  const W = input.widthPt;
  if (!(W > 0)) return [];
  const ratio = input.sizeRatio ?? TITLE_SIZE_RATIO;
  const items = input.items.filter((i) => i.str.trim() !== "" && i.height > 0);
  const heights = items.map((i) => i.height).sort((a, b) => a - b);
  if (heights.length === 0) return [];
  const median = heights[Math.floor(heights.length / 2)];
  const floor = median * ratio;

  // ── THE BIG LETTERING, JOINED ALONG ITS BASELINE ──
  const big = items
    .filter((i) => i.height >= floor)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { parts: TextItem[]; y: number; height: number }[] = [];
  for (const item of big) {
    const line = lines.find(
      (l) =>
        Math.abs(l.y - item.y) <= 0.35 * Math.max(l.height, item.height) &&
        Math.abs(l.height - item.height) <= 0.25 * Math.max(l.height, item.height) &&
        item.x - Math.max(...l.parts.map((p) => p.x + p.width)) <= SAME_TITLE_GAP_HEIGHTS * item.height &&
        item.x >= Math.min(...l.parts.map((p) => p.x)) - SAME_TITLE_GAP_HEIGHTS * item.height,
    );
    if (line === undefined) lines.push({ parts: [item], y: item.y, height: item.height });
    else line.parts.push(item);
  }

  // ── THE RULE, WHICH MUST COVER THE LETTERING AND NOT MERELY TOUCH IT ──
  const rules = input.segments.filter((s) => {
    const dx = Math.abs(s.x2 - s.x1);
    return dx > 0 && Math.abs(s.y2 - s.y1) <= dx * RULE_SLOPE;
  });

  const out: ViewTitle[] = [];
  for (const line of lines) {
    const parts = [...line.parts].sort((a, b) => a.x - b.x);
    const text = parts.map((p) => p.str.trim()).join(" ").replace(/\s+/g, " ");
    // A bare number is a bubble or a dimension, never a title.
    if (!/[A-Z]{2,}/i.test(text)) continue;
    const left = Math.min(...parts.map((p) => p.x)) / W;
    const right = Math.max(...parts.map((p) => p.x + p.width)) / W;
    const y = line.y / W;
    let rule: { from: number; to: number } | null = null;
    for (const s of rules) {
      const sy = (s.y1 + s.y2) / 2 / W;
      const below = sy - y;
      if (below <= 0 || below > RULE_BELOW) continue;
      const from = Math.min(s.x1, s.x2) / W;
      const to = Math.max(s.x1, s.x2) / W;
      const cover = Math.min(to, right) - Math.max(from, left);
      if (cover < RULE_COVER * (right - left)) continue;
      if (to - from > RULE_OVERRUN * Math.max(right - left, 1e-6)) continue;
      if (rule === null || to - from > rule.to - rule.from) rule = { from, to };
    }
    if (rule === null) continue;
    out.push({ text, x: left, y, heightPt: line.height, medianPt: median, ruleFrom: rule.from, ruleTo: rule.to });
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * ── THE LEVEL A PLAN TITLE NAMES ──
 *
 * "1st Floor Plan", "2nd - 9th Floor Plan", "FLOOR PLAN LEVEL 1", "Penthouse
 * Floor", "FLOOR PLAN - LEVEL 2 - MEZZANINE". Two plan views naming
 * different levels are different floors and both are kept; the same level,
 * or none, is one floor drawn twice. A named level beside a number is part
 * of the name — a mezzanine of level 2 is not level 2, and Supreme Court
 * A111 draws both, with the mezzanine the bigger drawing.
 */
/**
 * ── THE NUMBER AFTER "LEVEL" BEATS THE NUMBER BEFORE "FLOOR" ──
 *
 * Supreme Court A111 captions its drawings "1 FLOOR PLAN - LEVEL 2",
 * "2 FLOOR PLAN - LEVEL 2 - MEZZANINE", "3 FLOOR PLAN - LEVEL 3": the leading
 * figure is the DRAWING number, and one pattern that accepted either form
 * read it as the level — 1, "2 MEZZANINE", 3 — because it met the drawing
 * number first. Harmless there (three plans, three groups either way); on a
 * sheet whose drawings 1 and 2 are a floor plan and a dimension plan of the
 * SAME level it keeps both, which is every wall twice. So a keyword-first
 * form ("LEVEL 2", "FLOOR 1") is read before a number-first one ("1ST
 * FLOOR"), and a bare number before FLOOR only counts when nothing names the
 * level after the keyword.
 */
const LEVEL_AFTER_KEYWORD = /\b(?:FLOOR|LEVEL|FLR)\s*(\d{1,2})(?:\s*(?:-|–|TO|THRU)\s*(\d{1,2}))?\b/;
const LEVEL_BEFORE_KEYWORD =
  /\b(\d{1,2})(?:ST|ND|RD|TH)?(?:\s*(?:-|–|TO|THRU|THROUGH)\s*(\d{1,2})(?:ST|ND|RD|TH)?)?\s+(?:FLOOR|LEVEL|FLR)\b/;
const LEVEL_NAME = /\b(PENTHOUSE|BASEMENT|MEZZANINE|GROUND|MAIN\s+LEVEL|UPPER\s+LEVEL|LOWER\s+LEVEL|CELLAR|ATTIC|LOFT)\b/;

/**
 * ── A LEVEL WRITTEN AS A WORD IS THE SAME LEVEL ──
 *
 * glen-hazel A-111 captions "First Floor Plan" and "Second Floor Plan". Both
 * parsed to NO level, so `keptPlanViews` grouped them as one floor drawn twice
 * and dropped the second — 822 of its 1,843 ft of key, measured and thrown
 * away. The words are spelled out before the digit pattern runs.
 */
const ORDINAL_WORDS: Record<string, string> = {
  FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH", SIXTH: "6TH",
  SEVENTH: "7TH", EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH", ELEVENTH: "11TH", TWELFTH: "12TH",
};
const ORDINAL_WORD = new RegExp(`\\b(${Object.keys(ORDINAL_WORDS).join("|")})\\b`, "g");
export function planLevel(title: string): string | null {
  const up = title.toUpperCase().replace(ORDINAL_WORD, (w) => ORDINAL_WORDS[w] ?? w);
  const num = LEVEL_AFTER_KEYWORD.exec(up) ?? LEVEL_BEFORE_KEYWORD.exec(up);
  const name = LEVEL_NAME.exec(up);
  const number = num === null ? null : (() => {
    const from = num[1];
    const to = num[2];
    return to === undefined ? `${Number(from)}` : `${Number(from)}-${Number(to)}`;
  })();
  const named = name === null ? null : name[1].replace(/\s+/g, " ");
  if (number === null && named === null) return null;
  return [number, named].filter((x): x is string => x !== null).join(" ");
}

/** A level and the word FLOOR, and nothing saying it is some other kind of drawing. */
/**
 * ── WHAT A PLAN IS OF, ONCE THE KIND WORDS ARE GONE ──
 *
 * "ENLARGED PLAN - TYP. TOILET/SHOWER" and "SLOPING PLAN - TYP. TOILET/SHOWER"
 * are two drawings of ONE room, and "ENLARGED PLAN - STORM SHELTER" is a
 * different room. On a sheet with no floor plan — Joplin A-111, seven typical
 * rooms — `keptPlanViews` grouped by level, every level was null, and it kept
 * ONE of the seven: 422 ft of key on the other six, all "missing". The
 * subject is the caption with the drawing number and the kind words stripped,
 * so that two drawings of one room fall into one group and two rooms do not.
 */
const SUBJECT_WORDS = /\b(ENLARGED|SLOPING|PLANS?|FLOOR|DIMENSIONED|DIMENSIONS?|PARTITIONS?|TYPICAL|TYP)\b/g;
export function planSubject(title: string): string {
  return title
    .toUpperCase()
    .replace(/^\s*\d{1,2}\s*[-.:]?\s*/, "")
    .replace(SUBJECT_WORDS, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function isLevelPlan(title: string): boolean {
  return planLevel(title) !== null && /\bFLOOR\b/i.test(title) && !/\b(ELEV|ELEVATION|SECTION|SECT|DETAIL|DET|SCHEDULE|FRAMING|FINISH|CEILING|RCP|DEMO|ROOF|NOTES?|LEGEND)\b/i.test(title);
}

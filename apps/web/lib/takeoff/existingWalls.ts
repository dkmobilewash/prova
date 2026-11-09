import { bothFacesDashed } from "./dashedFaces";
import { renovationMarks, showsExistingWork } from "./renovationMarks";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── AN EXISTING WALL IS NOT A WALL TO TAKE OFF ──
 *
 * Diego's rule for the keys (2026-10-30): a wall counts if it is NEW work,
 * not if it is existing. The layer filter already honours that where the
 * export carries layers (`layerNames.ts`: `A-WALL-E`, `A-EXIST`, `NIC`), but
 * most sets arrive flattened, and on those the drawing says "existing" in
 * three other ways. Each is read here and the wall is SET ASIDE under one
 * kind, `existing`, with the words that said so — never dropped, so an
 * estimator pricing a remodel can still accept it.
 *
 *   1. A TAG beside the wall: `(E)`, `(E) WALL`, `EXIST. CMU WALL`,
 *      `EXISTING WALL TO REMAIN`, within `TAG_REACH_FEET` of the run — the
 *      same reach a bare type tag gets in `bareTextTags`.
 *   2. (Removed.) An AREA the sheet marks — NIC, EXISTING BUILDING, a room
 *      named (E) OFFICE — closed from the finder's runs, every wall bounding
 *      only marked rooms set aside. Measured on the cleaned keys 2026-10-30
 *      it stood on one training building (Baker A100, 446 ft junk / 31 real)
 *      and was the whole of the held-out cost (29 runs, 439 ft real against
 *      64 junk): a room's label says what the ROOM is, and its walls are as
 *      often the new work that made it. Diego's call: ship without it.
 *   3. The LEGEND'S OWN PEN: a legend row reading EXISTING WALL has a drawn
 *      sample beside it, and the sample's pen — grey level, line width, dash
 *      — is what the plan draws existing walls with. A wall whose faces carry
 *      that pen is existing. GREY ALONE IS NEVER ENOUGH: the pen is read off
 *      the legend's swatch, must differ from the NEW WALL swatch's pen (or,
 *      with no new-wall row, from the pen most of the sheet's walls use), and
 *      is matched on grey AND width together.
 *   4. GREY AGAINST THE SHEET'S BLACK, where no legend row names the pen: on
 *      a sheet that says it shows existing work (`renovationMarks`), whose
 *      walls are mostly drawn dark, a wall whose faces are nearly all grey
 *      (`GREY_COVER`, `DARK_COVER_MAX`). Still not grey alone — the sheet's words and its
 *      own new-wall pen must both say so. Measured 2026-11-06: training 920
 *      ft junk / 29 real (worst Baker −29), held-out once 766 / 71.
 *
 * Pure, so the three routes have tests that do not need a drawing. Measured
 * on training labels only once Chrome's cleanup of existing walls out of the
 * keys has closed — before that, every existing wall set aside here reads as
 * a miss against a key that should not contain it.
 */

export type TextItem = { str: string; x: number; y: number; width: number; height: number };

/** How far from a run a wall tag may sit and still name it, in feet. */
export const TAG_REACH_FEET = 3;
/** How far left of a legend row its drawn sample may begin, in text heights — Bunkie A100's sits 3 to 9 heights out. */
export const SWATCH_REACH_HEIGHTS = 12;
/** Two pens agree when their grey levels and widths are this close. */
export const PEN_GRAY_SLACK = 0.1;
export const PEN_WIDTH_RATIO = 1.25;
/** Share of a wall's face strokes, by length, that must carry the legend's pen. */
export const PEN_FACE_SHARE = 0.6;
/** A screened pen: grey at least this light (0 black, 1 white) — `existingMarks`'s own cut. */
export const GREY_PEN = 0.3;
/** Route 3: share of a wall's LENGTH its grey faces must cover, overlaps merged. */
export const GREY_COVER = 0.6;
/** Route 3: share of a wall's length its DARK faces may cover — a wall drawn black is new, whatever grey lies on it. */
export const DARK_COVER_MAX = 0.2;
/** A face stroke sits this close to the wall's face line, in feet (as `dashedFaces`). */
const ON_FACE_FEET = 0.25;

const EXIST = String.raw`(?:\(E\)|EXIST(?:ING|'G|G\.|\.)?)`;
const WALL_WORD = String.raw`(?:WALLS?|PARTITIONS?|DEMISING|CMU|MASONRY|BRICK)`;
/** `EXISTING TOILET PARTITION`, `EXISTING MIRROR`: a fixture, however the word reads. */
const FIXTURE = /\b(?:TOILET|URINAL|MIRROR|SHOWER|CURTAIN)\b/i;
/**
 * A short label naming an existing WALL: `(E) WALL`, `(E) DEMISING`, `EXIST.
 * 8" CMU WALL`, `EXISTING WALL TO REMAIN`, `WALL TO REMAIN`. A bare `(E)` is
 * NOT one: measured on the cleaned labels (2026-10-30, E Street A2.1) a bare
 * `(E)` two feet from a run marks an existing door, column or fixture beside
 * a NEW wall as often as the wall — 120 ft of real wall against 115 of junk
 * across the training sheets — so the tag has to say what it names.
 */
export const WALL_TAG = new RegExp(
  String.raw`^(?:${EXIST}(?:\s+[A-Z0-9"'/.\-]+){0,3}\s+${WALL_WORD}(?:\s+TO\s+REMAIN)?\.?|(?:${EXIST}\s+)?${WALL_WORD}\s+TO\s+REMAIN\.?)$`,
  "i",
);
/** A legend row describing the existing-wall sample, and one describing the new-wall sample. */
export const LEGEND_EXISTING = new RegExp(
  String.raw`^(?:${EXIST}(?:\s+[A-Z0-9"'/.\-]+){0,2}\s+(?:${WALL_WORD}|CONSTRUCTION)(?:\s+TO\s+REMAIN)?|(?:${EXIST}\s+)?(?:${WALL_WORD}|CONSTRUCTION)\s+TO\s+REMAIN)\.?$`,
  "i",
);
// "NEW WALL TO BE PROVIDED" (Schroeder A1.01) and "… TO BE CONSTRUCTED" say the same as "NEW WALL".
export const LEGEND_NEW = new RegExp(String.raw`^NEW(?:\s+[A-Z0-9"'/.\-]+){0,2}\s+(?:${WALL_WORD}|CONSTRUCTION)(?:\s+TO\s+BE\s+(?:PROVIDED|CONSTRUCTED|BUILT|INSTALLED))?\.?$`, "i");
const DEMOLITION = /\b(?:DEMO(?:LISH(?:ED)?|LITION)?|REMOVED?|TO\s+BE\s+REMOVED)\b/i;

/** A short label naming an existing wall beside it — and not a fixture. */
export const isWallTag = (str: string): boolean => WALL_TAG.test(str) && !FIXTURE.test(str);

export type TextRow = TextItem;

/**
 * The sheet's words joined into rows: items in one vertical band, read left to
 * right, broken where the gap exceeds a word and a half. A PDF hands over
 * `EXISTING`, `WALL`, `TO`, `REMAIN` as four items as often as one.
 */
export function textRows(items: readonly TextItem[]): TextRow[] {
  const sorted = [...items].filter((t) => t.str.trim() !== "" && t.height > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: TextItem[][] = [];
  for (const t of sorted) {
    const band = bands[bands.length - 1];
    const last = band?.[band.length - 1];
    if (last !== undefined && Math.abs(t.y - last.y) <= 0.5 * Math.min(t.height, last.height)) band.push(t);
    else bands.push([t]);
  }
  const rows: TextRow[] = [];
  for (const band of bands) {
    band.sort((a, b) => a.x - b.x);
    let row: TextRow | null = null;
    for (const t of band) {
      if (row !== null && t.x - (row.x + row.width) <= 1.5 * row.height && t.x - (row.x + row.width) >= -0.5 * row.height) {
        row.str = `${row.str} ${t.str.trim()}`;
        row.width = Math.max(row.x + row.width, t.x + t.width) - row.x;
        row.height = Math.max(row.height, t.height);
        row.y = Math.max(row.y, t.y);
      } else {
        row = { str: t.str.trim(), x: t.x, y: t.y, width: t.width, height: t.height };
        rows.push(row);
      }
    }
  }
  return rows;
}

export type Pen = { gray: number; width: number; dashed: boolean; /** The sample is a FILLED band of this luminance — Murray A101's and Bunkie A100's EXISTING WALL is a grey poché between black outlines. */ fill?: number };

/** The pen a wall's face strokes are drawn with, or the legend swatch's. */
function penOf(strokes: readonly StrokeSegment[]): Pen | null {
  if (strokes.length === 0) return null;
  const grays = strokes.map((s) => s.gray ?? 0).sort((a, b) => a - b);
  const widths = strokes.map((s) => s.width ?? 0).sort((a, b) => a - b);
  // Dashed: three or more pieces on one line. Two parallel lines are a
  // double-line sample; a hatch's ticks are many lines, none collinear.
  const horizontal = strokes.filter((s) => Math.abs(s.y2 - s.y1) <= 0.1 * Math.abs(s.x2 - s.x1));
  const ys = horizontal.map((s) => (s.y1 + s.y2) / 2).sort((a, b) => a - b);
  let collinear = 1;
  let best = 1;
  for (let i = 1; i < ys.length; i += 1) {
    collinear = ys[i] - ys[i - 1] <= 1e-4 ? collinear + 1 : 1;
    best = Math.max(best, collinear);
  }
  const fills = strokes.map((s) => s.fill).filter((f): f is number => f !== undefined).sort((a, b) => a - b);
  const pen: Pen = { gray: grays[Math.floor(grays.length / 2)], width: widths[Math.floor(widths.length / 2)], dashed: best >= 3 };
  // A filled sample is matched on its fill; its outline's dash is not the signal.
  if (fills.length > 0) { pen.fill = fills[Math.floor(fills.length / 2)]; pen.dashed = false; }
  return pen;
}

export function samePen(a: Pen, b: Pen): boolean {
  // A filled sample is matched on its FILL: the outlines round a poché are
  // the same black pen the new walls are drawn with, and the fill is what
  // the legend is showing.
  if (a.fill !== undefined || b.fill !== undefined) return a.fill !== undefined && b.fill !== undefined && Math.abs(a.fill - b.fill) <= PEN_GRAY_SLACK;
  const widthClose = a.width > 0 && b.width > 0 ? Math.max(a.width, b.width) / Math.min(a.width, b.width) <= PEN_WIDTH_RATIO : a.width === b.width;
  return Math.abs(a.gray - b.gray) <= PEN_GRAY_SLACK && widthClose && a.dashed === b.dashed;
}

export type LegendPens = {
  existing: { pen: Pen; row: string } | null;
  fresh: { pen: Pen; row: string } | null;
};

/**
 * The pens drawn beside the legend's EXISTING WALL and NEW WALL rows. The
 * sample sits to the LEFT of the words, within `SWATCH_REACH_HEIGHTS` text
 * heights and one text height above or below the row's centre; its strokes
 * are short. A row that reads DEMOLISH or REMOVE is the demolition sample
 * and is neither.
 */
export function legendPens(rows: readonly TextRow[], segments: readonly StrokeSegment[], widthPt: number): LegendPens {
  const out: LegendPens = { existing: null, fresh: null };
  for (const row of rows) {
    if (row.str.split(/\s+/).length > 8 || DEMOLITION.test(row.str)) continue;
    const which = LEGEND_EXISTING.test(row.str) ? "existing" : LEGEND_NEW.test(row.str) ? "fresh" : null;
    if (which === null || out[which] !== null) continue;
    const h = row.height / widthPt;
    const cy = (row.y - row.height / 2) / widthPt;
    const x1 = row.x / widthPt - 0.2 * h;
    const x0 = x1 - SWATCH_REACH_HEIGHTS * h;
    const inside = (x: number, y: number) => x >= x0 && x <= x1 && Math.abs(y - cy) <= h;
    const swatch = segments.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
    // A LINE sample is drawn along the row, at least a text height long
    // (Bunkie A100's is 1.2 heights); a keynote's hexagon beside a numbered
    // note is six short edges. A sample of three or more OBLIQUE pieces is a
    // hatch, and one with a pen wider than the text is a fill (Supreme Court
    // A111 draws EXISTING CONSTRUCTION as poché): both describe a wall drawn
    // as a region, which no face stroke carries, so neither names a pen —
    // deriving one from the hatch's ticks would hand a thin black pen to
    // every new wall drawn in thin black.
    const horizontal = (s: StrokeSegment) => Math.abs(s.y2 - s.y1) <= 0.1 * Math.abs(s.x2 - s.x1);
    const vertical = (s: StrokeSegment) => Math.abs(s.x2 - s.x1) <= 0.1 * Math.abs(s.y2 - s.y1);
    const alongRow = swatch.filter((s) => horizontal(s) && Math.abs(s.x2 - s.x1) >= h);
    const oblique = swatch.filter((s) => !horizontal(s) && !vertical(s)).length;
    if (alongRow.length === 0 || oblique >= 3 || swatch.some((s) => s.fill === undefined && (s.width ?? 0) > row.height)) continue;
    const pen = penOf(swatch);
    if (pen !== null) out[which] = { pen, row: row.str };
  }
  return out;
}

/** The strokes lying along one face of the wall (`side` +1 or −1). */
export function faceStrokes(wall: WallCandidate, side: 1 | -1, segments: readonly StrokeSegment[], feetPerUnit: number): StrokeSegment[] {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const l = Math.hypot(dx, dy);
  if (l === 0) return [];
  const ux = dx / l, uy = dy / l;
  const half = wall.thicknessFeet / 2;
  const reach = (half + ON_FACE_FEET) / feetPerUnit;
  const minX = Math.min(wall.x1, wall.x2) - reach, maxX = Math.max(wall.x1, wall.x2) + reach;
  const minY = Math.min(wall.y1, wall.y2) - reach, maxY = Math.max(wall.y1, wall.y2) + reach;
  const out: StrokeSegment[] = [];
  for (const s of segments) {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    if (mx < minX || mx > maxX || my < minY || my > maxY) continue;
    const sl = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (sl === 0 || Math.abs(((s.x2 - s.x1) * ux + (s.y2 - s.y1) * uy) / sl) < 0.97) continue;
    const cross = dx * (my - wall.y1) - dy * (mx - wall.x1);
    if (wall.thicknessFeet > 0.05 && Math.sign(cross) !== side) continue;
    if (Math.abs((Math.abs(cross) / l) * feetPerUnit - half) > ON_FACE_FEET) continue;
    out.push(s);
  }
  return out;
}

const length = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Share of the wall's length the strokes cover, projected onto it with overlaps merged. */
function alongCover(wall: WallCandidate, strokes: readonly StrokeSegment[]): number {
  const l = length(wall);
  if (l === 0) return 0;
  const ux = (wall.x2 - wall.x1) / l, uy = (wall.y2 - wall.y1) / l;
  const spans = strokes
    .map((s) => {
      const a = (s.x1 - wall.x1) * ux + (s.y1 - wall.y1) * uy, b = (s.x2 - wall.x1) * ux + (s.y2 - wall.y1) * uy;
      return [Math.max(0, Math.min(a, b)), Math.min(l, Math.max(a, b))] as const;
    })
    .filter(([lo, hi]) => hi > lo)
    .sort((p, q) => p[0] - q[0]);
  let covered = 0, end = 0;
  for (const [lo, hi] of spans) if (hi > end) { covered += hi - Math.max(lo, end); end = hi; }
  return covered / l;
}

/** True when at least `PEN_FACE_SHARE` of the wall's face strokes, by length, carry the pen. */
export function drawnWithPen(wall: WallCandidate, pen: Pen, segments: readonly StrokeSegment[], feetPerUnit: number): boolean {
  const faces = [...faceStrokes(wall, 1, segments, feetPerUnit), ...faceStrokes(wall, -1, segments, feetPerUnit)];
  const total = faces.reduce((n, s) => n + length(s), 0);
  if (!(total > 0)) return false;
  const strokePen = (s: StrokeSegment): Pen => ({ gray: s.gray ?? 0, width: s.width ?? 0, dashed: pen.dashed, fill: s.fill });
  const matched = faces.filter((s) => samePen(strokePen(s), pen)).reduce((n, s) => n + length(s), 0);
  // A filled band's edges sit UNDER the black outlines, so the outlines
  // count against the share; a fill is measured against the wall's own
  // length instead — both edges of a fully filled run give twice it.
  if (pen.fill !== undefined ? matched < PEN_FACE_SHARE * length(wall) : matched / total < PEN_FACE_SHARE) return false;
  return pen.dashed ? bothFacesDashed(wall, segments, feetPerUnit) : true;
}

/** A paper-white fill is no fill: Schroeder's existing walls are outlines filled white. */
export const WHITE_FILL = 0.95;
/** How a wall is drawn: filled or not along most of its length, and its outline's grey. */
export type WallStyle = { filled: boolean; gray: number; dashed: boolean };

export function wallStyle(wall: WallCandidate, segments: readonly StrokeSegment[], feetPerUnit: number): WallStyle | null {
  const faces = [...faceStrokes(wall, 1, segments, feetPerUnit), ...faceStrokes(wall, -1, segments, feetPerUnit)];
  if (faces.length === 0) return null;
  const filledEdges = faces.filter((s) => s.fill !== undefined && s.fill < WHITE_FILL);
  const outline = faces.filter((s) => s.fill === undefined);
  const grays = (outline.length > 0 ? outline : faces).map((s) => s.gray ?? 0).sort((a, b) => a - b);
  return { filled: alongCover(wall, filledEdges) >= PEN_FACE_SHARE, gray: grays[Math.floor(grays.length / 2)]!, dashed: bothFacesDashed(wall, segments, feetPerUnit) };
}

/**
 * The legend's two samples as a classifier, where they are drawn as DIFFERENT
 * kinds: one filled and one not, or the same fill with outlines a grey apart.
 * Null where the two cannot be told apart by kind — the old pen match stands.
 */
export function legendKinds(existing: Pen, fresh: Pen): ((style: WallStyle) => "existing" | "new" | null) | null {
  const filled = (p: Pen) => p.fill !== undefined && p.fill < WHITE_FILL;
  // Only the inversion the pen match cannot see: NEW drawn filled, EXISTING as a plain outline.
  // An existing poché against new outlines (Murray A101, Bunkie A100) is the pen match's own case —
  // it matches the poché's shade — and two unfilled samples are told apart by grey AND width there.
  if (filled(fresh) && !filled(existing)) return (st) => (st.filled ? "new" : Math.abs(st.gray - existing.gray) <= PEN_GRAY_SLACK ? "existing" : null);
  return null;
}

/** The pen most of the sheet's walls are drawn with, by face length. */
export function modalWallPen(walls: readonly WallCandidate[], segments: readonly StrokeSegment[], feetPerUnit: number): Pen | null {
  const feet = new Map<string, { pen: Pen; n: number }>();
  for (const w of walls) {
    for (const s of [...faceStrokes(w, 1, segments, feetPerUnit), ...faceStrokes(w, -1, segments, feetPerUnit)]) {
      const pen = { gray: Math.round((s.gray ?? 0) * 10) / 10, width: Math.round((s.width ?? 0) * 100) / 100, dashed: false };
      const key = `${pen.gray}|${pen.width}`;
      const at = feet.get(key) ?? { pen, n: 0 };
      at.n += length(s);
      feet.set(key, at);
    }
  }
  let best: { pen: Pen; n: number } | null = null;
  for (const one of feet.values()) if (best === null || one.n > best.n) best = one;
  return best?.pen ?? null;
}

const distanceToRun = (px: number, py: number, w: { x1: number; y1: number; x2: number; y2: number }) => {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / l2));
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy));
};

export type ExistingWall = { wall: WallCandidate; route: "tag" | "legend" | "grey" | "nic"; why: string };

export function existingWalls(input: {
  /** The finder's runs, page-width units. */
  walls: readonly WallCandidate[];
  /** The strokes the finder paired, page-width units, pen width in points (as `inPageWidthUnits` gives them) — the walls' faces are among them. */
  segments: readonly StrokeSegment[];
  /**
   * EVERY stroke on the page, same units, for the legend's swatch. The
   * finder's list is clipped to the drawing and the legend sits outside it:
   * Bunkie A100's and Murray A101's EXISTING WALL samples are in the page's
   * strokes and in none of the finder's. Optional; without it the swatch is
   * looked for in `segments`, which on most sheets finds nothing.
   */
  pageSegments?: readonly StrokeSegment[];
  /** The sheet's words, in page points, `y` at the baseline. */
  textItems: readonly TextItem[];
  widthPt: number;
  feetPerUnit: number;
}): ExistingWall[] {
  const { walls, segments, widthPt, feetPerUnit } = input;
  if (walls.length === 0 || !(widthPt > 0) || !(feetPerUnit > 0)) return [];
  const rows = textRows(input.textItems);
  const found = new Map<WallCandidate, ExistingWall>();

  // ── 1. A TAG BESIDE THE WALL ──
  const tags = rows.filter((r) => isWallTag(r.str));
  for (const tag of tags) {
    const cy = (tag.y - tag.height / 2) / widthPt;
    const points = [tag.x, tag.x + tag.width / 2, tag.x + tag.width].map((x) => [x / widthPt, cy] as const);
    for (const w of walls) {
      if (found.has(w)) continue;
      const feet = Math.min(...points.map(([x, y]) => distanceToRun(x, y, w))) * feetPerUnit;
      if (feet <= TAG_REACH_FEET) found.set(w, { wall: w, route: "tag", why: `tagged "${tag.str}" ${feet.toFixed(0)} ft away` });
    }
  }

  // ── 2. THE LEGEND'S OWN PEN ──
  const pens = legendPens(rows, input.pageSegments ?? segments, widthPt);
  // ── 2a. BOTH ROWS, DRAWN AS DIFFERENT KINDS: THE SHEET'S OWN LEGEND DECIDES ──
  // Schroeder A1.01 draws NEW walls grey-filled and EXISTING walls as plain
  // outlines — the opposite of "grey is existing". Its swatches are drawn at
  // another pen width and fill shade than its plan (0.48 pt and 0.75 in the
  // legend, 0.24 pt and 0.50 on the walls), so what is matched is the KIND of
  // drawing: filled or not, then the outline's grey. A wall drawn like the new
  // sample stays; one drawn like the existing sample is set aside.
  const kinds = pens.existing !== null && pens.fresh !== null ? legendKinds(pens.existing.pen, pens.fresh.pen) : null;
  if (kinds !== null && pens.existing !== null) {
    const row = pens.existing.row;
    for (const w of walls) {
      if (found.has(w)) continue;
      const style = wallStyle(w, segments, feetPerUnit);
      if (style !== null && kinds(style) === "existing") found.set(w, { wall: w, route: "legend", why: `drawn like the legend's "${row}" sample (an outline, grey ${style.gray.toFixed(2)}), not its filled "${pens.fresh!.row}" sample` });
    }
  } else if (pens.existing !== null) {
    const other = pens.fresh?.pen ?? modalWallPen(walls, segments, feetPerUnit);
    const distinct = other === null || !samePen(pens.existing.pen, other);
    if (distinct) {
      const { pen, row } = pens.existing;
      const said = pen.fill !== undefined ? `filled grey ${pen.fill.toFixed(2)}` : `${pen.dashed ? "dashed, " : ""}grey ${pen.gray.toFixed(2)}, ${pen.width.toFixed(2)} pt`;
      for (const w of walls) {
        if (found.has(w)) continue;
        if (drawnWithPen(w, pen, segments, feetPerUnit)) found.set(w, { wall: w, route: "legend", why: `drawn with the legend's "${row}" pen (${said})` });
      }
    }
  }

  // ── 3. GREY AGAINST THE SHEET'S BLACK, ON A SHEET THAT SHOWS EXISTING WORK ──
  // Where no legend row names the existing pen, a renovation sheet still draws
  // existing walls screened: Baker's A100 draws its new walls black and the
  // building that stays in grey. Not grey alone: the sheet must say it shows
  // existing work (`renovationMarks`), most of its walls must be drawn dark,
  // and the wall must be drawn grey along most of its length and dark along
  // almost none of it (`GREY_COVER`, `DARK_COVER_MAX`).
  // Training renovation sheets, cleaned keys: 1,214 ft junk to 55 ft real.
  if (pens.existing === null && showsExistingWork(renovationMarks(input.textItems.map((t) => t.str).join(" ")))) {
    const modal = modalWallPen(walls, segments, feetPerUnit);
    if (modal !== null && modal.gray < GREY_PEN) {
      for (const w of walls) {
        if (found.has(w)) continue;
        const faces = [...faceStrokes(w, 1, segments, feetPerUnit), ...faceStrokes(w, -1, segments, feetPerUnit)];
        // BY HOW MUCH OF THE WALL IS COVERED, overlaps merged — never by summed
        // stroke length: Baker A101's new partition is drawn black end to end
        // under a grey hatch of 244 short overlapping pieces, 302 ft of grey on
        // a 29 ft wall, and a sum called that wall grey.
        const grey = alongCover(w, faces.filter((f) => (f.gray ?? 0) >= GREY_PEN));
        const dark = alongCover(w, faces.filter((f) => (f.gray ?? 0) < GREY_PEN));
        if (grey >= GREY_COVER && dark <= DARK_COVER_MAX) found.set(w, { wall: w, route: "grey", why: "drawn grey where the sheet draws its walls black, on a sheet that shows existing work" });
      }
    }
  }
  // ── 4. INSIDE A HATCHED AREA LABELLED NOT IN CONTRACT ──
  // Wendell A101.2 hatches the part of the building outside this contract and
  // labels it NOT IN CONTRACT. The area is read off the HATCH, not off a room
  // label (a room named (E) OFFICE says what the room is, and its walls are as
  // often new: the area route removed 2026-10-30): the hatched cells the label
  // sits in, joined. Only a wall with BOTH sides in that hatch goes; the area's
  // edge is a wall the contract may build.
  const nic = rows.filter((r) => NIC_WORDS.test(r.str));
  if (nic.length > 0) {
    const area = nicHatch(segments, nic.map((r) => ({ x: (r.x + r.width / 2) / widthPt, y: (r.y - r.height / 2) / widthPt })), feetPerUnit);
    if (area !== null) {
      for (const w of walls) {
        if (found.has(w)) continue;
        const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        if (L === 0) continue;
        const nx = -(w.y2 - w.y1) / L, ny = (w.x2 - w.x1) / L, off = (w.thicknessFeet / 2 + NIC_SIDE_FEET) / feetPerUnit;
        const pts = [0.25, 0.5, 0.75].flatMap((t) => [1, -1].map((sg) => ({ x: w.x1 + (w.x2 - w.x1) * t + sg * nx * off, y: w.y1 + (w.y2 - w.y1) * t + sg * ny * off })));
        if (pts.every((p) => area(p.x, p.y))) found.set(w, { wall: w, route: "nic", why: `inside the hatched area labelled "${nic[0]!.str}"` });
      }
    }
  }
  return [...found.values()];
}

/** The words that put an area outside the contract. */
export const NIC_WORDS = /^(?:NOT\s+IN\s+CONTRACT|N\.?\s?I\.?\s?C\.?|BY\s+OTHERS|NOT\s+IN\s+SCOPE)$/i;
/** A hatch cell, feet; a wall's sides are looked at this far beyond its faces. */
export const NIC_CELL_FEET = 3;
export const NIC_SIDE_FEET = 1.5;

/**
 * The hatched area round a label: cells crossed by two or more diagonal lines,
 * joined to the cell the label sits in (or one cell from it). Null when the
 * label sits in no hatch.
 */
export function nicHatch(segments: readonly StrokeSegment[], labels: readonly { x: number; y: number }[], feetPerUnit: number): ((x: number, y: number) => boolean) | null {
  const cell = NIC_CELL_FEET / feetPerUnit;
  const count = new Map<string, number>();
  for (const s of segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
    if (len * feetPerUnit < 2) continue;
    const cos = Math.abs(dx) / len;
    if (cos < Math.cos((70 * Math.PI) / 180) || cos > Math.cos((20 * Math.PI) / 180)) continue;
    const seen = new Set<string>();
    const steps = Math.ceil(len / (cell / 2));
    for (let k = 0; k <= steps; k += 1) {
      const key = `${Math.floor((s.x1 + (dx * k) / steps) / cell)},${Math.floor((s.y1 + (dy * k) / steps) / cell)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const hatched = (key: string) => (count.get(key) ?? 0) >= 2;
  const area = new Set<string>();
  for (const label of labels) {
    const [cx, cy] = [Math.floor(label.x / cell), Math.floor(label.y / cell)];
    const start = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => `${cx + i},${cy + j}`)).find(hatched);
    if (start === undefined) continue;
    const queue = [start];
    area.add(start);
    while (queue.length > 0) {
      const [x, y] = queue.pop()!.split(",").map(Number) as [number, number];
      for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${x + i},${y + j}`;
        if (!area.has(k) && hatched(k)) { area.add(k); queue.push(k); }
      }
    }
  }
  return area.size === 0 ? null : (x, y) => area.has(`${Math.floor(x / cell)},${Math.floor(y / cell)}`);
}

/** One sentence for the panel, from the routes that fired. */
export function existingSentence(list: readonly ExistingWall[]): string {
  const n = (route: ExistingWall["route"]) => list.filter((e) => e.route === route).length;
  const parts: string[] = [];
  if (n("tag") > 0) parts.push(`${n("tag")} tagged (E) or EXISTING beside the wall`);
  if (n("legend") > 0) parts.push(`${n("legend")} drawn with the legend's existing-wall pen`);
  if (n("grey") > 0) parts.push(`${n("grey")} drawn grey where the sheet draws its walls black`);
  if (n("nic") > 0) parts.push(`${n("nic")} inside a hatched area labelled NOT IN CONTRACT`);
  return `${parts.join("; ")} — ${n("nic") === list.length ? "outside this contract" : "existing work"}, not a wall to take off`;
}

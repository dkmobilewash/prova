import { bothFacesDashed } from "./dashedFaces";
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
 *   3. THE SHEET'S OWN TWO PENS, with no legend: a renovation sheet that draws
 *      its existing building in a grey pen and the new work black. Fires only
 *      when the sheet CLEARLY uses both — at least `SHEET_STYLE_SHARE` of its
 *      paired footage in a grey pen (luminance ≥ `SHEET_GREY_PEN`) and as much
 *      in black — and never on a sheet drawn in one pen. Measured on the
 *      cleaned training keys (2026-10-30 census): it holds on Baker A100 (640
 *      ft junk / 61 real) and E Street A2.1 (240 / 22) and fires nowhere
 *      else; at a lighter threshold or a smaller share it takes Crosslines'
 *      and Topeka's real walls, which those sets draw grey. Two buildings is
 *      thin evidence, and the record says so.
 *   4. The LEGEND'S OWN PEN: a legend row reading EXISTING WALL has a drawn
 *      sample beside it, and the sample's pen — grey level, line width, dash
 *      — is what the plan draws existing walls with. A wall whose faces carry
 *      that pen is existing. GREY ALONE IS NEVER ENOUGH: the pen is read off
 *      the legend's swatch, must differ from the NEW WALL swatch's pen (or,
 *      with no new-wall row, from the pen most of the sheet's walls use), and
 *      is matched on grey AND width together.
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
/** A face pen this light is a grey pen; under 0.1 is black. */
export const SHEET_GREY_PEN = 0.6;
/** The sheet-relative pen rule fires only when grey AND black each carry this share of the sheet's paired footage. */
export const SHEET_STYLE_SHARE = 0.2;
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
export const LEGEND_NEW = new RegExp(String.raw`^NEW(?:\s+[A-Z0-9"'/.\-]+){0,2}\s+(?:${WALL_WORD}|CONSTRUCTION)\.?$`, "i");
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

export type ExistingWall = { wall: WallCandidate; route: "tag" | "legend" | "pen"; why: string };

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
  if (pens.existing !== null) {
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
  // ── 3. THE SHEET'S OWN TWO PENS ──
  if (pens.existing === null) {
    const penGray = (w: WallCandidate): number | null => {
      const faces = [...faceStrokes(w, 1, segments, feetPerUnit), ...faceStrokes(w, -1, segments, feetPerUnit)];
      if (faces.length === 0) return null;
      const weighted: number[] = [];
      for (const s of faces) for (let i = 0; i < Math.max(1, Math.round(length(s) * feetPerUnit)); i += 1) weighted.push(s.gray ?? 0);
      weighted.sort((a, b) => a - b);
      return weighted[Math.floor(weighted.length / 2)];
    };
    const grays = walls.map((w) => ({ w, gray: penGray(w), feet: length(w) * feetPerUnit }));
    const total = grays.reduce((n, g) => n + g.feet, 0);
    const greyFeet = grays.filter((g) => g.gray !== null && g.gray >= SHEET_GREY_PEN).reduce((n, g) => n + g.feet, 0);
    const blackFeet = grays.filter((g) => g.gray !== null && g.gray < 0.1).reduce((n, g) => n + g.feet, 0);
    if (total > 0 && greyFeet >= SHEET_STYLE_SHARE * total && blackFeet >= SHEET_STYLE_SHARE * total) {
      for (const g of grays) {
        if (found.has(g.w) || g.gray === null || g.gray < SHEET_GREY_PEN) continue;
        found.set(g.w, { wall: g.w, route: "pen", why: `drawn in a grey pen (${g.gray.toFixed(2)}) on a sheet that draws ${Math.round((100 * blackFeet) / total)}% of its walls black — existing, by this sheet's own convention` });
      }
    }
  }
  return [...found.values()];
}

/** One sentence for the panel, from the routes that fired. */
export function existingSentence(list: readonly ExistingWall[]): string {
  const n = (route: ExistingWall["route"]) => list.filter((e) => e.route === route).length;
  const parts: string[] = [];
  if (n("tag") > 0) parts.push(`${n("tag")} tagged (E) or EXISTING beside the wall`);
  if (n("legend") > 0) parts.push(`${n("legend")} drawn with the legend's existing-wall pen`);
  if (n("pen") > 0) parts.push(`${n("pen")} drawn in the grey pen on a sheet whose other walls are black`);
  return `${parts.join("; ")} — existing work, not a wall to take off`;
}

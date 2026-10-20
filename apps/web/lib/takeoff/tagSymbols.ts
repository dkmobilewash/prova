import type { StrokeSegment } from "./wallVectors";

/**
 * ── A TAG IS A SMALL CLOSED SHAPE WITH A SHORT CODE INSIDE ──
 *
 * `wallTags.ts` finds wall-type tags by matching the TEXT — `A1`, `EXT-1` —
 * and that works until a set marks its partitions some other way. Camp Bow
 * Wow's are bare `A` and `B`, which no text pattern can admit safely: a bare
 * `A` on a floor plan is overwhelmingly a detail bubble or a grid line, and
 * widening the pattern floods the sheet. Measured on A101: 137 runs, 2,542 ft,
 * and `wallTypeTags` reads ZERO.
 *
 * What distinguishes a tag from the rest of the short text on a sheet is not
 * the code, it is the SYMBOL drawn around it. So this finds the symbols.
 *
 * ── THE LOOP-WALKING IS `gridBubbles`', DELIBERATELY ──
 *
 * That file already chains short segments head-to-tail, closes the loop and
 * checks the turn, to find the column grid's circles. Its roundness test —
 * every vertex the same distance from the centre — is usually described as
 * finding circles, and it holds just as well for a regular polygon, because a
 * hexagon's six corners are equidistant too. What separates them is how many
 * CORNERS there are, which that file had no reason to count and this one
 * needs. A second loop-walker would be the second canonical list this repo
 * keeps paying for, so this generalises rather than copies: the shape is
 * whatever the corner count says.
 *
 * ── AND A DETAIL CALLOUT IS THE SAME SHAPE, SO THE CONTENTS DECIDE ──
 *
 * A section or detail callout is also a small closed symbol with something
 * written in it, and on Camp Bow Wow's A101 there are more of those than
 * anything else — A001, A201, A501, A140. Two things give them away and both
 * are checked:
 *
 *   - the text is a SHEET REFERENCE, a discipline letter and three digits;
 *   - the symbol is SPLIT by a line through its middle, detail number above
 *     and sheet below, which a wall tag never is.
 *
 * Neither is a judgement about what the code means. A tag's code is whatever
 * the legend says it is, and this file never guesses at one.
 */

/** Smallest and largest a tag symbol can be, as a RADIUS in paper inches. */
export const TAG_INCHES_MIN = 0.05;
export const TAG_INCHES_MAX = 0.45;

/** How far a vertex may sit off the mean radius, as a share of it. */
const ROUNDNESS = 0.22;

/** A closed loop turns through a full circle; this allows for a rough one. */
const MIN_TURN = Math.PI * 1.5;

/** Corners closer than this to collinear are the same corner, in radians. */
const COLLINEAR = 0.25;

/** A sheet reference inside a symbol: `A501`, `A-101`, `S2.1`. */
export const SHEET_REFERENCE = /^[A-Z]{1,2}[-.]?\d{1,2}[.-]?\d{1,2}[A-Z]?$/;

/** The longest a tag's code can be. Longer is a note, not a tag. */
export const LONGEST_CODE = 6;

export type SymbolShape = "circle" | "square" | "diamond" | "pentagon" | "hexagon" | "other";

export type TagSymbol = {
  /** Centre, in the units the segments were given in. */
  x: number;
  y: number;
  radius: number;
  /** Distinct corners after merging collinear vertices. */
  corners: number;
  shape: SymbolShape;
  /** The text found inside, as printed, joined where a symbol holds several. */
  text: string;
  /** True when a line crosses the symbol's middle — a detail callout's split. */
  split: boolean;
  /**
   * Why this is not a wall or opening tag, or null when it may be one. A
   * symbol is REPORTED either way: a sheet that is all detail callouts and a
   * sheet where the detector failed look identical if the rejects are dropped.
   */
  rejected: "sheet-reference" | "split" | "no-text" | "code-too-long" | null;
};

export type TextForSymbol = { str: string; x: number; y: number; width: number; height: number };

function shapeOf(corners: number, points: number): SymbolShape {
  // ── A SMOOTH CIRCLE HAS NO CORNERS AT ALL ──
  //
  // At 32 segments each vertex turns by 2pi/32 = 0.196 radians, under the
  // threshold that separates a corner from a continuing edge — so the count
  // comes back ZERO and the shape read "other". A closed loop drawn from many
  // points with almost no corners is the definition of a circle, so it is
  // named from both numbers rather than from the count alone.
  if (points >= 10 && corners * 2 < points) return "circle";
  if (corners >= 10) return "circle";
  if (corners === 6) return "hexagon";
  if (corners === 5) return "pentagon";
  if (corners === 4) return "square";
  if (corners === 3) return "other";
  return "other";
}

/**
 * Corners of a closed loop, with points that merely continue a straight edge
 * removed — a circle drawn as 32 segments has 32 points and no corners, and a
 * diamond drawn as 4 segments has 4 of each.
 */
function cornerCount(points: readonly { x: number; y: number }[]): number {
  // The caller has already dropped the closing duplicate — see the walk.
  if (points.length < 3) return points.length;
  let corners = 0;
  for (let i = 0; i < points.length; i += 1) {
    const before = points[(i - 1 + points.length) % points.length];
    const at = points[i];
    const after = points[(i + 1) % points.length];
    const a = Math.atan2(at.y - before.y, at.x - before.x);
    const b = Math.atan2(after.y - at.y, after.x - at.x);
    let turn = b - a;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    if (Math.abs(turn) > COLLINEAR) corners += 1;
  }
  return corners;
}

/**
 * Every small closed symbol on the sheet, with whatever is written inside it.
 *
 * `unitsPerPaperInch` is what turns the paper-inch size bounds into the units
 * the segments use, so a tag on a 1/8in sheet and a 1/4in one are the same
 * size on paper, which is what a drafter actually controls.
 */
export function tagSymbols(input: {
  segments: readonly StrokeSegment[];
  text: readonly TextForSymbol[];
  unitsPerPaperInch: number;
}): TagSymbol[] {
  const { segments, text, unitsPerPaperInch } = input;
  if (!(unitsPerPaperInch > 0) || segments.length === 0) return [];
  const minR = TAG_INCHES_MIN * unitsPerPaperInch;
  const maxR = TAG_INCHES_MAX * unitsPerPaperInch;
  const longest = maxR * 2.5;

  const grain = minR * 0.05;
  const key = (x: number, y: number) => `${Math.round(x / grain)},${Math.round(y / grain)}`;
  const startsAt = new Map<string, number[]>();
  const short: StrokeSegment[] = [];
  for (const s of segments) {
    const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (length === 0 || length > longest) continue;
    short.push(s);
    const k = key(s.x1, s.y1);
    startsAt.set(k, [...(startsAt.get(k) ?? []), short.length - 1]);
  }

  const walked = new Set<number>();
  const found: TagSymbol[] = [];
  for (let n = 0; n < short.length; n += 1) {
    if (walked.has(n)) continue;
    const points: { x: number; y: number }[] = [];
    let at = n;
    for (let step = 0; step < short.length + 1; step += 1) {
      if (walked.has(at)) break;
      walked.add(at);
      const s = short[at];
      points.push({ x: s.x1, y: s.y1 });
      const next = (startsAt.get(key(s.x2, s.y2)) ?? []).find((c) => !walked.has(c));
      if (next === undefined) {
        points.push({ x: s.x2, y: s.y2 });
        break;
      }
      at = next;
    }
    // ── THE CLOSING VERTEX IS THE FIRST ONE AGAIN, AND IT BIASES EVERYTHING ──
    //
    // The walk ends by pushing the last segment's far end, which on a closed
    // loop is where it started. Left in, that vertex is counted twice: the
    // centroid is dragged towards it, every radius is then measured from the
    // wrong centre, and the roundness test fails on shapes with few vertices.
    // Measured — a square came out with a deviation of 3.17 against an
    // allowance of 3.4 and was dropped entirely, while a hexagon scraped
    // through at 2.52. It also counted as two corners, which made a hexagon
    // report eight. One dedupe here fixes the shape, the size and the count.
    if (
      points.length > 1 &&
      Math.abs(points[0].x - points[points.length - 1].x) < 1e-9 &&
      Math.abs(points[0].y - points[points.length - 1].y) < 1e-9
    ) {
      points.pop();
    }
    if (points.length < 3) continue;

    const cx = points.reduce((t, p) => t + p.x, 0) / points.length;
    const cy = points.reduce((t, p) => t + p.y, 0) / points.length;
    const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const radius = radii.reduce((t, r) => t + r, 0) / radii.length;
    if (radius < minR || radius > maxR) continue;
    // Every corner the same distance out: true of a circle and of a regular
    // polygon alike, which is the whole reason one walker serves both.
    if (radii.some((r) => Math.abs(r - radius) > radius * ROUNDNESS)) continue;

    let turn = 0;
    for (let k = 1; k < points.length; k += 1) {
      const a = Math.atan2(points[k - 1].y - cy, points[k - 1].x - cx);
      const b = Math.atan2(points[k].y - cy, points[k].x - cx);
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turn += d;
    }
    if (Math.abs(turn) < MIN_TURN) continue;

    const corners = cornerCount(points);
    const inside = text
      .filter((item) => {
        const mx = item.x + item.width / 2;
        const my = item.y + item.height / 2;
        return Math.hypot(mx - cx, my - cy) <= radius;
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const words = inside.map((i) => i.str.trim()).filter((s) => s !== "");

    // ── A LINE ACROSS THE MIDDLE IS A DETAIL CALLOUT'S SPLIT ──
    //
    // Looked for among ALL segments rather than the short ones, because the
    // split is often drawn as one stroke the width of the symbol and the size
    // filter above may have let it through or not.
    const split = segments.some((s) => {
      const horizontal = Math.abs(s.y2 - s.y1) < radius * 0.25;
      if (!horizontal) return false;
      const through = Math.abs((s.y1 + s.y2) / 2 - cy) < radius * 0.3;
      if (!through) return false;
      // ── THE SPLIT MUST BE INSIDE THE SYMBOL, NOT MERELY ACROSS IT ──
      //
      // A first version asked only that the line SPAN the middle, and on a
      // real floor plan that is any wall passing behind the tag: on Camp Bow
      // Wow A101 it rejected several genuine `B` tags as detail callouts
      // because a partition ran through them. A callout's divider starts and
      // ends at the symbol's own edge, so both endpoints are within it.
      const ends = Math.max(
        Math.hypot(s.x1 - cx, s.y1 - cy),
        Math.hypot(s.x2 - cx, s.y2 - cy),
      );
      const spans =
        Math.min(s.x1, s.x2) <= cx - radius * 0.5 && Math.max(s.x1, s.x2) >= cx + radius * 0.5;
      return spans && ends <= radius * 1.25;
    });

    const joined = words.join("");
    const rejected: TagSymbol["rejected"] =
      words.length === 0
        ? "no-text"
        : SHEET_REFERENCE.test(joined.toUpperCase()) && joined.length >= 3
          ? "sheet-reference"
          : split
            ? "split"
            : joined.length > LONGEST_CODE
              ? "code-too-long"
              : null;

    found.push({
      x: cx,
      y: cy,
      radius,
      corners,
      shape: shapeOf(corners, points.length),
      text: words.join(" "),
      split,
      rejected,
    });
  }
  return found;
}

/**
 * Which symbol shape this sheet uses for the thing we are looking for.
 *
 * ── LEARNED FROM THE SHEET, NOT HARD-CODED ──
 *
 * Diego's rule, and the sets prove it: a wall tag is a hexagon on one office's
 * drawings and a circle on another's. So the caller passes the symbols found
 * on a LEGEND — where every symbol is by definition the thing being legended —
 * and this says which shape dominates there. On the plan, a symbol of that
 * shape is a tag and a symbol of another shape is something else.
 *
 * Returns null when no shape dominates, which is a real answer: a legend that
 * uses three shapes equally has not told us anything, and guessing the
 * commonest by a nose would hard-code a shape by accident.
 */
export function shapeFromLegend(
  symbols: readonly TagSymbol[],
  options: { atLeast?: number; share?: number } = {},
): SymbolShape | null {
  const atLeast = options.atLeast ?? 2;
  const share = options.share ?? 0.6;
  const usable = symbols.filter((s) => s.rejected === null || s.rejected === "no-text");
  if (usable.length < atLeast) return null;
  const counts = new Map<SymbolShape, number>();
  for (const one of usable) counts.set(one.shape, (counts.get(one.shape) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [shape, count] = ranked[0];
  return count / usable.length >= share ? shape : null;
}

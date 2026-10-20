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
 * ── A DIAMOND IS A SQUARE STOOD ON ITS CORNER, AND THE DIFFERENCE IS THE TAG ──
 *
 * Measured on Camp Bow Wow A101 (2026-10-20): the wall-type tags are DIAMONDS
 * (`A`, `D`, `E`), the door marks are axis-aligned pills (`102`, `101A`) and
 * the room numbers sit in axis-aligned boxes. All three have four corners, so
 * a corner count calls them all "square" and a set's shape cannot be learned.
 * The orientation of the edges is what tells them apart, and it is read here
 * rather than guessed: edges near the axes are a square, edges near 45° a
 * diamond.
 *
 * ── A SPLIT SYMBOL IS NOT ALWAYS A DETAIL CALLOUT ──
 *
 * A section or detail callout is a small closed symbol with a divider: detail
 * number above, sheet below. The first version of this rejected EVERY split
 * symbol on that basis, and ELEVEN03 then read zero wall tags on a sheet that
 * carries nineteen — its partition tag is a split box with the type code
 * above the line and the fire rating below: `MC` over `1 HR`, `WS` over
 * `2 HR`. So the divider is recorded and never decides on its own. What
 * decides is what the halves SAY: a half that is a sheet reference makes a
 * callout; anything else is a tag whose code is one of its halves, and the
 * legend's vocabulary chooses which.
 *
 * ── AND A TAG POINTS AT ITS WALL ──
 *
 * Both sets draw a short LEADER from the symbol to the wall it names — a stem
 * off a diamond's corner on Camp Bow Wow, a line off the box's edge on
 * ELEVEN03. Where one exists its far end is a better anchor than the symbol's
 * centre: a tag set between two parallel walls is ambiguous by distance and
 * unambiguous by where its leader lands. Measured before this was added, 16 of
 * 56 legend-coded symbols on A101 failed the clear-margin rule for exactly that
 * reason. The leader is followed here, as geometry, and the pairing in
 * `symbolTagging.ts` anchors on its end when there is one.
 *
 * Neither the halves nor the leader are a judgement about what the code
 * means. A tag's code is whatever the legend says it is, and this file never
 * guesses at one.
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

/** Vertices closer than this share of the loop's extent are one vertex. */
const CHAMFER = 0.04;

/**
 * How far an edge may lean from the axes and still make a SQUARE, or from the
 * diagonals and still make a DIAMOND, in radians. Fifteen degrees: a drafter's
 * symbol is drawn exactly, and a rotated detail view is the only thing that
 * would land between, which is rightly "other".
 */
const AXIS_LEAN = Math.PI / 12;

/**
 * A sheet reference inside a symbol: `A501`, `A-101`, `S2.1`, `A0.003`.
 *
 * Three digits, or a dot between digit groups. It used to admit any one or
 * two letters followed by up to four digits, which read ELEVEN03's wall type
 * `WT-12` as a sheet and rejected every tag carrying it — a two-letter,
 * two-digit code is the commonest partition code there is.
 */
export const SHEET_REFERENCE = /^[A-Z]{1,2}-?(?:\d{3,4}|\d{1,2}\.\d{1,3})[A-Z]?$/;

/** The longest a tag's code can be. Longer is a note, not a tag. */
export const LONGEST_CODE = 6;

/**
 * How long a leader may be, as a multiple of the symbol's radius.
 *
 * A leader is a short stroke from the symbol to the thing it labels — on the
 * measured sheets 1 to 6 radii. A grid line or a dimension line also touches a
 * symbol and runs the width of the building, and this is what keeps those from
 * being followed.
 */
export const LEADER_MAX_RADII = 10;

/** How many strokes a bent leader may be made of. */
const LEADER_MAX_HOPS = 3;

export type SymbolShape =
  | "circle"
  | "square"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "other";

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
  /**
   * The text split at the divider where there is one — `["MC", "1 HR"]` —
   * else the one joined string. The legend's vocabulary decides which part
   * is the code; this file only keeps them apart.
   */
  parts: string[];
  /** True when a line crosses the symbol's middle, from edge to edge. */
  split: boolean;
  /**
   * Where the symbol's leader ends, in the same units, or null when no short
   * stroke leaves the symbol. The thing the tag names is at this point.
   */
  leader: { x: number; y: number } | null;
  /**
   * Why this is not a wall or opening tag, or null when it may be one. A
   * symbol is REPORTED either way: a sheet that is all detail callouts and a
   * sheet where the detector failed look identical if the rejects are dropped.
   */
  rejected: "sheet-reference" | "no-text" | "code-too-long" | null;
};

export type TextForSymbol = { str: string; x: number; y: number; width: number; height: number };

type Point = { x: number; y: number };

function shapeOf(corners: number, points: readonly Point[]): SymbolShape {
  // ── A SMOOTH CIRCLE HAS NO CORNERS AT ALL ──
  //
  // At 32 segments each vertex turns by 2pi/32 = 0.196 radians, under the
  // threshold that separates a corner from a continuing edge — so the count
  // comes back ZERO and the shape read "other". A closed loop drawn from many
  // points with almost no corners is the definition of a circle, so it is
  // named from both numbers rather than from the count alone.
  if (points.length >= 10 && corners * 2 < points.length) return "circle";
  if (corners >= 10) return "circle";
  if (corners === 6) return "hexagon";
  if (corners === 5) return "pentagon";
  if (corners === 4) return fourCornered(points);
  return "other";
}

/**
 * Square or diamond, from how the edges lean.
 *
 * Every edge's angle is folded into [0, 90°): an axis-aligned edge lands near
 * 0 or 90, a diagonal one near 45. A shape whose edges all agree is named; one
 * that mixes them is a rotated something and stays "other".
 */
function fourCornered(points: readonly Point[]): SymbolShape {
  const quarter = Math.PI / 2;
  let onAxis = 0;
  let onDiagonal = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    // A rounded corner is drawn as a few tiny pieces whose directions say
    // nothing about the shape; only an edge long enough to be an edge votes.
    if (length < 1e-9) continue;
    const angle = ((Math.atan2(b.y - a.y, b.x - a.x) % quarter) + quarter) % quarter;
    const offAxis = Math.min(angle, quarter - angle);
    if (offAxis <= AXIS_LEAN) onAxis += 1;
    else if (Math.abs(angle - quarter / 2) <= AXIS_LEAN) onDiagonal += 1;
  }
  if (onAxis > 0 && onDiagonal === 0) return "square";
  if (onDiagonal > 0 && onAxis === 0) return "diamond";
  return "other";
}

/**
 * Corners of a closed loop, with points that merely continue a straight edge
 * removed — a circle drawn as 32 segments has 32 points and no corners, and a
 * diamond drawn as 4 segments has 4 of each.
 */
function cornerCount(points: readonly Point[]): number {
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
 * The far end of the leader leaving a symbol, or null.
 *
 * A leader starts AT the symbol's edge — one endpoint within a band around the
 * radius, the other clearly outside — and is short. It may bend, so once the
 * first stroke is found the chain is followed from its far end for a few hops.
 * A stroke that passes THROUGH the symbol (both ends outside) is a wall behind
 * the tag, and a stroke wholly inside it is the divider or an underline;
 * neither is followed.
 *
 * `nearby` is every segment with an endpoint close to the symbol, found by the
 * caller's spatial index so this does not scan the sheet once per symbol.
 */
function leaderEnd(
  centre: Point,
  radius: number,
  nearby: readonly StrokeSegment[],
  all: readonly StrokeSegment[],
  grain: number,
): Point | null {
  const dist = (p: Point) => Math.hypot(p.x - centre.x, p.y - centre.y);
  const onEdge = (p: Point) => {
    const d = dist(p);
    return d >= radius * 0.6 && d <= radius * 1.4;
  };
  const outside = (p: Point) => dist(p) > radius * 1.4;
  const maxLength = radius * LEADER_MAX_RADII;

  let first: { from: Point; to: Point; length: number } | null = null;
  for (const s of nearby) {
    const a = { x: s.x1, y: s.y1 };
    const b = { x: s.x2, y: s.y2 };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < radius * 0.3 || length > maxLength) continue;
    let from: Point | null = null;
    let to: Point | null = null;
    if (onEdge(a) && outside(b)) {
      from = a;
      to = b;
    } else if (onEdge(b) && outside(a)) {
      from = b;
      to = a;
    }
    if (from === null || to === null) continue;
    // The shortest qualifying stroke wins. Where two leave the symbol — a
    // leader and a dimension witness line that happens to stop at it — the
    // leader is the one drawn to reach something close.
    if (first === null || length < first.length) first = { from, to, length };
  }
  if (first === null) return null;

  // Follow the bend. A leader drawn as two or three strokes shares endpoints
  // exactly, the same fact the loop walk relies on.
  const same = (p: Point, q: Point) => Math.abs(p.x - q.x) <= grain && Math.abs(p.y - q.y) <= grain;
  let end = first.to;
  let travelled = first.length;
  const used = new Set<StrokeSegment>();
  for (let hop = 1; hop < LEADER_MAX_HOPS; hop += 1) {
    let next: { to: Point; length: number; segment: StrokeSegment } | null = null;
    for (const s of all) {
      if (used.has(s)) continue;
      const a = { x: s.x1, y: s.y1 };
      const b = { x: s.x2, y: s.y2 };
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-9 || travelled + length > maxLength) continue;
      const to = same(a, end) ? b : same(b, end) ? a : null;
      if (to === null) continue;
      // Not back into the symbol, and not the symbol's own edge.
      if (!outside(to)) continue;
      if (next === null || length < next.length) next = { to, length, segment: s };
    }
    if (next === null) break;
    used.add(next.segment);
    end = next.to;
    travelled += next.length;
  }
  return end;
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
  // ── A STROKE IS INDEXED BY BOTH ENDS, BECAUSE IT HAS NO DIRECTION ──
  //
  // The first walker followed strokes head to tail: from where one ENDED to
  // where another STARTED. Gen BBQ A101 draws each wall tag's diamond as four
  // strokes that do not chain — two leave the left vertex, two arrive at the
  // right one — so no head-to-tail walk closes, and 0 of its tags were found
  // on a sheet that prints them beside every wall. Which way a CAD export
  // happens to emit a polyline's edges is not a property of the drawing, so
  // the walk treats every stroke as passable in either direction.
  const touches = new Map<string, number[]>();
  const short: StrokeSegment[] = [];
  for (const s of segments) {
    const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (length === 0 || length > longest) continue;
    short.push(s);
    for (const k of new Set([key(s.x1, s.y1), key(s.x2, s.y2)])) {
      touches.set(k, [...(touches.get(k) ?? []), short.length - 1]);
    }
  }

  // ── EVERY SEGMENT, BY WHERE ITS ENDS ARE ──
  //
  // The leader search asks "which strokes end near this symbol", once per
  // symbol. On A101 that is 400 symbols against 425,000 segments, so it is
  // answered from a coarse grid of endpoints rather than by scanning.
  const cell = maxR * 2;
  const cellKey = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const endsIn = new Map<string, StrokeSegment[]>();
  for (const s of segments) {
    for (const k of new Set([cellKey(s.x1, s.y1), cellKey(s.x2, s.y2)])) {
      endsIn.set(k, [...(endsIn.get(k) ?? []), s]);
    }
  }
  const near = (cx: number, cy: number): StrokeSegment[] => {
    const out: StrokeSegment[] = [];
    const x0 = Math.floor(cx / cell);
    const y0 = Math.floor(cy / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const s of endsIn.get(`${x0 + dx},${y0 + dy}`) ?? []) out.push(s);
      }
    }
    return out;
  };

  const walked = new Set<number>();
  const found: TagSymbol[] = [];
  const sameVertex = (a: Point, b: Point) => Math.abs(a.x - b.x) <= grain && Math.abs(a.y - b.y) <= grain;

  /** One stroke, walked from one of its ends to the other. */
  type Step = { seg: number; reversed: boolean };
  const entryOf = (st: Step): Point => {
    const s = short[st.seg];
    return st.reversed ? { x: s.x2, y: s.y2 } : { x: s.x1, y: s.y1 };
  };
  const exitOf = (st: Step): Point => {
    const s = short[st.seg];
    return st.reversed ? { x: s.x1, y: s.y1 } : { x: s.x2, y: s.y2 };
  };

  /** The unwalked strokes that touch where this step ends, entered at that end. */
  const continuations = (from: Step): Step[] => {
    const at = exitOf(from);
    const out: Step[] = [];
    for (const c of touches.get(key(at.x, at.y)) ?? []) {
      if (c === from.seg || walked.has(c)) continue;
      const s = short[c];
      out.push({ seg: c, reversed: !sameVertex(at, { x: s.x1, y: s.y1 }) });
    }
    return out;
  };

  /**
   * The closed loop through one stroke, or null.
   *
   * A depth-first walk that backs out of dead ends, and that is the whole
   * point of it. Camp Bow Wow draws each tag's diamond twice, a hair apart,
   * and draws its leader ending exactly on a vertex — so a vertex offers the
   * loop's own next edge, the other diamond's edge, and the stem. A walk that
   * took the first unwalked stroke and never looked back went up the stem,
   * found nothing, and had SPENT the diamond's strokes: 21 of 46 tags on A101
   * were reported as their masking box because the box was the only loop
   * left closed. Here a branch that dead-ends is abandoned and the next tried,
   * and nothing is marked walked until a loop is found. `BUDGET` bounds the
   * search on a sheet whose strokes all touch.
   */
  const BUDGET = 4000;
  const walkLoop = (start: Step): { cycle: Point[]; used: number[] } | null => {
    const origin = entryOf(start);
    const path: Step[] = [start];
    const pts: Point[] = [origin];
    const onPath = new Set<number>([start.seg]);
    const stack: { options: Step[]; i: number }[] = [{ options: continuations(start), i: 0 }];
    let budget = BUDGET;
    while (stack.length > 0 && budget > 0) {
      budget -= 1;
      const top = stack[stack.length - 1];
      if (path.length >= 3 && sameVertex(origin, exitOf(path[path.length - 1]))) {
        return { cycle: pts, used: path.map((st) => st.seg) };
      }
      let next: Step | undefined;
      while (top.i < top.options.length && next === undefined) {
        const candidate = top.options[top.i];
        top.i += 1;
        if (!onPath.has(candidate.seg)) next = candidate;
      }
      if (next === undefined || path.length > 256) {
        stack.pop();
        const dropped = path.pop();
        if (dropped !== undefined) onPath.delete(dropped.seg);
        pts.pop();
        continue;
      }
      path.push(next);
      onPath.add(next.seg);
      pts.push(entryOf(next));
      stack.push({ options: continuations(next), i: 0 });
    }
    return null;
  };

  for (let n = 0; n < short.length; n += 1) {
    if (walked.has(n)) continue;
    // One direction is enough: a loop through this stroke closes either way.
    const loop = walkLoop({ seg: n, reversed: false });
    // A stroke that leads to no loop is spent either way: trying it again
    // from another start would find the same nothing.
    walked.add(n);
    if (loop === null) continue;
    for (const used of loop.used) walked.add(used);
    const points: Point[] = loop.cycle;
    if (points.length < 3) continue;

    // ── A CHAMFERED CORNER IS ONE CORNER ──
    //
    // Camp Bow Wow's diamonds are drawn with a 0.2-point chamfer at each
    // vertex, so each corner arrives as two vertices a hair apart and the
    // count came back eight or nine for a four-sided shape — "other", which
    // no legend draws. Vertices closer together than a small share of the
    // loop's size are one vertex. Measured first against the loop's own
    // extent rather than its radius, which is not known until after.
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const merged: Point[] = [];
    for (const p of points) {
      const last = merged[merged.length - 1];
      if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < extent * CHAMFER) {
        // The corner is between the two chamfer points, not at either.
        merged[merged.length - 1] = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
        continue;
      }
      merged.push(p);
    }
    if (
      merged.length > 1 &&
      Math.hypot(merged[0].x - merged[merged.length - 1].x, merged[0].y - merged[merged.length - 1].y) <
        extent * CHAMFER
    ) {
      merged.pop();
    }
    if (merged.length < 3) continue;
    points.length = 0;
    points.push(...merged);

    const cx = points.reduce((t, p) => t + p.x, 0) / points.length;
    const cy = points.reduce((t, p) => t + p.y, 0) / points.length;
    const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const radius = radii.reduce((t, r) => t + r, 0) / radii.length;
    if (radius < minR || radius > maxR) continue;
    // Every corner the same distance out: true of a circle and of a regular
    // polygon alike, which is the whole reason one walker serves both.
    if (radii.some((r) => Math.abs(r - radius) > radius * ROUNDNESS)) continue;

    // ── ALL THE WAY ROUND, INCLUDING THE STEP BACK TO THE START ──
    //
    // Summed over n-1 steps a closed four-sided loop turns exactly 270°,
    // which is exactly `MIN_TURN` — so a square or a diamond passed or failed
    // on floating-point noise in its coordinates. Found when the same box
    // was detected at x=280 and not at x=100. The closing step makes any
    // closed loop a full turn and gives the threshold real slack.
    let turn = 0;
    for (let k = 1; k <= points.length; k += 1) {
      const a = Math.atan2(points[k - 1].y - cy, points[k - 1].x - cx);
      const b = Math.atan2(points[k % points.length].y - cy, points[k % points.length].x - cx);
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turn += d;
    }
    if (Math.abs(turn) < MIN_TURN) continue;

    const corners = cornerCount(points);
    // ── A TEXT ITEM'S y IS ITS BASELINE ──
    //
    // `planPdf` reports each string at its text origin, which is the start of
    // the BASELINE, with y running down the page. The glyphs sit above it, so
    // the lettering's centre is half a height ABOVE y, not below. Read as
    // "y + height/2" the centre lands a full line too low: on ELEVEN03 the
    // upper half of a split tag, `MC`, computed as sitting below the divider,
    // and the halves never separated on a real sheet while the fixture passed.
    const centreOf = (item: TextForSymbol) => ({
      x: item.x + item.width / 2,
      y: item.y - item.height / 2,
    });
    const inside = text
      .filter((item) => {
        const c = centreOf(item);
        return Math.hypot(c.x - cx, c.y - cy) <= radius;
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);

    // ── A LINE ACROSS THE MIDDLE IS A DIVIDER ──
    //
    // Looked for among ALL segments rather than the short ones, because the
    // divider is often drawn as one stroke the width of the symbol and the
    // size filter above may have let it through or not.
    //
    // ── THE DIVIDER MUST BE INSIDE THE SYMBOL, NOT MERELY ACROSS IT ──
    //
    // A first version asked only that the line SPAN the middle, and on a real
    // floor plan that is any wall passing behind the tag: on Camp Bow Wow A101
    // it rejected several genuine `B` tags as detail callouts because a
    // partition ran through them. A divider starts and ends at the symbol's
    // own edge, so both endpoints are within it.
    const divider = near(cx, cy).find((s) => {
      const horizontal = Math.abs(s.y2 - s.y1) < radius * 0.25;
      if (!horizontal) return false;
      const through = Math.abs((s.y1 + s.y2) / 2 - cy) < radius * 0.3;
      if (!through) return false;
      const ends = Math.max(Math.hypot(s.x1 - cx, s.y1 - cy), Math.hypot(s.x2 - cx, s.y2 - cy));
      const spans =
        Math.min(s.x1, s.x2) <= cx - radius * 0.5 && Math.max(s.x1, s.x2) >= cx + radius * 0.5;
      return spans && ends <= radius * 1.25;
    });
    const split = divider !== undefined;

    // ── THE HALVES, KEPT APART ──
    //
    // Above the divider and below it, each joined in reading order. Without a
    // divider there is one part. The legend decides which part is the code;
    // here the only question is whether either half names another SHEET,
    // which is what a detail callout does and a tag never does.
    const wordsOf = (items: readonly TextForSymbol[]) =>
      items.map((i) => i.str.trim()).filter((s) => s !== "");
    const dividerY = divider === undefined ? cy : (divider.y1 + divider.y2) / 2;
    const above = split ? inside.filter((i) => centreOf(i).y < dividerY) : inside;
    const below = split ? inside.filter((i) => centreOf(i).y >= dividerY) : [];
    const parts = [wordsOf(above).join(" "), wordsOf(below).join(" ")].filter((p) => p !== "");
    const words = wordsOf(inside);

    const isSheetReference = (s: string) => {
      const compact = s.replace(/\s+/g, "").toUpperCase();
      return compact.length >= 3 && SHEET_REFERENCE.test(compact);
    };
    const rejected: TagSymbol["rejected"] =
      words.length === 0
        ? "no-text"
        : parts.some(isSheetReference) || isSheetReference(words.join(""))
          ? "sheet-reference"
          : parts.every((p) => p.replace(/\s+/g, "").length > LONGEST_CODE)
            ? "code-too-long"
            : null;

    found.push({
      x: cx,
      y: cy,
      radius,
      corners,
      shape: shapeOf(corners, points),
      text: words.join(" "),
      parts,
      split,
      leader: rejected === null ? leaderEnd({ x: cx, y: cy }, radius, near(cx, cy), segments, grain) : null,
      rejected,
    });
  }

  // ── ONE SYMBOL DRAWN THREE TIMES IS ONE SYMBOL ──
  //
  // Read off the strokes of one Camp Bow Wow wall tag: a diamond, a second
  // diamond a hair inside it, and an axis-aligned BOX around both — the
  // masking rectangle the CAD export draws behind the tag so the wall does
  // not show through. All three close around the same letter. The first
  // version kept the largest, which is the mask, and the plan's tags then
  // read "square" against a legend that draws diamonds, and matched nothing.
  //
  // And the legend sheet draws it the other way about: its diamonds are
  // bigger, and the mask is a box INSIDE the diamond behind the letter. So
  // size cannot decide which loop is the symbol — on one sheet the mask is
  // outermost and on the other innermost. What is constant is that a mask is
  // an axis-aligned box. Where symbols share a centre and their words, a
  // named shape that is not a square beats a square; among equals the
  // smallest stands; and only when nothing has a name does the largest.
  const sameSymbol = (a: TagSymbol, b: TagSymbol) =>
    a.text.toUpperCase() === b.text.toUpperCase() &&
    Math.hypot(a.x - b.x, a.y - b.y) <= Math.max(a.radius, b.radius) * 0.5;
  const smallest = (list: TagSymbol[]) => list.reduce((best, t) => (t.radius < best.radius ? t : best));
  return found.filter((s) => {
    const family = found.filter((t) => sameSymbol(s, t));
    if (family.length === 1) return true;
    const drawn = family.filter((t) => t.shape !== "other" && t.shape !== "square");
    const named = family.filter((t) => t.shape !== "other");
    const keep =
      drawn.length > 0
        ? smallest(drawn)
        : named.length > 0
          ? smallest(named)
          : family.reduce((best, t) => (t.radius > best.radius ? t : best));
    return keep === s;
  });
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
 * commonest by a nose would hard-code a shape by accident. A legend drawn as
 * a TABLE, with the codes in a column and no symbol at all — ELEVEN03's — also
 * teaches nothing, and the caller then takes any shape.
 */
export function shapeFromLegend(
  symbols: readonly TagSymbol[],
  options: { atLeast?: number; share?: number; codes?: readonly string[] } = {},
): SymbolShape | null {
  const atLeast = options.atLeast ?? 2;
  const share = options.share ?? 0.6;
  // ── THE LEGEND'S OWN CODES, WHERE THE CALLER HAS THEM ──
  //
  // A legend sheet carries more than its tags: Camp Bow Wow A130 numbers its
  // general notes in small boxes, `10.` to `13.`, and those outvoted the five
  // diamonds that are the tags. When the codes are known, only a symbol
  // holding one teaches anything; without them every usable symbol votes, as
  // before.
  const known = new Set((options.codes ?? []).map((c) => c.trim().toUpperCase()).filter((c) => c !== ""));
  const holdsCode = (s: TagSymbol) =>
    [s.text, ...s.parts].some((p) => known.has(p.trim().toUpperCase()));
  const usable =
    known.size > 0
      ? symbols.filter((s) => s.rejected === null && holdsCode(s))
      : symbols.filter((s) => s.rejected === null || s.rejected === "no-text");
  if (usable.length < atLeast) return null;
  const counts = new Map<SymbolShape, number>();
  for (const one of usable) counts.set(one.shape, (counts.get(one.shape) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [shape, count] = ranked[0];
  return count / usable.length >= share ? shape : null;
}

import { clusters, GREY_PEN, strokesInBox, withoutText, type Box, type TextBox } from "./symbolSignature";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE SYMBOL IN AN ESTIMATOR'S BOX, WHATEVER THE BOX ──
 *
 * Count like this took its template from everything in the box, with a
 * "touching" distance and a "central" zone that both grew with the box. So a
 * loose box joined neighbouring fixtures, ceiling-grid pieces and text into
 * "the symbol", and the count moved with the drag: 20 boxes round one R1 troffer
 * on Baker EL1.01 counted anywhere from 12 to 52.
 *
 * Here the box only says WHERE. The black ink wholly inside it is grouped with a
 * fixed gap that does not depend on the box, pieces drawn on top of each other
 * are one symbol (an E2's arc round its circle), specks are ignored, and the symbol's
 * own tight bounds become the box the template is made from. A box holding two
 * or more comparable symbols is not guessed at: the estimator picks one.
 */
export type BoxedSymbols = { kind: "none" } | { kind: "one"; box: Box } | { kind: "several"; boxes: Box[] };

/** Parts of one symbol touch closer than this, in page widths: 1.5 pt on a 36-inch sheet. */
export const SYMBOL_GAP = 0.0006;
/** A piece with less ink than this share of the box's is a speck, not a symbol. */
const SPECK = 0.05;
/** A second piece with at least this share of the largest one's ink is a second symbol. */
const RIVAL = 0.4;

type Piece = { strokes: StrokeSegment[]; b: Box; ink: number };
const len = (s: StrokeSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const bounds = (strokes: readonly StrokeSegment[]): Box => ({
  x1: Math.min(...strokes.flatMap((s) => [s.x1, s.x2])),
  y1: Math.min(...strokes.flatMap((s) => [s.y1, s.y2])),
  x2: Math.max(...strokes.flatMap((s) => [s.x1, s.x2])),
  y2: Math.max(...strokes.flatMap((s) => [s.y1, s.y2])),
});
/**
 * The bounds of the middle 90% of a symbol's ink on each axis. A sign's
 * direction arrow is drawn touching its circle, so no gap separates it, and it
 * made the template one sign's and not every sign's (Baker X1: 1 found, not 5).
 * A troffer's or a circle's own edges hold far more than 5% of its ink at each
 * extreme, so they stay.
 */
function core(strokes: readonly StrokeSegment[]): Box {
  const axis = (pick: (s: StrokeSegment) => [number, number]) => {
    const items = strokes.map((s) => { const [a, b] = pick(s); return { lo: Math.min(a, b), hi: Math.max(a, b), ink: len(s) }; });
    const total = items.reduce((n, i) => n + i.ink, 0);
    const at = (share: number, side: "lo" | "hi") => {
      const sorted = [...items].sort((p, q) => (side === "lo" ? p.lo - q.lo : q.hi - p.hi));
      let seen = 0;
      for (const i of sorted) {
        seen += i.ink;
        if (seen >= total * share) return side === "lo" ? i.lo : i.hi;
      }
      return side === "lo" ? sorted[0]!.lo : sorted[0]!.hi;
    };
    return [at(0.05, "lo"), at(0.05, "hi")] as const;
  };
  const [x1, x2] = axis((s) => [s.x1, s.x2]);
  const [y1, y2] = axis((s) => [s.y1, s.y2]);
  return { x1, y1, x2, y2 };
}
const size = (b: Box) => Math.max(b.x2 - b.x1, b.y2 - b.y1);
const gapBetween = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x1 - b.x2, b.x1 - a.x2), Math.max(0, a.y1 - b.y2, b.y1 - a.y2));
const pad = (b: Box): Box => {
  const p = Math.max(size(b) * 0.15, 2 * SYMBOL_GAP);
  return { x1: b.x1 - p, y1: b.y1 - p, x2: b.x2 + p, y2: b.y2 + p };
};

export function symbolsInBox(segments: readonly StrokeSegment[], text: readonly TextBox[], box: Box): BoxedSymbols {
  const x1 = Math.min(box.x1, box.x2), x2 = Math.max(box.x1, box.x2), y1 = Math.min(box.y1, box.y2), y2 = Math.max(box.y1, box.y2);
  // A box drawn a little inside a troffer's outline still means the troffer, so
  // a stroke crossing the box's edge counts when it is no longer than the box
  // (`strokesInBox`); a wall running through does not.
  const whole = strokesInBox(withoutText(segments, text), box);
  // Black ink when there is any. The existing black-or-grey rule weighs the shares
  // of the whole box, so a bigger box kept the grey ceiling grid, and the grid
  // joined a troffer to its neighbours.
  const black = whole.filter((s) => (s.gray ?? 0) < GREY_PEN);
  const ink = black.length > 0 ? black : whole;
  if (ink.length === 0) return { kind: "none" };
  const total = ink.reduce((n, s) => n + len(s), 0);
  const pieces: Piece[] = clusters(ink, Math.hypot(x2 - x1, y2 - y1), SYMBOL_GAP)
    .map((strokes) => ({ strokes, b: bounds(strokes), ink: strokes.reduce((n, s) => n + len(s), 0) }))
    .filter((p) => p.ink >= total * SPECK);
  if (pieces.length === 0) return { kind: "none" };
  // The symbol is the largest piece and everything drawn ON it: a piece whose
  // outline overlaps the symbol's (a lamp line inside a troffer, an E2's arc round
  // its circle). A piece merely NEAR it is a neighbour's or a leader's, not its
  // own: an X1's direction arrow beside the circle, which matched only itself.
  pieces.sort((a, b) => b.ink - a.ink);
  const overlaps = (a: Box, b: Box) => gapBetween(a, b) <= SYMBOL_GAP;
  const grow = (seed: Piece, rest: Piece[]) => {
    let symbol = seed;
    for (let added = true; added; ) {
      added = false;
      for (let k = 0; k < rest.length; k += 1) {
        if (!overlaps(symbol.b, rest[k]!.b)) continue;
        const strokes = [...symbol.strokes, ...rest[k]!.strokes];
        symbol = { strokes, b: bounds(strokes), ink: symbol.ink + rest[k]!.ink };
        rest.splice(k, 1);
        added = true;
        break;
      }
    }
    return symbol;
  };
  const symbols: Piece[] = [];
  const rest = [...pieces];
  while (rest.length > 0) {
    const seed = rest.shift()!;
    const symbol = grow(seed, rest);
    // A second symbol is one with ink comparable to the first; anything smaller is a stray.
    if (symbols.length === 0 || symbol.ink >= symbols[0]!.ink * RIVAL) symbols.push(symbol);
  }
  if (symbols.length === 1) return { kind: "one", box: pad(core(symbols[0]!.strokes)) };
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const away = (p: Piece) => Math.hypot((p.b.x1 + p.b.x2) / 2 - cx, (p.b.y1 + p.b.y2) / 2 - cy);
  return { kind: "several", boxes: symbols.sort((a, b) => away(a) - away(b)).map((p) => pad(core(p.strokes))) };
}

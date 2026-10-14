import type { WallCandidate } from "./wallVectors";
import type { PageTextItem } from "./wallTags";

/**
 * ── THE GRAPHIC SCALE BAR, WHICH IS A PERFECT WALL BY EVERY GEOMETRIC TEST ──
 *
 * Found on School-01 by a click-through, not by a filter, and it had been there
 * the whole time: a 5-3/8" group holding one 32 ft run, drawn exactly on the
 * bar marked 0 · 4 · 8 · 16 · 32 beneath the plan. It only became visible when
 * #730 removed the group above it and promoted this one into the panel.
 *
 * ── WHY NOTHING ELSE CATCHES IT, AND WHY THAT IS NOT AN OVERSIGHT ──
 *
 * A scale bar is two long parallel lines a wall-thickness apart. That is the
 * definition of a wall in `wallVectors.ts`, and every filter downstream tests
 * the same kinds of thing:
 *
 *   `wallFromPair`           parallel, overlapping, 2-12in apart — it passes
 *   minLengthFeet            32 ft, far over — it passes
 *   `wallsInTheBuilding`     it sits just below the plan, inside the cluster
 *   `wallsNotLettering`      only drops runs SHORTER than 4 ft
 *   `wallsNotTheSheetBorder` nowhere near the edge
 *   `inAHatchSeries`         it is a pair, not a series
 *   the template filter      the bar changes with the sheet's scale
 *
 * So no measurement of the LINES can tell this from a wall, and reaching for a
 * tighter bound would cost real walls to catch it. What distinguishes a scale
 * bar is not its geometry — it is that **somebody printed a ruler's numbers
 * along it.**
 *
 * ── THE TEST IS THE ZERO ──
 *
 * Three or more bare numbers lying along the run, close to it, ascending, and
 * **starting at 0**. The zero is what makes this safe rather than clever: no
 * wall on any drawing has a `0` printed an inch from it. Room numbers run
 * 110, 111, 112 and never start at zero; a dimension string reads `30'-0"` and
 * is one item, not a series; a grid line is lettered or numbered once at its
 * bubble.
 *
 * It degrades the safe way. A bar whose numbers were drawn as line work rather
 * than text is not caught, and nothing that is caught today stops being caught
 * — this only ever removes a run, and only one wearing a ruler.
 *
 * Pure. No database, no React.
 */

/** A bare number as a scale bar prints one: `0`, `4`, `16`, `32`, and with an
 *  optional foot mark for the bars that carry one. Anything with an inch mark,
 *  a letter or a dash is a dimension, a room number or a grid bubble. */
const BARE_NUMBER = /^(\d{1,3})\s*['′’]?$/;

/** How close to the run a label must sit, in FEET of building. A scale bar's
 *  numbers are printed against it; the nearest competing text is a room tag in
 *  the middle of a 10 ft room, five feet off. */
export const LABEL_REACH_FEET = 2.5;

/** How many labels make a ruler. Two numbers near a line is a coincidence a
 *  real drawing produces; three ascending from zero is not. */
export const LABELS_FOR_A_RULER = 3;

/** How much of the run the labels must span. A ruler is numbered end to end —
 *  a cluster of numbers against one end of a long wall is something else. */
export const SPANS_THE_RUN = 0.5;

/** A number printed on the sheet, in page-width units — the same convention
 *  `wallTypeTags` uses, so there is one normalisation in this folder and not
 *  two that can disagree. */
export type ScaleLabel = { value: number; x: number; y: number };

/**
 * A ruler's numbers, with how far along they sit — and what they imply.
 *
 * ── ONE DERIVATION, TWO CALLERS, BECAUSE THEY MUST NOT DISAGREE ──
 *
 * This file already decided what a ruler is: three or more bare numbers,
 * ascending, starting at zero. `wearsARuler` used that to DROP a run, computed
 * exactly the ladder below, and then returned a boolean — throwing away the one
 * number the ladder contains. `scaleFromBar.ts` needs that number.
 *
 * If each of them tested "is this a ruler" its own way, the two could disagree:
 * a bar read for its scale but not removed from the walls would be billed as a
 * 32 ft wall AND used to scale the sheet. So the test lives here once.
 *
 * ── WHAT THE LINEAR FIT ADDS, AND WHY IT IS NOT JUST TIDINESS ──
 *
 * Ascending-from-zero is enough to RECOGNISE a bar. It is not enough to MEASURE
 * one. A graphic scale is linear — `0 · 4 · 8 · 16 · 32` is printed with 8-to-16
 * twice as far as 4-to-8 — so value is proportional to distance along the bar,
 * and the constant of proportionality IS the scale. Checking that the fit holds
 * is therefore the same thing as checking the reading is worth having: a set of
 * numbers that ascends from zero but is not proportional to its own positions
 * is not a ruler, whatever else it is.
 *
 * Tolerance is relative to the bar's own span, so this needs no notion of paper
 * size, page units or scale — which is the whole point. `scaleFromBar` runs
 * BEFORE any scale is known.
 *
 * Returns feet per unit of whatever `at` was measured in. Callers in page-width
 * units get feet per page-width unit; `wearsARuler` already works in those.
 */
export type Ladder = { feetPerUnit: number; span: number };

/** How far a label may sit off a perfect fit, as a fraction of the bar's span.
 *  A printed ruler's numbers are set by the drawing program, not by hand, so
 *  the real error is typesetting centring — well inside a fiftieth. */
export const LADDER_FIT = 0.02;

export function rulerLadder(pairs: readonly { at: number; value: number }[]): Ladder | null {
  if (pairs.length < LABELS_FOR_A_RULER) return null;

  const along = [...pairs].sort((a, b) => a.at - b.at);
  const values = along.map((one) => one.value);
  const climbs = (list: number[]) => list.every((value, i) => i === 0 || value > list[i - 1]);
  // Read in both directions: which end a bar's zero sits at depends on how it
  // was drawn, and a run's own direction is an artefact of which face the
  // pairer met first.
  if (!climbs(values) && !climbs([...values].reverse())) return null;
  // ── THE ZERO, AND AN HONEST NOTE THAT THE FIT BELOW ALREADY IMPLIES IT ──
  //
  // This file's header calls the zero the whole safety argument, and it is — it
  // is why a row of room numbers cannot be a ruler. It is kept here because it
  // states the rule where a reader looks for it.
  //
  // But it is NOT independently load-bearing, which was measured rather than
  // assumed: a mutation deleting this line leaves every test green. The linear
  // fit anchors at whichever end holds the smallest value and requires that
  // end's value to be zero, so a row that fails this already fails the fit.
  // Recorded instead of quietly removed, because the next person to delete it
  // deserves to know it is redundant rather than untested.
  if (Math.min(...values) !== 0) return null;

  const span = along[along.length - 1].at - along[0].at;
  if (!(span > 0)) return null;

  // Zero is one end or the other, and feet grow away from it.
  const zeroFirst = along[0].value === 0;
  const feetPerUnit = (Math.max(...values) - Math.min(...values)) / span;
  if (!(feetPerUnit > 0) || !Number.isFinite(feetPerUnit)) return null;

  // THE FIT. Every label must sit where its own value says it should.
  const zeroAt = zeroFirst ? along[0].at : along[along.length - 1].at;
  for (const one of along) {
    const expected = Math.abs(one.at - zeroAt) * feetPerUnit;
    if (Math.abs(expected - one.value) > span * feetPerUnit * LADDER_FIT) return null;
  }
  return { feetPerUnit, span };
}

export function scaleBarLabels(items: readonly PageTextItem[], widthPt: number): ScaleLabel[] {
  if (!(widthPt > 0)) return [];
  const out: ScaleLabel[] = [];
  for (const item of items) {
    const match = BARE_NUMBER.exec(item.str.trim());
    if (match === null) continue;
    out.push({
      value: Number(match[1]),
      x: (item.x + item.width / 2) / widthPt,
      y: (item.y + item.height / 2) / widthPt,
    });
  }
  return out;
}

/**
 * The runs that are not a graphic scale bar.
 *
 * Takes the labels already extracted rather than the page's text, so the caller
 * does one pass over the text items for this and for the wall-type tags.
 */
export function wallsNotTheScaleBar(
  walls: readonly WallCandidate[],
  labels: readonly ScaleLabel[],
  feetPerUnit: number,
): WallCandidate[] {
  if (labels.length < LABELS_FOR_A_RULER || !(feetPerUnit > 0)) return [...walls];
  return walls.filter((wall) => !wearsARuler(wall, labels, feetPerUnit));
}

function wearsARuler(
  wall: WallCandidate,
  labels: readonly ScaleLabel[],
  feetPerUnit: number,
): boolean {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  const ux = dx / length;
  const uy = dy / length;
  const reach = LABEL_REACH_FEET / feetPerUnit;

  const along: { at: number; value: number }[] = [];
  for (const label of labels) {
    const toX = label.x - wall.x1;
    const toY = label.y - wall.y1;
    const at = toX * ux + toY * uy;
    // Beside the run rather than past its end: a number off the end of a wall
    // is in whatever is drawn next to it, not on the wall.
    if (at < -reach || at > length + reach) continue;
    if (Math.abs(-uy * toX + ux * toY) > reach) continue;
    along.push({ at, value: label.value });
  }
  if (along.length < LABELS_FOR_A_RULER) return false;

  along.sort((a, b) => a.at - b.at);
  // SPANS THE RUN, which is the one test that is about the WALL rather than
  // about the ruler — a cluster of numbers against one end of a long wall is
  // something else. It stays here; the ruler test itself moved to
  // `rulerLadder`, so this cannot drift from what `scaleFromBar` reads.
  if (along[along.length - 1].at - along[0].at < length * SPANS_THE_RUN) return false;

  return rulerLadder(along) !== null;
}

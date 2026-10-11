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
  if (along[along.length - 1].at - along[0].at < length * SPANS_THE_RUN) return false;

  // ── ASCENDING, AND STARTING AT ZERO ──
  //
  // A ruler counts up from one end. Read in both directions, because which end
  // a bar's zero sits at depends on how it was drawn, and the run's own
  // direction is an artefact of which face the pairer met first.
  const values = along.map((one) => one.value);
  const climbs = (list: number[]) => list.every((value, i) => i === 0 || value > list[i - 1]);
  if (!climbs(values) && !climbs([...values].reverse())) return false;
  return Math.min(...values) === 0;
}

import type { StrokeSegment } from "./wallVectors";

/**
 * THE BORDER, THE TITLE BLOCK AND THE LOGO ARE THE ONLY GEOMETRY THAT IS ON
 * EVERY SHEET OF A SET, IN THE SAME PLACE.
 *
 * That is the whole idea, and it is why this exists rather than a fourth
 * position heuristic. A browser run on Augusta A1.11 (2026-10-10) pressed "Find
 * the walls" on a real drawing for the first time and the panel offered the
 * drawing frame as a "6-inch, 237 ft" group and the title-block cells as
 * 4-3/8" walls. #722 fixed the frame by geometry — a run both a quarter of the
 * sheet long and inside the 4% strip at its boundary — and said in as many
 * words that the title block was NOT fixed, because every cheap way to guess a
 * corner region also drops real wall: a plan is routinely drawn right up to the
 * title-block strip.
 *
 * So stop guessing where furniture is and ask what furniture IS. It is the
 * sheet template: the same lines, at the same page coordinates, on sheet 3 and
 * sheet 41. A wall is not.
 *
 * ── WHY "ON NEARLY EVERY SAMPLED SHEET" AND NOT "ON TWO" ──
 *
 * THE HAZARD THIS THRESHOLD EXISTS FOR IS IDENTICAL FLOORS. Levels 3 to 10 of
 * a tower are drawn as the same plan at the same page position, so their REAL
 * WALLS recur — and a rule that dropped anything appearing twice would delete
 * the walls of exactly the repetitive buildings this tool is most useful on.
 * That is a silent wrong answer, which is the failure mode this whole directory
 * is organised against.
 *
 * Furniture, by contrast, is on 100% of sheets. So the samples are spread
 * across the WHOLE document rather than taken from neighbours, and a segment
 * has to appear on most of them. Eight identical floor plans inside a
 * fifty-five-sheet set cannot carry four of six evenly spread samples; a border
 * can and does.
 *
 * ── IT FAILS SAFE, AND THAT DIRECTION IS DELIBERATE ──
 *
 * Fewer than `MIN_SHEETS` sampled and this returns an EMPTY set, so nothing is
 * filtered. A set of two sheets, a document that would not parse, a sample that
 * came back empty — all of them mean "cannot tell", and the cost of not
 * filtering is a panel with the border in it, which #722 already catches
 * geometrically and which a person can see. The cost of the other default is a
 * wall quietly missing from a bid.
 */

/** A quantised segment position. Not a public shape — only equality matters. */
type TemplateKey = string;

/**
 * Grid for comparing positions, in page-width units.
 *
 * TIGHT, because the comparison is between renderings of the SAME template:
 * a border line is at an identical coordinate on every sheet, not a similar
 * one. 0.0015 of a 36-inch sheet is about a twentieth of an inch — loose enough
 * for floating-point drift through the matrix, tight enough that a wall on one
 * sheet cannot collide with a different wall on another.
 */
export const TEMPLATE_GRID = 0.0015;

/** How many sheets must be sampled before any of this is trustworthy. */
export const MIN_SHEETS = 3;

/**
 * What fraction of the sampled sheets a segment must appear on.
 *
 * Not 1.0: a cover sheet or a detail sheet legitimately carries a different
 * frame, and requiring every sample would find nothing the moment one odd sheet
 * is drawn. 0.7 of six samples is four.
 */
export const ON_MOST_SHEETS = 0.7;

function keyFor(segment: StrokeSegment, grid: number): TemplateKey {
  const q = (value: number) => Math.round(value / grid);
  const a = `${q(segment.x1)},${q(segment.y1)}`;
  const b = `${q(segment.x2)},${q(segment.y2)}`;
  // CANONICAL ORDER, because the same line drawn the other way round is the
  // same line. Without this, a template whose operators run in a different
  // direction on one sheet would never match itself.
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The positions that recur across a set — its template.
 *
 * `sheets` is one entry per sampled sheet, each in PAGE-WIDTH UNITS, so the
 * comparison is between sheets of the same page size. A set mixing page sizes
 * would compare nonsense; `templateFromSheets` is called with the pages of one
 * document, which share a size in every real set, and the fail-safe above
 * covers the rest.
 */
export function templateFromSheets(
  sheets: readonly (readonly StrokeSegment[])[],
  options: { grid?: number; onMostSheets?: number; minSheets?: number } = {},
): Set<TemplateKey> {
  const grid = options.grid ?? TEMPLATE_GRID;
  const onMost = options.onMostSheets ?? ON_MOST_SHEETS;
  const minSheets = options.minSheets ?? MIN_SHEETS;

  const withContent = sheets.filter((one) => one.length > 0);
  if (withContent.length < minSheets) return new Set();

  const seenOn = new Map<TemplateKey, number>();
  for (const sheet of withContent) {
    // PER SHEET, so a line drawn twice on one sheet counts once. Hatching in a
    // repeated block would otherwise look like recurrence all by itself.
    const onThisSheet = new Set<TemplateKey>();
    for (const segment of sheet) onThisSheet.add(keyFor(segment, grid));
    for (const key of onThisSheet) seenOn.set(key, (seenOn.get(key) ?? 0) + 1);
  }

  const needed = Math.ceil(withContent.length * onMost);
  const template = new Set<TemplateKey>();
  for (const [key, count] of seenOn) {
    if (count >= needed) template.add(key);
  }
  return template;
}

/** Drop the set's own template from one sheet's strokes. */
export function withoutTemplate(
  segments: readonly StrokeSegment[],
  template: ReadonlySet<TemplateKey>,
  grid = TEMPLATE_GRID,
): StrokeSegment[] {
  if (template.size === 0) return [...segments];
  return segments.filter((segment) => !template.has(keyFor(segment, grid)));
}

/**
 * Which pages to sample, spread across the document.
 *
 * SPREAD RATHER THAN THE FIRST N, and that is the identical-floors guard made
 * concrete: the first six sheets of a set are a cover, a code sheet and the
 * lower floors, which is exactly the neighbourhood where real geometry repeats.
 * Evenly spaced samples cross disciplines — architectural, structural,
 * mechanical — and nothing but the template survives that.
 *
 * The current page is always included, since it is already parsed.
 */
export function pagesToSample(pageCount: number, currentPage: number, want = 6): number[] {
  if (pageCount <= 0) return [];
  const take = Math.min(want, pageCount);
  const pages = new Set<number>([Math.min(Math.max(currentPage, 1), pageCount)]);
  for (let i = 0; i < take; i += 1) {
    // Midpoints of `take` equal bands, so no sample is the very first or last
    // page unless the document is tiny — a cover sheet and a back page are the
    // two most likely to carry a different frame.
    const page = Math.round(((i + 0.5) * pageCount) / take);
    pages.add(Math.min(Math.max(page, 1), pageCount));
  }
  return [...pages].sort((a, b) => a - b);
}

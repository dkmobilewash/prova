/**
 * A WALL IS TWO PARALLEL LINES A WALL-THICKNESS APART, and on a CAD sheet those
 * lines are already in the file.
 *
 * ── WHAT THE MEASUREMENT ESTABLISHED, BEFORE ANY OF THIS WAS WRITTEN ──
 *
 * `page.getOperatorList()` works in Node on the `pdfjs-dist` this app already
 * ships, with no canvas — unlike `page.render()`, which `plan-ingest/planPdf.ts`
 * measured as failing for want of one. Probed 2026-10-06 against a sheet with
 * four stroked lines on it:
 *
 *   operators returned: 9
 *   by kind: { setLineWidth: 1, constructPath: 4, stroke: 4 }
 *   constructPath args: [[13, 14], [100, 500, 400, 500], …]   // 13=moveTo 14=lineTo
 *
 * The coordinates come back EXACTLY as drawn. So wall takeoff does not need
 * vision and does not need rasterisation — #641 measured that at 46MB a sheet —
 * and the lengths are not estimated, they are the drawing's own numbers.
 *
 * ── WHY THAT MATTERS MORE THAN THE CONVENIENCE ──
 *
 * `symbolCount.eval.ts` refused symbol counting for a reason above its numbers:
 * a wrong count reads as certain and a person cannot check it. The band that was
 * wrong was the band that was right.
 *
 * Nothing here states a number. This returns the CENTRELINE of each wall it
 * found, as a polyline, and the footage comes from `polylineLength` in
 * `lib/sheet-geometry.ts` through the sheet's own calibration — the same path a
 * hand-traced measurement takes. So a wrong answer is a line in the wrong place
 * on a drawing somebody is looking at, which is a mistake a person catches in a
 * glance. "Confidently wrong number" is not a failure this shape can have.
 *
 * ── IT WORKS IN FEET, NOT POINTS ──
 *
 * A 4-7/8" partition is 3.6pt at 1/8" scale and 7.3pt at 1/4". A thickness
 * tolerance in points would therefore mean something different on every sheet,
 * and would be silently wrong on a detail. The caller converts using the
 * calibration the app already has, and every bound here is in FEET of building.
 */

/** One stroked segment, in page points as the PDF drew it. */
export type StrokeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The pen that drew it, in page points, with the matrix in force applied.
   *  Optional because a synthetic segment need not have one — and because the
   *  question of whether it DISCRIMINATES a wall from a slab joint is being
   *  measured rather than assumed. */
  width?: number;
  /**
   * True when this piece came from flattening a Bézier — see `flattenCubic`.
   *
   * ── WHY A CURVE'S PIECES ARE MARKED, AND WHO READS IT ──
   *
   * The two engines flatten nothing themselves; they are handed the same
   * segments. But they make different-sized runs out of a curve, and measured
   * on School-01's lobby arc that is a DOUBLE COUNT rather than a disagreement:
   *
   *   pairer — 9 pieces of 2.5 ft, 7 degrees apart, 22.8 ft at 4-7/8"
   *   rooms  — 4 pieces of 5.6 ft, 15 degrees apart, 22.4 ft at 3-3/4"
   *
   * One wall of about 23 ft, found twice, billed at 45 ft. Neither `mergeWalls`
   * nor `oneWallPerPlace` can collapse them, and that is not a bug in either:
   * both ask "are these parallel within ~3 degrees", and consecutive pieces of
   * an arc are not. Every dedup in this module assumes a wall is straight.
   *
   * So the pairer owns curves and the room engine skips them. That is not
   * merely a coin toss resolved by convenience: the pairer measures a wall
   * face-to-face, which is what gives the arc its correct 4-7/8", while the
   * room engine reasons about enclosed REGIONS, whose geometry a chord
   * approximation distorts — and it returned a thickness the schedule does not
   * have.
   *
   * THE COST, STATED: a curved wall that ONLY the room engine could find —
   * drawn as fill with no two faces — stays missed, exactly as a straight
   * poché wall does today.
   */
  curved?: boolean;
  /**
   * The CAD layer this stroke was drawn on, when the export carries one.
   *
   * ── THE DRAWING HAS BEEN SAYING WHICH LINES ARE WALLS THE WHOLE TIME ──
   *
   * Every filter in this module is GEOMETRY, and geometry cannot tell a wall
   * from the two parallel strokes of a letter in the architect's logo, or from
   * the sides of a car on a parking plan. Both were reported from a real
   * dealership bid set, and both are the pairer answering its own question
   * correctly: those really are parallel lines a wall thickness apart.
   *
   * An AutoCAD or Revit export made WITH LAYER INFORMATION wraps each stroke in
   * an optional-content group named after the layer the drafter put it on —
   * `A-WALL`, `S-GRID`, `A-FURN`, `G-ANNO-TTLB`. That is a different KIND of
   * signal from everything else here: not a measurement of the line, but what
   * the person who drew it called it. `layerNames.ts` judges the name;
   * `sheetStrokes.ts` reads it.
   *
   * OPTIONAL, AND THAT IS THE WHOLE SAFETY OF IT. A flattened plot carries no
   * layers at all, so `undefined` has to mean "say nothing" rather than
   * "suspicious" — see `layerVerdict`, which returns `unknown` for anything it
   * cannot place and `withoutNonWallLayers`, which keeps every `unknown`.
   */
  layer?: string;
};

/** A wall this module is willing to claim: the centreline, in page points. */
export type WallCandidate = {
  /** Centreline start and end — what an estimator would have traced. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The two faces it came from, so a reviewer can see WHY this is a wall. */
  thicknessFeet: number;
  /** Along the centreline, in feet. Derived here only for the eval's grading;
   *  the app computes its own from the geometry and the live calibration. */
  lengthFeet: number;
  /**
   * True when this run was assembled from a flattened arc by `curvedWalls`.
   *
   * It matters to anything that recomputes a length from the endpoints,
   * because on a curved run `lengthFeet` is the CENTRELINE ARC and the two
   * endpoints are only its chord — 14.17 ft against 12.0 on S07's bay. A
   * consumer that re-derives from x1,y1,x2,y2 will under-measure by 15% and
   * nothing will throw.
   */
  curved?: boolean;
  /**
   * Gaps INSIDE this run that are narrow enough to be openings, with their
   * measured widths. Present only when `mergeWalls` joined across one.
   *
   * WIDTH AND NOT HEIGHT, because a floor plan does not carry a height and
   * inventing one would be a guess that reaches a bid. `lengthFeet` is GROSS
   * and includes these — which is the correct take-off for a door, since
   * `takeoff.ts` deducts nothing under 32 sq ft and the framing runs through
   * the opening as a header anyway.
   */
  openings?: { widthFt: number }[];
  /**
   * Whether the two faces this came from were a BALANCED pair — see
   * `BALANCED_FACE_RATIO`, which is the test that tells a wall's second face
   * from a column grid line running past the building.
   *
   * Recorded only so `oneWallPerPlace` can prefer a balanced finding to a
   * fallback one when both describe the same wall. The pairer already knows
   * which it took and used to throw the answer away; absent means "not built by
   * the pairer" and is treated as balanced, since a hand-built candidate has no
   * faces to be unbalanced about.
   */
  fromBalancedFaces?: boolean;
};

export type WallFinderOptions = {
  /** Feet of building per page point, from the sheet's calibration. */
  feetPerPoint: number;
  /**
   * The thinnest and thickest thing worth calling a wall, in feet.
   *
   * 0.2 ft (2-1/2") is a furring wall; 1.5 ft (18") covers a shaft wall or a
   * double-stud assembly with board both sides. Outside that, two parallel lines
   * are a pair of unrelated walls across a corridor, or a dimension string and
   * its witness line — not one wall.
   */
  minThicknessFeet?: number;
  /**
   * The thicknesses, in inches, of the wall types this company actually
   * builds — the partition schedule. Optional: without it the finder behaves
   * exactly as it did before. See `KNOWN_SLACK_IN`.
   */
  knownThicknessesIn?: readonly number[];
  maxThicknessFeet?: number;
  /** The shortest wall worth reporting, in feet. Below this a pair is as likely
   *  to be a jamb detail, a hatch stroke or a leader as a wall. */
  minLengthFeet?: number;
};

/**
 * ── THE WORK BUDGET, AND THE PAGE THAT HUNG WITHOUT ONE ──
 *
 * This pairer is O(n²) with `inAHatchSeries` scanning inside the inner loop.
 * Measured on page 7 of a real airport concourse set:
 *
 *   | page | raw segments | usable (>=2 ft) | pair tests |
 *   | --- | --- | --- | --- |
 *   | **Houston p7** | 152,189 | **30,825** | **475,000,000** |
 *   | Houston p11 | 387,891 | 16,288 | 133,000,000 |
 *   | a school set's floor plan | ~2,000 | hundreds | ~1,000,000 |
 *
 * p7 never returned. Timed stage by stage, every other stage on that page is
 * fast — `pageStrokes` is 600ms at worst across all 16 pages — and the pipeline
 * enters `wallsFromBothEngines` with 152,189 segments and stops. The page is
 * 240x the work of one that finishes.
 *
 * ── A BUDGET ON THE WORK, NOT A CEILING ON THE INPUT ──
 *
 * A segment-count limit would be a proxy for the thing that actually matters
 * and would be wrong in both directions: a page with many SHORT segments costs
 * nothing after the length filter, and one with fewer long ones can cost more.
 * Counting the pair tests bounds the real cost, so any sheet that fits finishes
 * exactly as it does today and only a sheet that cannot is refused.
 *
 * 40 million, which sits in a gap rather than on a line: the working pages
 * measure around one million and the two that hang are 133 and 475. At roughly
 * 20M tests a second that is about two seconds of work before giving up, which
 * is inside what somebody waits for after pressing a button.
 *
 * ── AND IT THROWS RATHER THAN RETURNING WHAT IT HAD ──
 *
 * Returning the walls found so far is the tempting option and it is the one
 * this repo has a name for: a result that LOOKS like an answer. An estimator
 * would get a plausible, silently incomplete set of runs off a sheet the app
 * could not actually read, and nothing on screen would say which. The caller
 * already has a `try`/`catch` that tells them to trace by hand, which is the
 * true answer for this sheet.
 */
const MAX_PAIR_TESTS = 40_000_000;

/** Thrown when a sheet is too dense to pair within the budget. Its own class so
 *  a caller can tell "this sheet is too dense" from "pdfjs threw", which want
 *  different sentences on screen. */
export class SheetTooDenseError extends Error {
  constructor(readonly usableSegments: number) {
    super(
      `This sheet has ${usableSegments.toLocaleString()} lines long enough to be walls, which is more than ` +
        `the wall finder can pair. Trace the walls by hand on this one.`,
    );
    this.name = "SheetTooDenseError";
  }
}

/**
 * Is the thin pair `i`-`j` ENCLOSED by a thicker wall of a scheduled type?
 *
 * This is the whole difference between furring and a wall's own layer line, and
 * on this schedule it is the only difference there is:
 *
 *   F1 furring   1-1/2in thick
 *   EXT-2        8-1/8in, drawn as four lines with its inner two 1.500in apart
 *   EXT-1        8-7/8in, drawn as five lines with an internal gap of 1.625in
 *
 * So a 1-1/2in pair is thickness-identical to the inside of both exterior
 * types, and no thickness rule can tell them apart. Measured, on one holdout
 * sheet: 438 ft of runs in a 1.68in cluster where the only real furring on the
 * drawing is 40 ft — and that 40 ft was recorded MISSED.
 *
 * Position separates them. Furring is applied TO a wall, so it sits outside it;
 * a layer line sits between its wall's own faces. Concretely, for the pair
 * `i`-`j` this asks whether some third line `k` makes a scheduled wall with `i`
 * while `j` lies between the two of them:
 *
 *   EXT-2   i=-4.0625  j=-2.5625  k=+4.0625   8.125in is EXT-2, j is inside  -> enclosed
 *   furring i=8.000    j=9.500    k=0.000     9.500in is on no schedule      -> not
 *
 * It cannot reproduce on a clean synthetic wall, which is why it was not caught
 * by one: a single unbroken outer face is consumed by the wall's own pair and
 * nothing is left to form the thin one. A real sheet breaks that face at every
 * window and corner, and the leftover pieces pair with the layer line.
 */
function enclosedByAScheduledWall(
  order: readonly StrokeSegment[],
  i: number,
  j: number,
  options: WallFinderOptions,
  knownIn: readonly number[],
): boolean {
  const towardsJ = sideOf(order[i], order[j]);
  const offJ = perpendicularDistance(
    order[i],
    (order[j].x1 + order[j].x2) / 2,
    (order[j].y1 + order[j].y2) / 2,
  );
  for (let k = 0; k < order.length; k += 1) {
    if (k === i || k === j) continue;
    // `k` has to be on the same side of `i` as `j`, and further out.
    if (sideOf(order[i], order[k]) !== towardsJ) continue;
    const offK = perpendicularDistance(
      order[i],
      (order[k].x1 + order[k].x2) / 2,
      (order[k].y1 + order[k].y2) / 2,
    );
    if (offK <= offJ) continue;
    // And `i`-`k` has to be a wall of a type this company builds. Reusing
    // `wallFromPair` keeps the parallel, overlap and length rules in one place.
    const wide = wallFromPair(order[i], order[k], options);
    if (wide === null) continue;
    if (!isAKnownType(wide.thicknessFeet, knownIn)) continue;
    // AND THE ENCLOSING WALL MUST NOT ITSELF BE TWO ASSEMBLIES. Without this,
    // 1-1/2in furring on 7-5/8in block poisons both halves: the 9.125in span
    // is within a quarter inch of EXT-1's 8.875in, so the block and the furring
    // are each read as a layer line of a wall that is not there, and both are
    // refused before the schedule tier can prefer either. Same width gate as
    // the other call site — the scan is O(n) inside an O(n^2) loop.
    if (
      wide.thicknessFeet * 12 > 6 &&
      splitsIntoScheduledAssemblies(order, i, k, wide.thicknessFeet, options, knownIn)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Which side of `of` the midpoint of `other` falls on: +1, -1 or 0 on the line.
 */
/**
 * Does this pair SPLIT into two assemblies the schedule names?
 *
 * ── THE SLACK COLLISION THIS EXISTS FOR, REPRODUCED IN A UNIT TEST ──
 *
 * 1-1/2in furring on 7-5/8in block is three lines at 0, 7.625 and 9.125in. The
 * span across both is 9.125, and the schedule's EXT-1 is 8.875 — a quarter inch
 * away, which is exactly `KNOWN_SLACK_IN`. So the span LOOKS like a type this
 * company builds, "the widest pair the schedule names" takes it, and the finder
 * returns ONE WALL AT 9.13IN where the drawing has a block wall and the furring
 * in front of it.
 *
 * The schedule preference above was written for precisely this geometry and
 * fixes it when the span matches NOTHING — with a schedule of 8 and 1-1/2 the
 * 9-1/2in span is on nothing and the block comes back correctly. It cannot help
 * when the span lands within slack of a real type, and on the bench's own
 * schedule it does: Mesa Ridge finds 298 ft of a 1,582 ft furring key, and the
 * grader's per-wall diagnosis says both faces were read and measured 1.5in
 * apart. They were read, they were right, and this took them.
 *
 * ── THE RULE, AND WHY IT IS BETTER EVIDENCE THAN THE SLACK ──
 *
 * A gap with a face inside it that divides it into two gaps the schedule ALSO
 * names is two assemblies touching, not one wall. "9.125 is 7.625 plus 1.5, and
 * all three are on the schedule" is a coincidence of three numbers; "9.125 is
 * within a quarter inch of 8.875" is a coincidence of two. The decomposition
 * wins, and it is why this asks for both halves rather than just a face in
 * between — an ordinary layered wall has faces inside it whose gaps are NOT
 * types, and must keep reading as one wall.
 *
 * Deliberately only consulted for a pair already wide enough to be two
 * assemblies, so the O(n) scan inside the pairing loop runs rarely rather than
 * on every candidate — this file's own note about `inAHatchSeries` and O(n^3)
 * applies.
 */
function splitsIntoScheduledAssemblies(
  order: readonly StrokeSegment[],
  i: number,
  j: number,
  thicknessFeet: number,
  options: WallFinderOptions,
  knownIn: readonly number[],
): boolean {
  if (knownIn.length === 0) return false;
  // ── A TIGHT MATCH IS BELIEVED, AND THIS IS THE WHOLE DISCRIMINATOR ──
  //
  // Both shapes decompose, so the decomposition alone cannot tell them apart:
  //
  //   block + furring   9.125 = 7.625 + 1.5     span is 0.25in off EXT-1
  //   EXT-2 layered     8.125 = 1.5   + 6.625   span is EXACTLY 8.125
  //
  // The first version of this rule refused both and broke the window-broken
  // exterior, which is a wall priced as the wrong assembly — the failure this
  // file calls worse than not finding it. The test that caught it says in as
  // many words that 6.625in is on its schedule deliberately, so the schedule
  // "cannot rescue this case".
  //
  // What separates them is how well the SPAN matches. A thickness sitting
  // exactly on the schedule is the drawing agreeing with the legend; one a
  // quarter inch off is the slack doing the work, and slack plus a
  // decomposition into two named types is weaker evidence than either alone
  // looks. So the decomposition only overrides a LOOSE match.
  const inches = thicknessFeet * 12;
  const closest = Math.min(...knownIn.map((known) => Math.abs(known - inches)));
  if (closest <= EXACT_SCHEDULE_IN) return false;
  const a = order[i];
  const b = order[j];
  const span = perpendicularDistance(a, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
  if (span <= 0) return false;
  for (let k = 0; k < order.length; k += 1) {
    if (k === i || k === j) continue;
    const c = order[k];
    const midX = (c.x1 + c.x2) / 2;
    const midY = (c.y1 + c.y2) / 2;
    const fromA = perpendicularDistance(a, midX, midY);
    // STRICTLY BETWEEN, measured off the same face the span is. A face level
    // with either end is one of the two faces again, not a divider.
    if (!(fromA > 0 && fromA < span)) continue;
    if (sideOf(a, c) !== sideOf(a, b)) continue;
    const first = wallFromPair(a, c, options);
    if (first === null || !isAKnownType(first.thicknessFeet, knownIn)) continue;
    const second = wallFromPair(c, b, options);
    if (second === null || !isAKnownType(second.thicknessFeet, knownIn)) continue;
    return true;
  }
  return false;
}

function sideOf(of: StrokeSegment, other: StrokeSegment): number {
  const dx = of.x2 - of.x1;
  const dy = of.y2 - of.y1;
  const midX = (other.x1 + other.x2) / 2;
  const midY = (other.y1 + other.y2) / 2;
  // The z of the cross product: one sign each side of the line.
  return Math.sign(dx * (midY - of.y1) - dy * (midX - of.x1));
}

/**
 * The widest gap, in feet, that a FACE may be interrupted by and still be read
 * as one face — 8 ft, the same bound `mergeWalls` uses for an opening.
 *
 * A window, a door or a storefront breaks the line a wall's face is drawn with.
 * Beyond this a gap is another wall on the same line rather than a hole in this
 * one.
 */
export const SAME_FACE_GAP_FEET = 2;

/** Angles within this many radians are the same direction (about 3 degrees). */
const SAME_FACE_ANGLE = 0.05;

/**
 * Perpendicular offsets within this many feet are the same line — 0.048in.
 *
 * Tight on purpose, and the bound is a real pair of wall types rather than a
 * round number. A1 and C1 differ by 1/8in of thickness, so with their
 * centrelines aligned their faces sit 1/16in apart; anything looser merges
 * those into one line and reports a wall that is neither. Plotting jitter on
 * these sheets is about 0.005in — a 4-7/8in wall measures 4.87 — so this
 * absorbs the jitter with an order of magnitude to spare and nothing else.
 *
 * Swept on the bench: 0.48in and 0.048in are within 20 ft of each other on
 * every number, so the tighter bound is free.
 */
const SAME_FACE_OFFSET_FEET = 0.004;

/**
 * Join the pieces of one face back into one face.
 *
 * ── WHY THIS EXISTS, AND IT IS NOT ABOUT RECALL ──
 *
 * An exterior wall's far face is broken by every window in it; its near face
 * and its interior layer lines run continuously. The pairing loop walks faces
 * LONGEST FIRST, so the continuous interior lines are reached first, pair with
 * each other, and consume themselves — and the broken face's pieces arrive to
 * find the partner they needed already spoken for. The wall is then reported at
 * whatever the leftovers make.
 *
 * Measured on the bench, graded against the key's own thicknesses: 26% of the
 * holdout's reported footage came back at a thickness on NO schedule, and the
 * single biggest offender was about 6-1/2in with 11,080 ft on Mesa Ridge and
 * 3,541 ft on the holdout. Both exterior types have an internal gap of
 * 6.625in — EXT-1's stud face to inner face, EXT-2's outer face to its inner
 * layer — so that is the stud cavity being sold as the wall. `wallVectors.ts`
 * has described this exact failure since it was written ("the envelope was
 * being found and then reported at 6.6in") and attributed it to taking the
 * first partner rather than the widest; the widest-partner rule fixed the case
 * where all four faces are whole and could not fix this one, because here the
 * true partner is not a candidate at all.
 *
 * A second shape from the same cause, read off one holdout sheet at a wall the
 * key calls 8-1/8in: its face paired with a 230 FT gridline 10.56in away,
 * because its own far face was in window-sized pieces. And a misread wall
 * cannot shield its own layer lines — `enclosedByAScheduledWall` only
 * recognises an enclosing wall at a SCHEDULED thickness — so the 1.50in pair
 * inside it came back as furring.
 *
 * Joining the pieces first is not a heuristic about walls, it is a statement
 * about faces: a line interrupted by a hole is one line. It is bounded by
 * `SAME_FACE_GAP_FEET` so that two walls on one grid line stay two faces.
 */
export function oneFacePerLine(
  segments: readonly StrokeSegment[],
  feetPerPoint: number,
): StrokeSegment[] {
  const offsetTolerance = SAME_FACE_OFFSET_FEET / feetPerPoint;
  const gapLimit = SAME_FACE_GAP_FEET / feetPerPoint;
  type Line = { ux: number; uy: number; offset: number; pieces: StrokeSegment[] };
  const lines: Line[] = [];

  for (const segment of segments) {
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    // One direction per line, not two: a face drawn right-to-left is the same
    // face as one drawn left-to-right, and the bench has sheets that do both on
    // the same wall.
    let ux = dx / length;
    let uy = dy / length;
    if (ux < 0 || (ux === 0 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    // Perpendicular distance from the origin to this segment's line.
    const offset = segment.x1 * uy - segment.y1 * ux;
    const found = lines.find(
      (line) =>
        Math.abs(line.ux * uy - line.uy * ux) < SAME_FACE_ANGLE &&
        Math.abs(line.offset - offset) < offsetTolerance,
    );
    if (found) found.pieces.push(segment);
    else lines.push({ ux, uy, offset, pieces: [segment] });
  }

  const joined: StrokeSegment[] = [];
  for (const line of lines) {
    // Along-the-line coordinate of every endpoint, so pieces can be ordered and
    // their gaps measured without any trigonometry per comparison.
    const along = (x: number, y: number) => x * line.ux + y * line.uy;
    const spans = line.pieces
      .map((piece) => {
        const one = along(piece.x1, piece.y1);
        const two = along(piece.x2, piece.y2);
        return { from: Math.min(one, two), to: Math.max(one, two), width: piece.width };
      })
      .sort((a, b) => a.from - b.from);

    let open = spans[0];
    const flush = () => {
      // Back to points: a point on the line plus the direction, times the
      // along-coordinate. The line's own offset fixes the perpendicular.
      const px = open.from * line.ux + line.offset * line.uy;
      const py = open.from * line.uy - line.offset * line.ux;
      const qx = open.to * line.ux + line.offset * line.uy;
      const qy = open.to * line.uy - line.offset * line.ux;
      joined.push({ x1: px, y1: py, x2: qx, y2: qy, width: open.width });
    };
    for (const span of spans.slice(1)) {
      if (span.from - open.to <= gapLimit) {
        open = {
          from: open.from,
          to: Math.max(open.to, span.to),
          // The heavier pen wins: a face plotted thick in one stretch is a
          // face. `width` is optional, and a missing pen is not a zero pen —
          // coalescing it to 0 would let an absent width beat a hairline.
          width:
            open.width === undefined
              ? span.width
              : span.width === undefined
                ? open.width
                : Math.max(open.width, span.width),
        };
        continue;
      }
      flush();
      open = span;
    }
    flush();
  }
  return joined;
}

/**
 * How far off a schedule thickness a pair may measure and still be read as that
 * type — 1/4in, which is half of `CLUSTER_INCHES` and the same slack the
 * clusterer allows. A literal because `CLUSTER_INCHES` is declared below.
 *
 * A drawn face lands on the nearest plottable coordinate, so a 4-7/8in wall
 * measures 4.87 or 4.91 rather than 4.875, and three sheets of the same plan
 * disagree in the second decimal.
 */
export const KNOWN_SLACK_IN = 0.25;

/**
 * How close a measured thickness has to be to a scheduled one before the match
 * is taken as the drawing AGREEING with the legend rather than the slack doing
 * the work. 1/16in — tighter than a plotter's own line weight, so a real wall
 * drawn at its stated thickness clears it and a coincidence at the edge of
 * `KNOWN_SLACK_IN` does not. Used only by `splitsIntoScheduledAssemblies`.
 */
export const EXACT_SCHEDULE_IN = 0.0625;

/** Is this thickness one of the types the company builds? */
function isAKnownType(thicknessFeet: number, knownIn: readonly number[]): boolean {
  const inches = thicknessFeet * 12;
  return knownIn.some((known) => Math.abs(known - inches) <= KNOWN_SLACK_IN);
}

export const DEFAULTS = {
  minThicknessFeet: 0.2,
  /**
   * ── 12 INCHES, AND THE NUMBER WAS SWEPT RATHER THAN REASONED ──
   *
   * This was 18in, which admitted a pair reading 12.44in. Against a 60-page
   * answer key that pair was 188 ft of one page's EAST AND WEST EXTERIOR WALLS,
   * measured half again too thick — so the envelope was being found and priced
   * as an assembly that is not on the drawing. The key names every assembly it
   * has and **the widest is EXT-1 at 8-7/8in**, so nothing above about 9in is a
   * wall here whatever its geometry.
   *
   * That argues for a cap at 9.2in, and the sweep argues otherwise:
   *
   * | cap | recall | phantom | EXT band | 12.4in band |
   * | --- | --- | --- | --- | --- |
   * | 18 | 95.3% | 17,401 | 22.8% | 1,849 |
   * | **12** | **94.5%** | **15,374** | **23.2%** | **0** |
   * | 11 | 93.9% | 15,197 | 23.5% | 0 |
   * | 10 | 91.7% | 15,160 | 25.4% | 0 |
   * | 9.2 | 91.6% | 14,766 | 25.4% | 0 |
   *
   * **The 12.4in band is gone by 12in**, so the defect does not need a tighter
   * cap than this. Below 12 the cost rises faster than the gain: 9.2 buys
   * another 608 ft of phantom reduction and gives up 3.7 points of recall,
   * about 1,560 ft of real wall. A tight cap does not FIX an over-measured wall,
   * it REJECTS it, and the footage leaves with it.
   *
   * ── WHAT THIS GIVES UP, AND IT IS NOT NOTHING ──
   *
   * `wallVectors.test.ts` asserts an 18in shaft wall is "the thickest thing
   * still a wall", and that was a deliberate claim rather than an accident: a
   * CMU or double-stud shaft IS that thick. The first version of this comment
   * said no assembly in this trade is a foot thick. **That is false, and the
   * test sitting beside this file said so** — which is this repo's own rule
   * about reading the test before believing an inference about the code.
   *
   * So an 18in wall is now OPT-IN: pass `maxThicknessFeet: 1.5` for a sheet
   * that has one. The default serves the common case, and the sweep is the
   * reason the common case wins — a cap of 18 leaves 1,849 ft priced as an
   * assembly that is on no drawing, every time, against a shaft wall that is
   * occasional and now one argument away.
   *
   * The honest state of the number: 12 is measured on ONE answer key. What
   * would settle it properly is a second key with a shaft wall in it, which is
   * also what would say whether the 0.8 points of recall this costs were real
   * wall or more over-measured envelope. Nobody knows yet.
   *
   * ── 13, FROM 2026-10-15, AND THE SWEEP ABOVE NO LONGER ARGUES FOR 12 ──
   *
   * Everything above was true when it was written and the table is still the
   * table that was measured. What changed is underneath it: the 12.4in band
   * the cap was swept to kill WAS THE COLUMN GRID, which `gridBubbles.ts`
   * says in its own header — "one more line at +12.48in which is 115 ft long
   * and runs past the building at both ends". That module was written as the
   * direct fix for it and was never called by anything. It is wired into
   * `findWallsOnSheet` now, so the grid is gone BEFORE the pairer sees it and
   * the cap is no longer the thing holding that 1,849 ft back.
   *
   * Re-swept with the grid filter in place, on the same bench:
   *
   * | cap | LF outside 2% | cases missing a wall | walls | holdout |
   * | --- | --- | --- | --- | --- |
   * | 12 | 26/60 | 27 | 113 | -1.9% |
   * | **13** | **26/60** | **27** | **113** | **-1.9%** |
   * | 14.4 | 26/60 | 27 | 113 | -1.8% |
   * | 16 | 26/60 | **33** | **119** | -1.6% |
   * | 18 | 26/60 | **33** | **119** | -1.6% |
   *
   * 13 is bench-IDENTICAL to 12 — not better, identical — and it buys 26 ft of
   * real exterior wall on a one-storey house whose envelope reads 12.1in. The
   * knee is at 16, where a pair grows wide enough to swallow the wall beside
   * it and BOTH are then scored missing, which is why 18 reads worse here than
   * the old table's 18 did: that failure mode is about neighbours, not phantom.
   *
   * ── AND IT IS STILL 12, BECAUSE A UNIT GUARD SAYS THE PAIRER NEEDS IT ──
   *
   * The table above is why 13 looked free, and it was measured, not argued.
   * It is also not sufficient, and the thing that said so was a test in this
   * file's own suite: "KEEPS THE WALL AND NOT THE COLUMN GRID LINE'S PAIRING".
   * At 13 the 12.48in grid pairing is admitted and BEATS the real 8.88in wall
   * — 7.32 where 8.88 was expected.
   *
   * The distinction the bench could not draw: that test calls the PAIRER
   * directly, and `gridBubbles` runs in `findWallsOnSheet`, one level up. So
   * the filter protects the PIPELINE and the cap protects the PAIRER, and
   * every caller of the pairer that is not the pipeline still needs the cap.
   * The bench only ever exercises the pipeline, which is why five bench runs
   * said "free" about a change that is not.
   *
   * So the cost is recorded rather than paid: S06, a one-storey house whose
   * envelope reads 12.1in, loses 26 ft of real exterior wall to this cap. That
   * is a genuine false negative and it is the price of the guard, not a bug in
   * it. Raising the default is Diego's call, not a tuning decision, and the
   * thing that would make it safe is giving the PAIRER its own grid defence —
   * at which point re-run the table above rather than trusting it.
   *
   * What has NOT changed: 18in is still opt-in, for the reason above. And this
   * is still one answer key plus one synthetic set.
   */
  maxThicknessFeet: 1.0833,
  minLengthFeet: 2,
};

/**
 * HOW PARALLEL IS PARALLEL, in radians.
 *
 * CAD draws a wall's two faces at exactly the same angle, so this could be near
 * zero for a clean export. It is 2° because a sheet that has been through a
 * raster-and-revector round trip, or a hand-drafted-then-scanned-then-traced
 * plan, carries a little noise — and a 2° tolerance over a 20ft wall admits a
 * 0.7ft drift at the far end, which the overlap test below still rejects.
 */
const PARALLEL_TOLERANCE_RAD = (2 * Math.PI) / 180;

/**
 * How unequal two faces may be and still be PREFERRED as a wall, when several
 * partners are valid.
 *
 * Rule 6 ("they end together") is the hard gate — a pair loose at both ends
 * is not a wall
 * at all. This is a softer question that only arises once more than one partner
 * passes it: which of them is the wall?
 *
 * MEASURED ON THE EXTERIOR ENVELOPE, where the choice is real. On one sheet the
 * faces within two feet of the west wall sit at +0.00, +1.56, +2.28, +8.28,
 * +8.88 and +12.48 inches, and the last of those is a COLUMN GRID LINE — 115 ft
 * long, running past the building at both ends. It is inside the thickness band
 * and it is the widest, so "take the widest" takes it: 188 ft of one sheet came
 * back at 12.4in, which is no assembly on the drawing.
 *
 * A wall's two faces are the two sides of one wall and are close to the same
 * length — 41 ft against 28.3 ft here, a ratio of 1.45. The grid line is 2.87
 * times its partner on the page where the hard gate misses it, and 4.06 on the
 * page where the gate catches it. Two sits between with margin on both sides.
 *
 * It is a PREFERENCE and not a gate: if no balanced partner exists, the widest
 * valid one is still taken, so nothing that used to be found stops being found.
 */
const BALANCED_FACE_RATIO = 2;

/**
 * How far a face may run past its partner AT BOTH ENDS and still be that wall's
 * other face, as a fraction of the shorter face.
 *
 * A gate rather than a preference, which `BALANCED_FACE_RATIO` deliberately is
 * not — and the difference is the whole reason this exists. That one asks which
 * of several valid partners is the wall, and falls back to the widest when none
 * is balanced. A column grid line has no balanced partner either, so the
 * fallback hands it one: at a 13in cap it claims the outer finish at 12.48in
 * and the real faces are left to pair at 7.32in. A preference cannot refuse,
 * and this has to refuse.
 *
 * 0.1 is not finely judged and must not be tuned as though it were. The two
 * populations are two orders of magnitude apart — a corner overhangs by a wall
 * thickness (under 2% of the face), a grid line by tens of feet (56% and 132%
 * on the case this was measured from).
 */
const BOTH_ENDS_OVERHANG = 0.1;

/**
 * HATCHING IS A SERIES; A WALL IS A PAIR. This is the whole discriminator, and
 * it was arrived at by measurement rather than by taste.
 *
 * On the first run the hatched sheet produced **230 phantom walls** and claimed
 * 11,584ft where 100ft was drawn. `syntheticSheet.ts`'s poché is parallel
 * diagonals every 6 points, which is 4.24pt perpendicular — 0.47ft at 1/8"
 * scale, almost exactly a 4-7/8" partition. So EVERY adjacent pair of hatch
 * strokes is a textbook wall by thickness, parallelism, overlap and length, and
 * CLAUDE.md predicted precisely this: *"at 44 DPI a hatch line and a door leaf
 * are both one thin stroke"*, one level up.
 *
 * No tolerance can fix it, because the geometry of a hatch pair and the geometry
 * of a wall pair are the same geometry. What differs is the COMPANY they keep: a
 * wall has two faces and nothing else alongside, while poché is a repeating
 * series, so a third stroke continues the spacing. That is also how a person
 * reads it — nobody measures the gap, they see the stripes.
 *
 * So a pair is rejected when a third parallel stroke sits within this multiple
 * of its own spacing beyond either face. 2.5 admits the irregular last stroke of
 * a band without admitting a wall's neighbour across a 5ft corridor.
 */
const SERIES_REACH = 2.5;

/**
 * How far off a whole number of steps a third stroke may sit and still count as
 * continuing the series, as a fraction of one step.
 *
 * Hatching is machine-generated at a constant pitch — this repo's own generator
 * emits it with `offset += 6` — so a real series member lands on a whole
 * multiple to within a rounding error, and 0.2 is loose by a wide margin. It is
 * the two strokes it must NOT admit that set the ceiling: on a measured
 * exterior wall the inboard gypsum line sits at 1.07 steps and the column grid
 * line at 1.51. The nearer of those is 0.07 from a whole number, which is why
 * this cannot simply be made generous — and why `nearest === 1` is excluded
 * rather than tolerated, since 1 is `b` itself.
 */
const SERIES_PITCH_TOLERANCE = 0.2;

/**
 * How long a third stroke must be to count as continuing a series, as a
 * fraction of the pair's own shorter face.
 *
 * ── HATCHING IS A PATTERN OF STROKES THAT LOOK ALIKE ──
 *
 * The pitch test above asks WHERE a third stroke sits. It cannot ask whether
 * the stroke is the same KIND of thing, and on a real plan that is the half
 * that matters: a machine filling a region emits strokes of comparable length,
 * while a counter, an appliance or a fixture drawn in the next room is a short
 * line that happens to be parallel.
 *
 * ── MEASURED ON S09, WHERE IT COST 22 FEET OF PARTITION ──
 *
 * The hall's south wall is a 4.5in partition — faces at 15.81 and 16.19 ft, so
 * a step of 0.38. A FIXTURE in the room above sits at 15.11, which is 0.70 ft
 * away:
 *
 *     0.70 / 0.38 = 1.84 steps,  and  |1.84 - 2| = 0.16  <=  0.2
 *
 * So two wall faces and one unrelated 2.5 ft line read as a three-member
 * series at pitch 0.38, and the wall was discarded. Proved by isolation: the
 * two faces alone pair correctly at 21.7 ft, and adding that ONE line takes
 * the pairer to zero.
 *
 * The pitch tolerance cannot simply be tightened — its own note records that
 * it already has 0.07 of headroom against a gypsum line at 1.07 steps. Length
 * is a different question and leaves that margin alone.
 *
 * ── AND THE SAME RATIO BOUNDS IT FROM ABOVE ──
 *
 * A dimension string is the long version of the same mistake: it runs the
 * whole side of a building, parallel to the wall it measures, at a round
 * offset that lands on a whole number of steps often enough to matter. S17's
 * does, at 1.918 — and it took the sheet's entire 49 ft south wall with it.
 *
 * So the test is two-sided. A member may be neither much shorter nor much
 * longer than the pair it claims to continue, because a fill is strokes that
 * resemble each other.
 *
 * ── WHY A THIN WALL IS THE ONE THAT SUFFERS ──
 *
 * The step IS the wall's thickness, so a 4.5in partition has a small step and
 * a correspondingly tight band in which a stray line looks like a series
 * member. A 6.5in exterior wall is far more forgiving. That is exactly the
 * pattern in the twenty-sheet table: S01, all exterior, is exact, and the
 * interior-heavy sheets are the worst.
 *
 * The existing overlap test cannot catch this: it requires the member to
 * overlap the pair by half of the SHORTER of the two, so a 2.5 ft fixture
 * sitting entirely inside a 17.5 ft wall overlaps it 100% and passes.
 */
/**
 * How many strokes BEYOND the pair a fill must have before the pair is read as
 * part of it.
 *
 * ── A PATTERN REPEATS; TWO LINES AND ONE NEIGHBOUR DO NOT ──
 *
 * One stroke at a whole multiple of the pair's spacing used to be enough, and
 * that is the shape of every wall this rule has eaten:
 *
 *   S09  a 2.5 ft fixture at 1.84 steps took a 48 ft partition
 *   S17  a 50 ft dimension string at 1.918 steps took a 49 ft exterior wall
 *   S15  a 5.0 ft fixture at 2.05 steps took one fragment of an 18 ft wall
 *
 * In each case there is exactly ONE other stroke. Hatching is machine-
 * generated and does not come in ones: the fill that this rule was written
 * for puts a stroke every 6 points across a whole region, so a genuine series
 * has strokes on both sides of the pair and several of them.
 *
 * Two is the smallest number that is a pattern rather than a coincidence, and
 * it is what separates "a wall with something beside it" from "a wall-shaped
 * gap between two strokes of a fill".
 *
 * The length bounds below stay, and are not made redundant by this: they
 * refuse a member that is the wrong KIND of thing, where this refuses a
 * series that is the wrong SIZE. A fill of three strokes beside a wall would
 * pass this and still has to look like a fill.
 */
const SERIES_NEEDS_MEMBERS = 2;

/**
 * And how many HALF-step strokes stand in for them, when the pair spans two
 * pitches of a fill rather than one.
 *
 * THREE rather than two, and the number is measured. A real wall carries
 * neighbours near a half step — the exterior envelope this rule must never
 * refuse has a column grid line at 1.51 steps — so two is reachable by
 * ordinary drawing furniture, and requiring two cost 6 walls on the bench
 * (111 missed to 117) for no gain on the twenty.
 */
const SERIES_NEEDS_HALVES = 3;

const SERIES_MEMBER_RATIO = 0.75;

/**
 * And how much LONGER a member may be than the pair's longer face.
 *
 * Its own constant rather than `1 / SERIES_MEMBER_RATIO`, because the two
 * bounds are answering about different things and the measurements say so. The
 * lower bound keeps a short fixture from suppressing a wall; this one keeps a
 * DIMENSION STRING from doing it — S17's runs the whole 50 ft side of the
 * building against a 17.6 ft stretch of wall, 2.7 times its length.
 *
 * MEASURED at 1.333 and at 2. The looser value is strictly worse: it costs
 * S05 and S09 their passes and does NOT recover S08, whose over-count is
 * present at both and is therefore about something else. So this sits at
 * 1.333 — the reciprocal of the lower bound, which is where it started — and
 * S08 is recorded as an open regression rather than tuned around.
 *
 * ── ONE MUTATION OF THIS LINE SURVIVES, AND SAYING SO IS THE POINT ──
 *
 * Measuring against `Math.min` instead of `Math.max` changes no test in this
 * suite and no figure on either fixture set. Both faces of a wall are usually
 * the same length, so the two agree; where they do not — S17's 18.5 against
 * 17.6 — the member is a 50 ft dimension string and lands outside either
 * bound.
 *
 * Two attempts at a case that would decide it both ran into the OLDER
 * end-of-series defect recorded in the test below, where the outermost pair
 * of a short fill has a neighbour on one side only. So `max` is reasoned
 * rather than measured: a member must resemble the pair, and the pair is as
 * long as its longer face. If that reasoning is wrong, nothing here will say
 * so.
 */
const SERIES_MEMBER_LONGEST = 1.333;

/** Direction of a segment, normalised to [0, π) so a line and its reverse are
 *  the same direction — which they are, for a wall face. */
function angleOf(segment: StrokeSegment): number {
  const angle = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1);
  return ((angle % Math.PI) + Math.PI) % Math.PI;
}

function lengthOf(segment: StrokeSegment): number {
  return Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
}

/** Smallest difference between two directions in [0, π). */
function angleGap(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, Math.PI - raw);
}

/**
 * Perpendicular distance from a point to the infinite line through a segment.
 * Zero-length segments are filtered before this runs.
 */
function perpendicularDistance(segment: StrokeSegment, px: number, py: number): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const len = Math.hypot(dx, dy);
  return Math.abs(dy * (px - segment.x1) - dx * (py - segment.y1)) / len;
}

/** How much two parallel segments overlap when projected onto their shared
 *  direction. Two walls meeting end to end overlap by nothing. */
function overlapAlong(a: StrokeSegment, b: StrokeSegment): number {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const project = (px: number, py: number) => (px - a.x1) * ux + (py - a.y1) * uy;

  const aStart = 0;
  const aEnd = len;
  const bOne = project(b.x1, b.y1);
  const bTwo = project(b.x2, b.y2);
  const bStart = Math.min(bOne, bTwo);
  const bEnd = Math.max(bOne, bTwo);

  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * How far the longer of two parallel segments runs PAST the shorter, at each
 * end, in points. `[0, 0]` when they begin and end together.
 *
 * The companion to `overlapAlong`, which answers how much of them is side by
 * side and cannot tell a wall from a line passing it: a 115 ft grid line
 * CONTAINS a 40 ft wall face, so the overlap is 100% of the shorter and every
 * overlap rule is satisfied. What separates them is what is left over at the
 * ends.
 */
function overhangsAlong(a: StrokeSegment, b: StrokeSegment): [number, number] {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [0, 0];
  const ux = dx / len;
  const uy = dy / len;
  const project = (px: number, py: number) => (px - a.x1) * ux + (py - a.y1) * uy;
  const bOne = project(b.x1, b.y1);
  const bTwo = project(b.x2, b.y2);
  const lo = Math.min(bOne, bTwo);
  const hi = Math.max(bOne, bTwo);
  // The gap at each end, whichever segment is the longer one there. Two faces
  // of one wall end together, so both are near zero; a line running past the
  // wall leaves a large one at each end.
  return [Math.abs(lo), Math.abs(hi - len)];
}

/**
 * The walls two faces make, if they make one.
 *
 * Returns null rather than a maybe. A pair either satisfies all four tests or it
 * is not a wall — there is no confidence band here, deliberately: the thing a
 * person checks is the LINE on the drawing, and a line drawn with a shrug is
 * worse than no line.
 */
export function wallFromPair(
  a: StrokeSegment,
  b: StrokeSegment,
  options: WallFinderOptions,
): WallCandidate | null {
  const minThickness = options.minThicknessFeet ?? DEFAULTS.minThicknessFeet;
  const maxThickness = options.maxThicknessFeet ?? DEFAULTS.maxThicknessFeet;
  const minLength = options.minLengthFeet ?? DEFAULTS.minLengthFeet;

  const aLen = lengthOf(a);
  const bLen = lengthOf(b);
  if (aLen === 0 || bLen === 0) return null;

  // 1. PARALLEL. A wall's faces are.
  if (angleGap(angleOf(a), angleOf(b)) > PARALLEL_TOLERANCE_RAD) return null;

  // 2. A WALL-THICKNESS APART. Measured from b's midpoint to a's line, so a
  // slight angle between them is averaged rather than read at its worst end.
  const midX = (b.x1 + b.x2) / 2;
  const midY = (b.y1 + b.y2) / 2;
  const thicknessPoints = perpendicularDistance(a, midX, midY);
  const thicknessFeet = thicknessPoints * options.feetPerPoint;
  // ── AND THE FLOOR DEFERS TO THE SCHEDULE ──
  //
  // `minThicknessFeet` is 0.2 ft (2.4in) and it exists because, knowing nothing
  // about the building, a gap thinner than that is more likely a doubled stroke
  // or a dimension tick than a wall. 1-1/2in furring is thinner than that, so
  // the floor refused it — 890 ft of it on Mesa Ridge, 221 on the holdout.
  //
  // LOWERING THE FLOOR IS NOT THE ANSWER AND WAS MEASURED NOT TO BE. Swept on
  // both sets, Mesa improves and the holdout gets worse on BOTH counts: at
  // 0.11 ft the holdout finds 114 ft less and reports 89 ft more that is not on
  // a wall, because every thin coincidence on the sheet becomes eligible and
  // steals a face from the wall beside it.
  //
  // When the schedule names 1-1/2in as a type this company builds, the floor
  // has nothing left to add for that thickness: the doubt it encodes has been
  // answered by the drawing. So a pair matching a scheduled thickness is
  // admitted and every other thin pair is still refused. The slack is 1/4in, so
  // this opens the named thicknesses and nothing else.
  const scheduled =
    (options.knownThicknessesIn?.length ?? 0) > 0 &&
    isAKnownType(thicknessFeet, options.knownThicknessesIn ?? []);
  if ((thicknessFeet < minThickness && !scheduled) || thicknessFeet > maxThickness) return null;

  // 3. THEY OVERLAP. Two faces of one wall run alongside each other; two walls
  // across a corridor, or a wall and the next wall along, do not. This is the
  // test that rejects a dimension string's witness lines, which are parallel and
  // the right distance apart and sit END TO END with the wall rather than beside
  // it.
  const overlap = overlapAlong(a, b);
  const shorter = Math.min(aLen, bLen);
  if (overlap < shorter * 0.5) return null;

  // 4. LONG ENOUGH TO BE A WALL rather than a jamb, a hatch stroke or a leader.
  const lengthFeet = overlap * options.feetPerPoint;
  if (lengthFeet < minLength) return null;

  // 5. REMOVED 2026-10-16 — IT WAS THE ONLY SCALE-DEPENDENT GATE IN HERE.
  //
  // It read: the two faces are comparable in length, and past a ratio of 5 a
  // pair is not a wall. The scar was real. On the first run every clean sheet
  // reported one phantom and 120 ft of wall where 100 ft was drawn, the extra
  // 20 ft being the SHEET BORDER paired with the TITLE-BLOCK box — two
  // parallel lines 10pt apart, which at 1/8" is 1.1 ft and sits squarely in
  // the partition window. Nothing about thickness, parallelism or overlap
  // could separate those two. Their raw lengths could: 2592pt against 180pt.
  //
  // WHY A RATIO OF RAW LENGTHS CANNOT BE SCALE-FREE: what a face's length
  // INCLUDES is not scale-free. A dimension extension line is a fixed length
  // on PAPER, so it is twice as many FEET at 1/8" as at 1/4", and
  // `oneFacePerLine` merges it into the wall face it is collinear with.
  //
  // S02 and S03 are the same building at those two scales, and this is the
  // whole of their disagreement:
  //
  //     S02   outer face of W1   x -3.89 -> 2.00   5.89 ft   ratio 3.40  kept
  //     S03   outer face of W1   x -7.52 -> 2.00   9.52 ft   ratio 5.50  cut
  //
  // Same wall, same 1.73 ft inner face, same building. The southwest corner of
  // a 40 ft wall was refused at one scale and accepted at the other, for 2 ft.
  // All nine other runs on those two sheets already agreed to the foot.
  //
  // RULE 6 COVERS THE SCAR AND IS SCALE-FREE. The border overhangs the title
  // block by 1,206pt at EACH end against a 180pt face — loose at both ends by
  // six times over, where a corner is loose by a wall thickness. The border
  // also no longer reaches here at all: `wallsNotTheSheetBorder` removes it.
  // `wallVectors.test.ts` pins the border pair against rule 6 directly.
  //
  // THE SWEEP THAT TUNED IT IS WHY IT SURVIVED THIS LONG, and it is kept here
  // because it is still true and still the reason nobody looked. Against the
  // 60-page key, with not-on-a-wall footage reported separately:
  //
  //     | ratio | Mesa found | Mesa not-on-wall | holdout found | not-on-wall |
  //     | 3     | 51,558     | 4,096            | 23,491        | 531         |
  //     | 5     | 52,109     | 3,928            | 24,057        | 534         |
  //     | 8     | 52,094     | 3,949            | 24,086        | 534         |
  //     | 13    | 52,125     | 3,941            | 24,092        | 534         |
  //
  // "8 and 13 buy nothing" was the conclusion, and on THAT key it is correct —
  // every sheet in it is 1/8". A constant can only be tuned against the
  // variation its fixtures contain, and a one-scale key cannot price a
  // scale-dependent gate. Re-measured 2026-10-16: removing it leaves every
  // bench bar identical, the zero-wall bar included, and takes the twenty from
  // 10 of 17 to 12 with S02 and S03 going from 0.84% apart to 0.00%.

  // 6. THEY END TOGETHER. Two faces of one wall stop at the same places; a line
  // that merely PASSES the wall overhangs it at both ends.
  //
  // This is what rule 3 cannot see, and what the removed rule 5 could not catch
  // either. A 115 ft column grid line CONTAINS a 40 ft wall face, so the
  // overlap is 100% of the shorter — rule 3's best possible score — and their
  // raw length ratio is 2.87, which was inside rule 5's gate of 5. Every
  // existing test passed and the grid paired with the wall's outer finish at
  // 12.48in. This rule is now the only thing standing between the two, which
  // is also why rule 5 could be removed: it was never the one doing this job.
  //
  // A corner is the only legitimate reason a face outruns its partner, and it
  // outruns it by a WALL THICKNESS — inches. The grid overruns by 22 ft at one
  // end and 53 ft at the other, against a 40 ft wall. Measured as a fraction of
  // the shorter face so the rule is scale-free: 56% and 132% there, under 2% for
  // a corner on the same wall. `BOTH_ENDS_OVERHANG` sits between with two orders
  // of magnitude of margin, which is why it does not need to be a judged number.
  //
  // BOTH ends, deliberately. One end is a corner and is ordinary; a face that
  // is loose at both ends is not bounded by this wall at all. And faces are
  // merged per LINE before this (`oneFacePerLine`), so an inner face broken by
  // partitions arrives as one face co-extensive with its outer, not as a
  // fragment floating inside it — that case cannot reach this rule.
  const [headGap, tailGap] = overhangsAlong(a, b);
  const loose = shorter * BOTH_ENDS_OVERHANG;
  if (headGap > loose && tailGap > loose) return null;

  // ── A DIMENSION STRING REACHES HERE AND PASSES, AND NO RULE BELOW STOPS IT.
  //    DO NOT SPEND THE AFTERNOON ON A DISTANCE THRESHOLD; IT IS ELIMINATED. ──
  //
  // S08 reports 509 ft against a 464 ft key, and 31 of the 45 extra feet are
  // one phantom: two runs at 8.40in — a thickness no wall on that sheet has —
  // pairing the hall partition's south face with the sheet's own dimension
  // string, which the generator spec puts at y = 22.87 in five segments from
  // -0.5 to 56.27 ft. The partition itself is still found correctly at 56.0 ft.
  //
  // Every rule above is a near miss, which is why it is worth naming them:
  //
  //   rule 5  the string runs -0.5 to 56.27 and the face, merged across its
  //           five doorways by `oneFacePerLine`, runs 0.5 to 55.7 — ratio 1.03
  //   rule 6  it overhangs 1.0 ft at one end and 0.6 ft at the other, and this
  //           rule deliberately needs BOTH loose, one loose end being a corner
  //   the rest thickness, parallelism and overlap are perfect, because a
  //           dimension string is drawn parallel to the wall it measures for
  //           the whole length of it
  //
  // BUILT AND REVERTED, 2026-10-16. A filter was written on the strength of
  // what the drawing WRITES on one of the two lines: a string carries its
  // figures, measured at 0.14 ft from its own line on S08 against 0.82 ft to
  // the nearest wall face. It worked — S08 fell from +9.6% to +2.9% and S14
  // from +4.7% to +3.0%.
  //
  // IT ALSO DELETED 40 FT OF REAL WALL ON S13, and that is the part to read
  // before trying again. S13's interior dimension row is at y = 21.87 with a
  // real 4-1/2in wall centred on y = 22.0, so its faces are 21.81 and 22.19:
  //
  //     S08   figures to the string 0.14 ft,  to the nearest wall face 0.82 ft
  //     S13   figures to the string 0.14 ft,  to the nearest wall face 0.06 ft
  //
  // The quantity a threshold would have to split is the SAME on both sheets.
  // Swept at bands of 0.35, 0.25 and 0.20 ft and at 3, 4 and 5 figures: S13
  // loses its wall in all six, and S08 is fixed in all six. The band is not
  // too wide — distance from the figures cannot answer this question at all.
  //
  // Both sheets are `clutter: "hard"` in their spec, so this is the fixture
  // set doing its job rather than an unlucky coincidence. Whatever separates
  // them is not distance: a string is one line where a wall is a pair, but on
  // S13 the string sits 0.32 ft from the far face, which is itself a plausible
  // partition. That is where the next attempt starts.

  // The centreline, over the OVERLAPPING span only — the part that is actually
  // two-sided. A face that runs past its partner is a different wall's face or
  // a drafting artefact, and claiming it would overstate the footage.
  const dx = (a.x2 - a.x1) / aLen;
  const dy = (a.y2 - a.y1) / aLen;
  const bOne = (b.x1 - a.x1) * dx + (b.y1 - a.y1) * dy;
  const bTwo = (b.x2 - a.x1) * dx + (b.y2 - a.y1) * dy;
  const from = Math.max(0, Math.min(bOne, bTwo));
  const to = Math.min(aLen, Math.max(bOne, bTwo));

  // Halfway between the two faces, which is where somebody tracing by hand puts
  // the line.
  const offX = (midX - (a.x1 + dx * ((from + to) / 2))) / 2;
  const offY = (midY - (a.y1 + dy * ((from + to) / 2))) / 2;

  return {
    x1: a.x1 + dx * from + offX,
    y1: a.y1 + dy * from + offY,
    x2: a.x1 + dx * to + offX,
    y2: a.y1 + dy * to + offY,
    thicknessFeet,
    lengthFeet,
  };
}

/**
 * Every wall the strokes on a sheet make.
 *
 * EACH FACE IS USED ONCE. A corridor drawn as three parallel lines — two rooms
 * sharing a middle wall — would otherwise yield three "walls" from two, and the
 * middle face would be counted twice. First match wins, which is why the
 * segments are sorted longest-first: the long run of a corridor wall should
 * claim its partner before a short jamb stub does.
 */
export function wallsFromStrokes(
  segments: readonly StrokeSegment[],
  options: WallFinderOptions,
): WallCandidate[] {
  // ── THE LENGTH FILTER IS HOISTED, AND THAT IS WHAT MAKES THIS RUNNABLE ──
  //
  // The pairing below is O(n²) with `inAHatchSeries` scanning inside it. A real
  // ARCH D export carries 79,001 stroked segments and one measured here carried
  // 116,893 — call it 10¹⁰ operations, which is not slow, it is never.
  //
  // `minLengthFeet` was already being applied, per PAIR, inside `wallFromPair`.
  // Applying it to the INPUT first is not an approximation and not a heuristic:
  // a wall's length is the overlap of its two faces, which is at most the
  // shorter face, so a face below the minimum cannot belong to a wall above it.
  // Exactly the same walls come back.
  //
  // Measured on real sheets, 2026-10-07: 116,893 segments → 7,998, and 23,351 →
  // 1,623. Most of what a CAD sheet strokes is lettering outlines, hatching and
  // leader lines, none of which is two feet of building long. That took the
  // worst sheet to 1.7s and the smallest to 81ms.
  const minLengthPoints = (options.minLengthFeet ?? DEFAULTS.minLengthFeet) / options.feetPerPoint;
  // THE PIECES OF A FACE FIRST, then the length filter — in that order, and the
  // order matters. A face broken into window-sized pieces can have every piece
  // under the 2 ft floor while the face itself is 120 ft of building, so
  // filtering first throws the wall away before anything can pair it.
  const usable = oneFacePerLine(segments, options.feetPerPoint).filter(
    (segment) => lengthOf(segment) >= minLengthPoints,
  );
  const order = [...usable].sort((a, b) => lengthOf(b) - lengthOf(a));
  const used = new Set<number>();
  // ── WHICH SIDE OF EACH CLAIMED FACE IS SPOKEN FOR ──
  //
  // `used` says a face belongs to a wall. It does not say WHICH OF ITS TWO
  // SIDES that wall is on, and a face has two — the near face of a block wall
  // has the block behind it and furring in front. See `secondAssemblyPass`.
  const claimedSides = new Map<number, Set<number>>();
  const claimSide = (face: number, partner: number) => {
    const side = sideOf(order[face], order[partner]);
    const sides = claimedSides.get(face) ?? new Set<number>();
    sides.add(side);
    claimedSides.set(face, sides);
  };
  const walls: WallCandidate[] = [];

  // REFUSED BEFORE ANY WORK, not part-way through. The pair count is known from
  // the input alone, so a sheet that cannot be paired says so immediately
  // rather than after two seconds of spinning — and the estimator gets the same
  // sentence either way. See `MAX_PAIR_TESTS`.
  const pairTests = (order.length * (order.length - 1)) / 2;
  if (pairTests > MAX_PAIR_TESTS) throw new SheetTooDenseError(order.length);

  for (let i = 0; i < order.length; i += 1) {
    if (used.has(i)) continue;
    // ── THE OUTERMOST PARTNER, NOT THE FIRST ONE ──
    //
    // This used to take the first valid partner it met in length order and
    // stop. For a wall drawn as two faces that is the only partner there is, so
    // it was right for years. An exterior wall is drawn as FOUR — outer finish,
    // sheathing, stud face, inner face — and then three of the six pairings are
    // inside the thickness band:
    //
    //   outer finish -> inner face   8.28in   the wall
    //   sheathing    -> inner face   6.72in   two layers of it
    //   stud face    -> inner face   6.00in   the stud cavity
    //
    // Whichever came first won. Measured against a 60-page answer key, the
    // envelope was being found and then reported at 6.6in — 297 ft of it on one
    // sheet — against a true EXT-2 of 8-1/8in. A wall at the wrong thickness is
    // priced as the wrong assembly, which is a worse failure than not finding
    // it: the footage looks right and the bid is wrong.
    //
    // What an estimator measures is finish to finish, so the widest valid pair
    // is the wall and the narrower ones are its layers.
    // The widest valid partner whose face is a PLAUSIBLE PARTNER, falling back
    // to the widest of any kind. Taking the widest alone reaches past the wall
    // and pairs with the column grid line — see `BALANCED_FACE_RATIO`.
    let bestJ = -1;
    let bestWall: WallCandidate | null = null;
    let anyJ = -1;
    let anyWall: WallCandidate | null = null;
    // ── AND THE WIDEST PAIR THAT IS A THICKNESS THIS COMPANY BUILDS ──
    //
    // "The widest valid pair is the wall and the narrower ones are its layers"
    // is right for one wall drawn in layers and WRONG where two assemblies
    // touch. 1-1/2in furring on an 8in block wall is three lines, and the pairs
    // are 8in (the block), 1-1/2in (the furring) and 9-1/2in (across both).
    // Widest wins, so the finder returned ONE WALL AT 9-1/2IN — a thickness
    // nobody builds, priced as an assembly nobody ordered, with the furring
    // gone. Reproduced from three segments, not argued.
    //
    // Thickness alone cannot separate that from a layered exterior, where the
    // widest span IS the wall: an EXT-1 drawn as five lines correctly returns
    // one 8-1/4in wall. What separates them is the SCHEDULE. 8 and 1-1/2 are
    // both on it; 9-1/2 is on nothing. So when the caller knows what this
    // company builds, prefer the widest pair that is one of those.
    //
    // The schedule is not privileged information: it is printed on the drawing,
    // it is what an estimator reads first, and `wallTypesFromSchedule` already
    // extracts it. Without it the loop behaves exactly as before.
    let knownJ = -1;
    let knownWall: WallCandidate | null = null;
    let knownAnyJ = -1;
    let knownAnyWall: WallCandidate | null = null;
    const knownIn = options.knownThicknessesIn ?? [];
    const iLength = lengthOf(order[i]);
    for (let j = i + 1; j < order.length; j += 1) {
      if (used.has(j)) continue;
      const wall = wallFromPair(order[i], order[j], options);
      if (wall === null) continue;
      if (inAHatchSeries(order, i, j, options)) continue;
      // A PAIR INSIDE A WALL YOU BUILD IS THAT WALL'S LAYER, whatever it
      // measures. Applied to every candidate rather than only the thin ones:
      // D1 is a 14-1/2in chase wall drawn as four lines whose inner pair is
      // about 5in, which is C1's 4-3/4in within slack, so the same defect
      // arrives one size up. Measured: 158 ft of the holdout over-run was D1
      // reported twice.
      const layerLine =
        knownIn.length > 0 &&
        (enclosedByAScheduledWall(order, i, j, options, knownIn) ||
          enclosedByAScheduledWall(order, j, i, options, knownIn));
      // A SUB-FLOOR PAIR IS REFUSED OUTRIGHT when it is a layer line, because
      // the only reason it is a candidate at all is that the schedule names its
      // thickness — and a layer line is not that wall, it is the inside of a
      // wider one. Without the schedule the floor would have refused it with no
      // argument, so there is nothing to fall back to.
      //
      // A pair AT OR ABOVE the floor only loses its schedule PREFERENCE. It
      // stays eligible under the rules that were here before, deliberately:
      // `enclosedByAScheduledWall` scans every parallel line within the
      // thickness window, so on a busy sheet a perfectly real wall can sit a
      // scheduled thickness away from another one and look enclosed. Refusing
      // those outright was measured and it is a disaster — Mesa Ridge drops to
      // 58,438 ft found, BELOW the 59,538 it started at, and A-101 to 1,798
      // from 1,853. The guard is sharp enough for the case it was written for
      // and not sharp enough to be trusted beyond it.
      if (layerLine && wall.thicknessFeet < (options.minThicknessFeet ?? DEFAULTS.minThicknessFeet)) {
        continue;
      }
      if (anyWall === null || wall.thicknessFeet > anyWall.thicknessFeet) {
        anyWall = wall;
        anyJ = j;
      }
      // AND AN ENCLOSED PAIR OF NORMAL THICKNESS IS A LAST RESORT, not a
      // preference. It has already been recorded as the fallback above, so a
      // real wall that merely looks enclosed is still found; what it cannot do
      // is beat a pair the schedule names. Refusing these outright was measured
      // and it is worse than doing nothing — Mesa Ridge 58,438 ft found against
      // 59,538 before any of this.
      if (layerLine) continue;
      // A SPAN THAT DECOMPOSES INTO TWO SCHEDULED ASSEMBLIES IS NOT A WALL.
      // Only asked of pairs wide enough for two assemblies to fit, because the
      // scan is O(n) inside this loop; 6in is below the thinnest pair of
      // scheduled types that could compose one.
      const known =
        isAKnownType(wall.thicknessFeet, knownIn) &&
        !(
          wall.thicknessFeet * 12 > 6 &&
          splitsIntoScheduledAssemblies(order, i, j, wall.thicknessFeet, options, knownIn)
        );
      if (known && (knownAnyWall === null || wall.thicknessFeet > knownAnyWall.thicknessFeet)) {
        knownAnyWall = wall;
        knownAnyJ = j;
      }
      const jLength = lengthOf(order[j]);
      const ratio = Math.max(iLength, jLength) / Math.max(Math.min(iLength, jLength), 1e-9);
      if (ratio > BALANCED_FACE_RATIO) continue;
      if (bestWall === null || wall.thicknessFeet > bestWall.thicknessFeet) {
        bestWall = wall;
        bestJ = j;
      }
      if (known && (knownWall === null || wall.thicknessFeet > knownWall.thicknessFeet)) {
        knownWall = wall;
        knownJ = j;
      }
    }
    // A schedule thickness first, balanced before unbalanced within each tier.
    const chosen = knownWall ?? knownAnyWall ?? bestWall ?? anyWall;
    const chosenJ =
      knownWall !== null
        ? knownJ
        : knownAnyWall !== null
          ? knownAnyJ
          : bestWall !== null
            ? bestJ
            : anyJ;
    const balanced = knownWall !== null || (knownAnyWall === null && bestWall !== null);
    if (chosen !== null) {
      used.add(i);
      used.add(chosenJ);
      claimSide(i, chosenJ);
      claimSide(chosenJ, i);
      walls.push({ ...chosen, fromBalancedFaces: balanced });
    }
  }

  walls.push(...secondAssemblyPass(order, walls, used, claimedSides, options));

  return oneWallPerPlace(walls, options.feetPerPoint);
}

/**
 * The assembly on the OTHER side of a face the main loop already claimed.
 *
 * ── THE DEFECT, MEASURED NOT ARGUED ──
 *
 * 1-1/2in furring on 8in block is three parallel lines: the furring face F, the
 * block's near face C, the block's far face D. Two of the three gaps are
 * thicknesses this company builds — F-C is the furring, C-D is the block — and
 * the pair across both (9-1/2in) is on nothing, which the schedule preference
 * in the main loop already refuses.
 *
 * It still loses the furring, and the reason is `used`. Whichever of F or C the
 * loop reaches first claims the other, and C is shared: once the block has
 * taken C, F has no unclaimed partner left and is dropped. On the bench the
 * block comes back correct — 1,408 ft of it, every foot graded out-of-scope
 * because this sub does not lay block — and the furring in front of it, which
 * IS their work, comes back at 298 ft against a key of 1,582.
 *
 * Diagnosed from the answer key's own words. 32 of 64 furring walls carry
 * "only one face reached the reader, or the faces came back 1.5": both faces
 * WERE read, the measurement WAS right, and the pair was thrown away.
 *
 * ── WHY A SECOND PASS AND NOT A FIX TO THE LOOP ──
 *
 * Because the loop is where this was tried before and it regressed the holdout
 * by 1,514 ft. A pass that only ADDS cannot change any wall the loop already
 * found: every existing number is reproduced by construction, so a measurement
 * afterwards reads only what this introduced. That is worth more here than
 * elegance.
 *
 * ── THE RULE ──
 *
 * A face may serve a second wall when that wall is on its OTHER SIDE. That is
 * not a loosening of `used`, it is the physical fact `used` was eliding: a line
 * on a drawing is a surface with a side facing each way, and what is built
 * against one says nothing about the other.
 *
 * Three guards, each load-bearing:
 *   - the thickness must be one the SCHEDULE names. Without it this would pair
 *     any two thin coincidences on the sheet, which is the sweep the floor's
 *     own comment records as making the holdout worse on both counts;
 *   - neither face may be a LAYER LINE of a scheduled wall
 *     (`enclosedByAScheduledWall`) — the inside of a wider assembly is not a
 *     second assembly;
 *   - and the side has to be FREE on both faces. Without that this re-finds the
 *     wall the loop just built, from the other end.
 *
 * `oneWallPerPlace` is the backstop and it is not relied on here: its own
 * header works the furring case out, noting a furring centreline sits outside
 * the band of the wall it leans on and so survives. This pass is written to
 * emit nothing that would need dropping.
 */
function secondAssemblyPass(
  order: readonly StrokeSegment[],
  found: readonly WallCandidate[],
  used: ReadonlySet<number>,
  claimedSides: ReadonlyMap<number, ReadonlySet<number>>,
  options: WallFinderOptions,
): WallCandidate[] {
  const knownIn = options.knownThicknessesIn ?? [];
  // WITHOUT A SCHEDULE THIS PASS DOES NOTHING, deliberately: the schedule is
  // the only thing separating "two assemblies touching" from "two lines that
  // happen to be close", and the finder has to behave exactly as before for a
  // caller that has not read one.
  if (knownIn.length === 0 || found.length === 0) return [];

  const extra: WallCandidate[] = [];
  const sideFree = (face: number, partner: number) =>
    !(claimedSides.get(face)?.has(sideOf(order[face], order[partner])) ?? false);

  for (let i = 0; i < order.length; i += 1) {
    // Only a face the loop CLAIMED can have a free side worth revisiting; an
    // unclaimed face was offered to the loop and refused on its merits.
    if (!used.has(i)) continue;
    for (let j = 0; j < order.length; j += 1) {
      if (j === i) continue;
      if (!sideFree(i, j) || !sideFree(j, i)) continue;
      const wall = wallFromPair(order[i], order[j], options);
      if (wall === null) continue;
      // The schedule names it, and it is not the inside of something wider.
      if (!isAKnownType(wall.thicknessFeet, knownIn)) continue;
      if (
        enclosedByAScheduledWall(order, i, j, options, knownIn) ||
        enclosedByAScheduledWall(order, j, i, options, knownIn)
      ) {
        continue;
      }
      if (inAHatchSeries(order, i, j, options)) continue;
      // Nothing already found or already added describes this place.
      if (found.some((already) => foundTwice(already, wall, options.feetPerPoint))) continue;
      if (extra.some((already) => foundTwice(already, wall, options.feetPerPoint))) continue;
      extra.push({ ...wall, fromBalancedFaces: false });
    }
  }
  return extra;
}

/**
 * How much of the shorter run must lie alongside the other before the two can
 * be one wall found twice.
 *
 * Half, because the leftover pairing is made from the SAME faces and therefore
 * spans the same stretch — a duplicate overlaps almost completely. Requiring
 * more would miss the case where a doorway broke one copy and not the other;
 * requiring much less would start merging two walls that merely pass each other
 * at a corner.
 */
export const SAME_WALL_OVERLAP = 0.5;

/**
 * ── ONE PHYSICAL WALL, FOUND ONCE ──
 *
 * The pairing above answers "which two faces are this wall" and consumes them.
 * It does NOT answer "have I already found this wall", and on anything drawn
 * with more than two faces those are different questions.
 *
 * An interior partition is two lines, so there is one pairing and no way to go
 * wrong. **An exterior wall is four or five** — outer finish, sheathing, stud
 * face, inner face. The widest valid pair is taken as the wall, correctly, and
 * then THE LEFTOVER FACES IN THE MIDDLE PAIR WITH EACH OTHER and are reported
 * as a second, thinner wall lying on top of the first.
 *
 * Measured on the face offsets a real envelope uses (+0.00, +1.56, +2.28,
 * +8.28, +8.88in), one 40 ft wall:
 *
 *   | faces drawn | walls returned | feet reported |
 *   | --- | --- | --- |
 *   | 2, an interior partition | 1 | 40 — correct |
 *   | 4, brick and stud | **2** | **80** |
 *   | 5, as measured | **2** | **80** |
 *   | 6, with a column grid line | **3** | **120** |
 *
 * It was found by a hand count on School-01: the drawing's own tag `EXT-1`
 * came back on THREE different thickness groups at once, which is impossible
 * for one assembly and is the signature of one wall counted three times.
 *
 * ── OVER-REPORTING IS THE DANGEROUS DIRECTION ──
 *
 * An under-report is caught by eye — a wall with no line on it is visible on
 * the drawing. This is not: every copy sits exactly on a real wall, so the
 * overlay looks perfect while the footage is double. It reaches a bid.
 *
 * ── WHY THE FIRST ONE IS THE ONE TO KEEP, AND NOT THE WIDEST ──
 *
 * The loop above walks faces in descending LENGTH, so the first wall emitted at
 * a place is the one built from the longest faces available — the pairer's own
 * best answer, already filtered through `BALANCED_FACE_RATIO`. The leftovers
 * come afterwards by construction.
 *
 * Keeping the widest instead would be worse than doing nothing where a column
 * grid line is in reach: the grid-line pairing is the WIDEST of the three and
 * is not a wall at all. Widest-first would keep it and discard the real wall
 * underneath.
 *
 * ── BUT EMISSION ORDER ALONE IS NOT ENOUGH, AND THE FIRST DRAFT PROVED IT ──
 *
 * The loop walks faces in descending length, so a 115 ft COLUMN GRID LINE is
 * reached before the 40 ft wall it runs past — and the pairing it makes is
 * emitted first. Measured on this exact input, the first version of this
 * function returned one wall of 10.92in where the drawing has an 8.88in one:
 * it deduplicated correctly and kept the wrong copy, which is worse than the
 * duplicate it replaced, because the footage now looks right.
 *
 * So the order is BALANCED FIRST, emission order within that. The pairer
 * already decides whether a pair was balanced — `bestWall` against the
 * `anyWall` fallback — and used to discard the answer; `fromBalancedFaces`
 * carries it here. A fallback pairing is still kept when nothing balanced
 * describes that place, exactly as before.
 */
export function oneWallPerPlace(
  walls: readonly WallCandidate[],
  feetPerPoint: number,
): WallCandidate[] {
  const balancedFirst = [
    ...walls.filter((wall) => wall.fromBalancedFaces !== false),
    ...walls.filter((wall) => wall.fromBalancedFaces === false),
  ];
  const kept: WallCandidate[] = [];
  for (const wall of balancedFirst) {
    if (!kept.some((already) => foundTwice(already, wall, feetPerPoint))) kept.push(wall);
  }
  return kept;
}

/**
 * Is `wall` the same wall as `already`, found a second time?
 *
 * Three things have to hold, and the third is the one doing the work: the
 * centreline of the second lies INSIDE the thickness of the first. That is a
 * tight test by design — a furring wall against a 10in wall has its centreline
 * 6.25in off, outside a 5in half-band, and survives. Two findings of one wall
 * are within an inch of each other.
 *
 * ── ONE CHOICE HERE IS NOT PINNED BY ANY TEST, AND IT IS WRITTEN DOWN RATHER
 * THAN DRESSED UP ──
 *
 * The band is the ALREADY-KEPT wall's thickness. Reading it from the new one
 * instead survives the whole suite, and the mutation run says so. That is not a
 * hole somebody forgot to close: the two readings differ only when the new wall
 * is much thicker AND its centreline sits between the two half-bands, which on
 * a drawing means two walls occupying the same three inches. No real assembly
 * does that, so no honest case can be written, and a contrived one would assert
 * the choice rather than justify it.
 *
 * `already` is the one kept because it is the conservative direction — a
 * narrower band drops fewer things — and because the kept wall is the one the
 * pairer trusted. If a case ever turns up, it belongs here with its drawing.
 */
function foundTwice(already: WallCandidate, wall: WallCandidate, feetPerPoint: number): boolean {
  if (angleGap(angleOf(already), angleOf(wall)) > PARALLEL_TOLERANCE_RAD) return false;
  const shorter = Math.min(lengthOf(already), lengthOf(wall));
  if (shorter <= 0) return false;
  if (overlapAlong(already, wall) < shorter * SAME_WALL_OVERLAP) return false;
  const apart =
    perpendicularDistance(already, (wall.x1 + wall.x2) / 2, (wall.y1 + wall.y2) / 2) * feetPerPoint;
  return apart <= already.thicknessFeet / 2;
}

/**
 * Whether a pair is two strokes of a hatch band rather than a wall's two faces.
 *
 * Looks for a THIRD stroke parallel to both, overlapping them, and offset in the
 * same direction by a comparable step — the signature of a repeating series. See
 * `SERIES_REACH` for the 230-phantom measurement that produced this.
 */
function inAHatchSeries(
  segments: readonly StrokeSegment[],
  aIndex: number,
  bIndex: number,
  options: WallFinderOptions,
): boolean {
  const a = segments[aIndex];
  const b = segments[bIndex];
  const direction = angleOf(a);

  // Signed offsets along the normal of `a`, so "beyond b" and "before a" are
  // distinguishable rather than both reading as distance.
  const aLen = lengthOf(a);
  const nx = -(a.y2 - a.y1) / aLen;
  const ny = (a.x2 - a.x1) / aLen;
  const offsetOf = (segment: StrokeSegment) => {
    const mx = (segment.x1 + segment.x2) / 2 - a.x1;
    const my = (segment.y1 + segment.y2) / 2 - a.y1;
    return mx * nx + my * ny;
  };

  const step = offsetOf(b);
  if (step === 0) return false;
  let members = 0;
  let halves = 0;
  const reach = Math.abs(step) * SERIES_REACH;

  for (let k = 0; k < segments.length; k += 1) {
    if (k === aIndex || k === bIndex) continue;
    const other = segments[k];
    if (lengthOf(other) === 0) continue;
    if (angleGap(angleOf(other), direction) > PARALLEL_TOLERANCE_RAD) continue;
    // It has to be alongside the pair, not somewhere else on the sheet.
    if (overlapAlong(a, other) < Math.min(aLen, lengthOf(other)) * 0.5) continue;
    // AND IT HAS TO LOOK LIKE THE PAIR — IN BOTH DIRECTIONS.
    //
    // Too SHORT: a fixture drawn in the next room is a short parallel line,
    // and the overlap test above cannot refuse it, because it is measured
    // against the SHORTER of the two — a 2.5 ft line inside a 17.5 ft wall
    // overlaps it 100%.
    //
    // Too LONG: a DIMENSION STRING runs the whole side of the building,
    // parallel to the wall it measures and offset from it by a round
    // distance. S17's south wall is 300mm, so its faces are 0.98 ft apart,
    // and its dimension line sits 1.88 ft below the outer face:
    //
    //     1.88 / 0.98 = 1.918 steps,  |1.918 - 2| = 0.08  <=  0.2
    //
    // — so a 50 ft dimension line and two wall faces read as a three-member
    // series, and the whole 49 ft wall was thrown away. The glazing lines of
    // its two windows then paired with each other, and the sheet reported
    // 16.4 ft of wall at 7.09in: the WINDOWS measured as the wall.
    //
    // This is the same defect as the fixture case, from the other end of the
    // scale, which is why one rule covers both: hatching is a fill whose
    // strokes resemble each other, and a member 2.7 times the pair's own face
    // is not one of them.
    const otherLen = lengthOf(other);
    if (otherLen < Math.min(aLen, lengthOf(b)) * SERIES_MEMBER_RATIO) continue;
    if (otherLen > Math.max(aLen, lengthOf(b)) * SERIES_MEMBER_LONGEST) continue;

    const where = offsetOf(other);
    // ── IT MUST CONTINUE THE SPACING, NOT MERELY BE NEARBY ──
    //
    // This header has always said a third stroke "continues the spacing", and
    // for a long time the code only checked that one was somewhere in a RANGE
    // beside the pair. That is a different test, and it cost the whole exterior
    // envelope: measured against a 60-page answer key, EXT-1 and EXT-2 came
    // back 13 ft found of 12,830 — zero per cent, on every export style.
    //
    // An exterior wall is not two lines. It is four — outer finish, sheathing,
    // stud face, inner face — with a 5/8" board line and a column grid line
    // beside them. On one real sheet the faces sit at 24.52, 24.65, 24.71 and
    // 25.21 ft, with the board at 25.26 and the grid at 25.56. Fed those four
    // lines alone the pairer returns the wall correctly; on the page it
    // returned nothing, because two of those neighbours fall in the range and
    // the range was the whole test.
    //
    // Hatching is a REPEATED pattern — it is generated at a constant pitch, and
    // a wall assembly's layers are not. So the ratio is what decides: a series
    // member sits at a whole number of steps from the pair, and a wall's
    // neighbour does not. The board line lands at 1.07 steps and the grid at
    // 1.51; neither is a whole number, and both used to reject the envelope.
    const ratio = where / step;
    const nearest = Math.round(ratio);
    const offPitch = Math.abs(ratio - nearest);
    // 0 is `a` and 1 is `b`; -1 continues before `a`, 2 and 3 continue past
    // `b`, which is the same span `SERIES_REACH` already allowed.
    const continuesTheSeries =
      offPitch <= SERIES_PITCH_TOLERANCE && (nearest === -1 || nearest === -2 || nearest === 2 || nearest === 3);
    const inReach = Math.abs(where) <= Math.abs(step) + reach + Math.abs(step);
    if (continuesTheSeries && inReach) {
      members += 1;
      if (members >= SERIES_NEEDS_MEMBERS) return true;
    }
    // ── THE FILL'S OWN PITCH MAY BE HALF THIS PAIR'S STEP ──
    //
    // The pairer does not only pair NEIGHBOURING strokes. In a fill it also
    // pairs every other one, because two pitches is as plausible a wall
    // thickness as one: this repo's own poche is 4.24pt perpendicular, so one
    // pitch reads as a 4-7/8in partition and two as an 11in wall.
    //
    // Such a pair has only ONE neighbour at a whole number of its own steps,
    // so the count above lets it through and sells a slice of fill as a wall.
    // The strokes BETWEEN are the tell: they sit at a half step.
    if (inReach && Math.abs(offPitch - 0.5) <= SERIES_PITCH_TOLERANCE) {
      halves += 1;
      if (halves >= SERIES_NEEDS_HALVES) return true;
    }
  }

  return false;
}

/** One thickness of wall found on a sheet: how many runs, and how much of it. */
export type WallCluster = {
  /** The cluster's thickness in INCHES, averaged over its runs — what an
   *  estimator recognises ("4-7/8" is a 3-5/8" stud with board both sides"). */
  inches: number;
  runs: WallCandidate[];
  feet: number;
};

/**
 * HOW FAR APART TWO THICKNESSES HAVE TO BE TO BE DIFFERENT WALLS, in inches.
 *
 * MEASURED, not chosen. Real sheets do not return clean thicknesses: one came
 * back with 4.92" and 4.64" as separate values holding 739ft and 682ft, which is
 * one partition type split by how CAD drew its two faces. At 0.25" they stay
 * apart; at 0.5" they merge, which is right.
 *
 * It does not go higher, and the reason is the whole value of the grouping: a
 * 3-5/8" stud wall and a 4-7/8" partition are 1.25" apart and are DIFFERENT
 * WALLS with different material. A bucket wide enough to swallow that gap would
 * quietly add one type's footage to another's — a wrong number on a bid, which
 * is worse than showing an estimator two groups where they expected one.
 *
 * Tested across 7 real sheets: 0.5" took one from 21 clusters to 13 while
 * leaving every pair of real partition types distinct.
 */
export const CLUSTER_INCHES = 0.5;

/**
 * The walls on a sheet, grouped by thickness, BIGGEST FOOTAGE FIRST.
 *
 * ── WHY FOOTAGE AND NOT COUNT, AND WHY GROUPS AT ALL ──
 *
 * A real floor plan returns 15-21 thickness clusters, not the three anybody
 * would guess, and the top three hold only about half the footage. That is the
 * measurement this function is shaped by: there is no tidy "here are your three
 * wall types", and pretending otherwise would mean hiding footage an estimator
 * is going to bid.
 *
 * What IS true is that the LARGEST clusters are the ones a bid turns on, and
 * they land on dimensions walls are actually built at — 4.88", 4.92", 4.80" on
 * three unrelated projects, all of them 4-7/8": a 3-5/8" stud with 5/8" board
 * each side. Noise does not land on 4-7/8". So sorting by footage puts the real
 * partition runs at the top, where accepting ONE of them replaces ninety-nine
 * hand traces, and leaves the long tail for a person to judge or ignore.
 *
 * Pure, like everything else in this file.
 */
export function clusterByThickness(
  walls: readonly WallCandidate[],
  clusterInches = CLUSTER_INCHES,
): WallCluster[] {
  const byThickness = [...walls].sort((a, b) => a.thicknessFeet - b.thicknessFeet);
  const clusters: { runs: WallCandidate[]; feet: number }[] = [];

  for (const wall of byThickness) {
    const inches = wall.thicknessFeet * 12;
    const open = clusters[clusters.length - 1];
    // Against the cluster's FIRST member rather than its running mean: a mean
    // drifts as members join, so a long enough chain of near-misses would walk
    // a cluster across the 1.25" gap this is meant to preserve.
    const start = open === undefined ? null : open.runs[0].thicknessFeet * 12;
    if (open !== undefined && start !== null && inches - start <= clusterInches) {
      open.runs.push(wall);
      open.feet += wall.lengthFeet;
    } else {
      clusters.push({ runs: [wall], feet: wall.lengthFeet });
    }
  }

  return clusters
    .map((cluster) => ({
      // The average, so the label is the thickness the runs actually have
      // rather than whichever one happened to open the cluster.
      inches:
        cluster.runs.reduce((total, run) => total + run.thicknessFeet * 12, 0) / cluster.runs.length,
      runs: cluster.runs,
      feet: cluster.feet,
    }))
    .sort((a, b) => b.feet - a.feet);
}

/**
 * A THICKNESS AN ESTIMATOR RECOGNISES: 4.875 → `4-7/8"`.
 *
 * To the nearest EIGHTH, because that is how a wall is specified, sold and
 * talked about. `clusterByThickness` averages over a group's runs and hands
 * back decimals no drawing ever carried — printing `4.81"` would state a
 * precision the measurement does not have, on a label whose only job is to be
 * recognised. `4-3/4"` is a wall somebody can picture.
 *
 * HERE RATHER THAN IN THE VIEWER, and that is a rule rather than a preference:
 * it lived in `TakeoffPlanViewer.tsx` for one commit and the client/server
 * boundary census failed it — a `"use client"` module may export components,
 * not plain values. It is pure and it is about walls, so it belongs beside the
 * finder that produces the number.
 */
/**
 * ── THE ONE ROUNDING, AND EVERYTHING THAT SHOWS OR COMPARES A THICKNESS USES
 *    IT ──
 *
 * A measured thickness is a float: the detector reads 4.33333277" off the
 * geometry where the drafter drew a 4-3/8" wall. Both numbers are correct and
 * they are not interchangeable, so the rule is which one is used WHERE.
 *
 * The precise value is what gets STORED, because it is the measurement and
 * nothing should quietly discard it. The rounded value is what gets SHOWN and
 * what gets COMPARED, because an estimator reading "4-3/8"" on screen and a
 * condition they typed as 4.375 must be able to meet — and because a panel
 * that matched on one number while displaying another is a screen telling two
 * stories about the same wall.
 *
 * Nearest eighth, which is how partitions are drawn and how every wall type in
 * this product is typed in.
 */
export function toEighth(inches: number): number {
  return Math.round(inches * 8) / 8;
}

export function inchLabel(inches: number): string {
  const eighths = Math.round(inches * 8);
  const whole = Math.floor(eighths / 8);
  const part = eighths % 8;
  if (part === 0) return `${whole}"`;
  const half = part % 2 === 0 ? part / 2 : part;
  const over = part % 2 === 0 ? 4 : 8;
  const reduced = half % 2 === 0 ? `${half / 2}/${over / 2}` : `${half}/${over}`;
  return whole === 0 ? `${reduced}"` : `${whole}-${reduced}"`;
}

/**
 * ── HOW FAR APART TWO RUNS CAN BE AND STILL BE THE SAME BUILDING, IN FEET ──
 *
 * MEASURED, by looking. At 6ft a real floor plan shattered into 46 pieces and
 * the biggest held 49 of 203 runs — a corner of the offices, with the rest of
 * the plan thrown away. Sweeping it: 12ft kept 132, 20ft kept 178, 30ft kept
 * 186. It plateaus at 20, which is the number here.
 *
 * It has to be this generous because detected runs do not touch as often as a
 * drawing suggests: a doorway, a cased opening, a corridor crossing or a wall
 * the finder simply missed all leave a gap, and a plan is still one building
 * across them. 20ft is wider than any of those and far narrower than the
 * distance from a floor plan to the title block beside it.
 */
export const SAME_BUILDING_FEET = 20;

/**
 * Fewer runs than this is not a floor plan — see `wallsInTheBuilding`.
 *
 * ── TEN EXCLUDES SMALL BUILDINGS, AND LOWERING IT IS NOT THE FIX ──
 *
 * `wallsInTheBuilding`'s comment argues for ten from six real plans that
 * "returned 38, 58, 68, 230, 295 and 453", concluding the gap between a box and
 * a plan "is an order of magnitude, not a margin". Every one of those six is a
 * large commercial floor, and a small residential plan does not behave like
 * them.
 *
 * Measured 2026-10-15 on twenty sheets drawn outside this repo
 * (`lib/takeoff/fixtures`), reading the biggest connected group on each:
 *
 *   GUEST HOUSE            8 runs   50% x 38% of the sheet   175 ft
 *   HOUSE WITH ANGLED WING 9 runs   43% x 35%                145 ft
 *   BUNGALOW               9 runs   25% x 19%                172 ft
 *   TWO-BEDROOM COTTAGE   10 runs   42% x 29%                223 ft   (scraped through)
 *
 * The first three return NOTHING — a correct scale, a correct pairing, then an
 * empty panel saying "No walls found on this sheet. That is a fact about the
 * drawing, not a failure." It is not a fact about the drawing. The cottage
 * passed by a single run.
 *
 * ── TWO LOWER VALUES WERE TRIED AND THE BENCH REFUSED BOTH ──
 *
 * Against its twenty-nine zero-wall cases — the population of sheets that
 * SHOULD yield nothing:
 *
 *   NOT_A_BOX = 10   11 of 36 zero-wall cases produce walls   (today)
 *   NOT_A_BOX =  8   17 of 36
 *   NOT_A_BOX =  5   31 of 36, and the COVER SHEET invents 581 ft on every
 *                    variant — its vicinity map's streets pair as walls
 *
 * So the run count is load-bearing and the number is not the problem. Footage
 * does not separate them either: the cover sheet's 581 ft is larger than any of
 * the three houses above.
 *
 * ── WHAT WOULD ACTUALLY FIX IT ──
 *
 * The difference between a guest house and a vicinity map is not how many runs
 * or how long they are. It is that a plan's runs ENCLOSE rooms and a street
 * network does not. `wallRuns.ts` already traces enclosed regions, so the
 * discriminator exists and is not wired to this decision. That is a real piece
 * of work rather than a constant, and it is deliberately not smuggled in here.
 *
 * Until then: **a floor plan with fewer than ten wall runs returns nothing**,
 * and that is a known, measured limitation rather than an accident.
 */
export const NOT_A_BOX = 10;

/** Closest approach between two centrelines, point to segment. */
function gapBetween(a: WallCandidate, b: WallCandidate): number {
  const toSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  return Math.min(
    toSegment(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2),
    toSegment(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2),
    toSegment(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2),
    toSegment(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2),
  );
}

/**
 * THE RUNS THAT BELONG TO THE BUILDING, AND NOT TO THE REST OF THE SHEET.
 *
 * ── WHY THIS EXISTS, AND IT IS NOT A REFINEMENT ──
 *
 * The finder had no idea WHERE on the sheet the drawing was. It read the whole
 * page, so it returned the title block's ruled lines, the notes column, the
 * sheet border, and the wall-section details printed above the plan — every one
 * of them a real pair of parallel lines at a real spacing, and none of them a
 * wall in this building.
 *
 * Nobody noticed from the numbers. The thicknesses looked right — clusters at
 * 4.88", 4.92", 4.80" on three projects — and that was read as proof the result
 * was real. It proves nothing: a drawing is full of parallel pairs at
 * building-ish spacings, so some land on a partition thickness by arithmetic
 * alone. The first person to LOOK at the output found it drawing nothing like
 * the walls, and the fix only became obvious once there was a picture.
 *
 * ── THE IDEA ──
 *
 * A floor plan is ONE connected thing; everything else on the sheet is
 * somewhere else. So the runs say where the plan is: join the ones near each
 * other and keep the biggest group. Nothing here knows what a title block looks
 * like or where a drawing is normally placed, which is why it survives a sheet
 * laid out differently.
 *
 * Biggest by FOOTAGE rather than by count, because a dense notes column can
 * out-count a building without out-measuring it.
 *
 * ── WHAT IT DOES NOT FIX, STATED BECAUSE IT IS VISIBLE IN THE SAME PICTURE ──
 *
 * Noise INSIDE the footprint survives, and on the sheet this was measured
 * against that is five long lines down an apparatus bay — slab joints or a
 * trench drain, which really are two parallel lines a wall-thickness apart.
 * They are in the building, so they join the building. What saves an estimator
 * there is the drawing itself: the bay is visibly empty, the lines are visibly
 * not walls, and they are drawn on screen before anything is accepted.
 */
/**
 * The candidates grouped into connected clusters, biggest footage first.
 *
 * SPLIT OUT OF `wallsInTheBuilding` so the grouping can be INSPECTED without
 * the accept/reject decision on top of it. The decision is the part that has
 * been wrong; the grouping has not been, and a diagnostic that can only see
 * the survivors cannot say what was thrown away or why.
 */
export function buildingGroups(
  walls: readonly WallCandidate[],
  feetPerPoint: number,
  sameBuildingFeet = SAME_BUILDING_FEET,
): WallCandidate[][] {
  if (walls.length === 0) return [];
  const joinPoints = sameBuildingFeet / feetPerPoint;

  const parent = walls.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      if (gapBetween(walls[i], walls[j]) <= joinPoints) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }

  const groups = new Map<number, WallCandidate[]>();
  walls.forEach((wall, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(wall);
    groups.set(root, list);
  });

  const feetOf = (group: WallCandidate[]) => group.reduce((total, w) => total + w.lengthFeet, 0);
  return [...groups.values()].sort((a, b) => feetOf(b) - feetOf(a));
}

export function wallsInTheBuilding(
  walls: readonly WallCandidate[],
  feetPerPoint: number,
  sameBuildingFeet = SAME_BUILDING_FEET,
): WallCandidate[] {
  if (walls.length === 0) return [];
  const joinPoints = sameBuildingFeet / feetPerPoint;

  const parent = walls.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      if (gapBetween(walls[i], walls[j]) <= joinPoints) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }

  const groups = new Map<number, WallCandidate[]>();
  walls.forEach((wall, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(wall);
    groups.set(root, list);
  });

  let best: WallCandidate[] = [];
  let bestFeet = -1;
  for (const group of groups.values()) {
    const feet = group.reduce((total, wall) => total + wall.lengthFeet, 0);
    if (feet > bestFeet) {
      bestFeet = feet;
      best = group;
    }
  }

  // ── A BUILDING IS NOT A BOX ──
  //
  // "The biggest group" is only the plan when there IS a plan. On a sheet that
  // yields almost no wall — a roof plan, an equipment plan, a demolition sheet
  // drawn in dashed line work — the biggest group is whatever else is on the
  // page, and what won on one real sheet was the TITLE BLOCK: four runs, 64ft,
  // a rectangle in the corner offered to an estimator as the walls of a
  // building. Found by looking at the picture; the numbers looked unremarkable.
  //
  // A rectangle is four runs. Real floor plans measured here returned 38, 58,
  // 68, 230, 295 and 453 — so the gap between "a box" and "a plan" is an order
  // of magnitude, not a margin, and this does not have to be a finely judged
  // number to sit inside it.
  //
  // Returning NOTHING is the right answer rather than a weak one: the panel
  // already says "No walls found on this sheet. That is a fact about the
  // drawing, not a failure", which is true of a roof plan and is far better
  // than four lines somebody has to recognise as a title block.
  // ── NO MINIMUM SIZE, DELIBERATELY ──
  //
  // This returned nothing when the best group had fewer than `NOT_A_BOX`
  // runs, to stop a TITLE BLOCK (four runs, 64 ft, a rectangle in the corner)
  // being offered as a building. The count was standing in for a question it
  // could not ask, and it answered wrongly in the direction that costs most:
  // a one-room building is also four runs, and S01, S10 and S11 — a studio,
  // a cottage and a guest house, all drawn with ordinary thin double-line
  // walls — returned zero.
  //
  // The title block is now gone before this function is reached:
  // `findWallsOnSheet` runs `wallsNotLettering`, `wallsNotTheSheetBorder` and
  // `wallsNotTheScaleBar` FIRST, so what arrives here is drawing rather than
  // furniture of the sheet. A building can be any size and any shape,
  // including one room.
  return best;
}

/**
 * ── THE PEN FILTER WAS HERE, AND IT COST MORE THAN IT SAVED ──
 *
 * #669 dropped every stroke at or below a sheet's commonest pen width, on the
 * reasoning that CAD draws walls heavy and hatching thin. It worked on the
 * sheet it was measured against: five slab joints running an apparatus bay
 * disappeared, and the wall count went UP because thin strokes had been
 * stealing partners from real wall faces.
 *
 * The cost was never measured, and it is enormous. Across 13 sheets from four
 * projects:
 *
 *   WITH the filter     919 walls
 *   WITHOUT it        2,264 walls
 *
 * On one sheet it was 12 against 380. **It was deleting 59% of the walls on a
 * drawing to remove a handful of wrong lines.**
 *
 * The premise is what fails: "the commonest pen is the hatching pen" is true of
 * some exports and false of others. On one sheet the mode landed ABOVE the pen
 * the walls were drawn with, so the filter kept the furniture and deleted the
 * building. Dropping only the THINNEST band instead was tried and is better on
 * one sheet, worse on another — neither rule wins, which is the signal that the
 * idea needs a discriminator it does not have.
 *
 * And the trade was the wrong way round for this product. A missing wall is a
 * SHORT BID that nothing on screen reveals; a wrong line is drawn on the
 * drawing and gets rejected in a glance. Precision was never the complaint —
 * what was reported as "reading the wrong walls" was the title block and the
 * room numbers, and both are fixed by `wallsInTheBuilding` and
 * `wallsNotLettering`, which stay.
 *
 * `StrokeSegment.width` is still read and still carried, because the
 * measurement that produced those numbers needs it and because a future rule
 * may use the pen as one signal among several rather than as a gate.
 */

/**
 * ── A STROKED GLYPH IS TWO PARALLEL LINES, AND THE PAIRER TAKES IT ──
 *
 * Reported from a real sheet by somebody looking at the drawing: two entire
 * groups were text. 64 runs at 14-1/2" sitting on dimension strings — `4'-0"`,
 * `10'-0"`, `12'-0"` — and 15 at 13-1/2" entirely on room-number tags (121, 133,
 * and an A106 marker), with not one wall among them. 79 of 205 runs.
 *
 * When a drawing's lettering is saved as line work rather than text, the two
 * sides of a `0` or a `1` are parallel, a few inches apart at drawing scale, and
 * the right length. Nothing about their SHAPE says they are letters. The pen
 * does not help either: a title is drawn heavy.
 *
 * What does say it is the text layer, which this app already extracts for every
 * sheet — `PlanTextItem` carries each item's box in the same coordinate space as
 * the strokes. A candidate sitting inside one is lettering.
 *
 * ── AND IT IS BOUNDED BY LENGTH, BECAUSE A ROOM TAG SITS ON A WALL ──
 *
 * A plan puts its labels ON the thing they label, so a long partition can easily
 * run under a room number. Dropping it would be worse than keeping the tag: a
 * missing wall is a short bid, while a wrong one is visible on the drawing and
 * gets rejected.
 *
 * So length decides. Lettering on a drawing is a foot or two of building at
 * plan scale; a wall is not. Above `LETTER_FEET` a candidate is kept wherever it
 * sits, which costs a few tag-sized false positives and cannot cost a wall.
 */
export const LETTER_FEET = 4;

/** Each text item's box, as this filter needs it. */
export type TextBox = { x: number; y: number; width: number; height: number };

export function wallsNotLettering(
  walls: readonly WallCandidate[],
  text: readonly TextBox[],
  feetPerPoint: number,
  letterFeet = LETTER_FEET,
): WallCandidate[] {
  if (text.length === 0) return [...walls];
  // THE PAD IS IN FEET, CONVERTED — not in whatever units the caller happens to
  // use. The first version wrote a bare `2`, which is 2 points to the server
  // reader and TWO PAGE WIDTHS to the viewer, where coordinates run 0..1. That
  // would have put every wall on the sheet inside a text box and filtered the
  // drawing away. The same unit mistake the CTM bug made with lengths.
  const padFeet = 0.5;
  const pad = feetPerPoint > 0 ? padFeet / feetPerPoint : 0;
  return walls.filter((wall) => {
    if (wall.lengthFeet > letterFeet) return true;
    const midX = (wall.x1 + wall.x2) / 2;
    const midY = (wall.y1 + wall.y2) / 2;
    const inside = text.some(
      (box) =>
        midX >= box.x - pad &&
        midX <= box.x + box.width + pad &&
        midY >= box.y - pad &&
        midY <= box.y + box.height + pad,
    );
    return !inside;
  });
}

/**
 * ── HOW MUCH OF THE SHEET A WALL MAY SPAN ──
 *
 * A click-through on a real permit set reported a group reading "10-1/2" · 1
 * run · 114 ft", and it was a single line down the LEFT SHEET BORDER. One
 * group, 114 feet, entirely false — and the most inviting thing in the panel,
 * because a 114ft run is the longest single thing on the sheet.
 *
 * The border is geometrically distinctive in one way that nothing inside the
 * building is: it runs the full extent of the PAGE. On that sheet the border
 * line measured about 95% of the page height. A building drawn at a sensible
 * scale leaves margins, a title block and a dimension zone, so its longest wall
 * cannot approach the paper's own dimension — the one measured there was 68% of
 * the sheet's width, and that is a long exterior wall on a tightly laid-out
 * sheet.
 *
 * 90% therefore sits in a gap rather than on a judgement call. It is compared
 * against the page extent ALONG THE RUN'S OWN AXIS, because a vertical border
 * on a landscape sheet is short against the width and nearly the whole height —
 * comparing against the wrong dimension is how this would miss.
 */
export const MOST_OF_THE_SHEET = 0.9;

/**
 * How close to the paper's edge counts as the border's own strip, as a fraction
 * of the SHORTER sheet dimension. Tight on purpose — see the reasoning inside
 * `wallsNotTheSheetBorder`, and do not widen it to reach a title block.
 */
export const ALONG_THE_EDGE = 0.04;

/**
 * How much of the sheet a run in that strip must cover before it is the frame
 * rather than a wall. A quarter: Augusta's border is four segments, so each is
 * roughly a sheet-side long, and a quarter leaves room for one broken into
 * halves without reaching down to ordinary partitions.
 */
export const BORDER_SEGMENT = 0.25;

/**
 * Walls that are not the sheet's own border.
 *
 * `pageHeight` is in the same units as the coordinates — the viewer's box has x
 * running 0..1 and y over that same width, so a landscape sheet's height is
 * LESS than 1. Passing the wrong one would compare a vertical run against the
 * width and let the border through, which is the mistake this is written to
 * avoid.
 */
export function wallsNotTheSheetBorder(
  walls: readonly WallCandidate[],
  pageWidth: number,
  pageHeight: number,
  mostOfTheSheet = MOST_OF_THE_SHEET,
): WallCandidate[] {
  if (!(pageWidth > 0) || !(pageHeight > 0)) return [...walls];

  // ── THE EDGE RULE NEEDS THE GEOMETRY TO BE INSIDE THE PAGE IT IS GIVEN ──
  //
  // "Along the bottom edge" is meaningless if the walls extend past the stated
  // page, and the failure mode is the worst kind: every run would read as
  // edge-hugging and the filter would return NOTHING, which on screen is
  // indistinguishable from a sheet with no walls on it rather than from a bug.
  // A caller handing over a stale or unresolved `pageSize` gets the span rule
  // alone instead of an empty panel.
  const fits = walls.every(
    (wall) =>
      Math.max(wall.x1, wall.x2) <= pageWidth * 1.01 && Math.max(wall.y1, wall.y2) <= pageHeight * 1.01,
  );
  // A FLAG, NOT A SENTINEL BAND. The first attempt used `band = -1` to mean
  // "off", which INVERTED the rule instead of disabling it: `pageHeight - (-1)`
  // is larger than the page, so every run read as hugging the bottom. A
  // negative distance is not a disabled distance.
  const band = Math.min(pageWidth, pageHeight) * ALONG_THE_EDGE;
  return walls.filter((wall) => {
    const dx = Math.abs(wall.x2 - wall.x1);
    const dy = Math.abs(wall.y2 - wall.y1);

    // ── A SEGMENTED BORDER, WHICH THE SPAN RULE BELOW CANNOT SEE ──
    //
    // This filter was written for a border drawn as one full-width line, and a
    // browser run on Augusta A1.11 (2026-10-10) found one that is not: an
    // architectural border is four runs INSET from the paper that stop short of
    // the corners, plus the title-block frame just inside it. Each piece is well
    // under `mostOfTheSheet`, so every one of them passed — the panel offered a
    // "6-inch, 237 ft" group that was the drawing frame, and the group's own
    // total looked plausible, which is what makes it dangerous.
    //
    // THE SECOND RULE IS THE *AND* OF LENGTH AND POSITION, deliberately, and
    // mutation says why neither half is safe alone. Length alone is the rule
    // below, and it drops a real exterior wall on a sheet scaled to its
    // building. Position alone drops the outermost partitions of any plan drawn
    // close to the frame.
    //
    // The band is TIGHT (4%) because nothing of the building is in it: the
    // border itself occupies that strip, and the plan is inside the border. That
    // is also why the band must not be widened — a band wide enough to cover a
    // title block is the corner guess this module has no measurement for, and
    // `borderSegments` pins it.
    const alongTop = Math.min(wall.y1, wall.y2) <= band;
    const alongBottom = Math.max(wall.y1, wall.y2) >= pageHeight - band;
    const alongLeft = Math.min(wall.x1, wall.x2) <= band;
    const alongRight = Math.max(wall.x1, wall.x2) >= pageWidth - band;
    if (fits && dx > dy && (alongTop || alongBottom) && dx >= pageWidth * BORDER_SEGMENT) return false;
    if (fits && dy > dx && (alongLeft || alongRight) && dy >= pageHeight * BORDER_SEGMENT) return false;
    // The page's extent along whichever axis this run mostly follows.
    const extent = dx >= dy ? pageWidth : pageHeight;
    const span = Math.max(dx, dy);
    return span < extent * mostOfTheSheet;
  });
}

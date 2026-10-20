import type { StrokeSegment } from "./wallVectors";

/**
 * ── AN ACCEPTED CANDIDATE THAT IS NOT ON THE WALL ──
 *
 * Reported from the ELEVEN03 labelling runs: a candidate drawn along a real
 * wall FACE, but paired with a closet shelf or a shelf-end line instead of the
 * wall's other face. The run is in the right place to within a few inches, its
 * length is right, and its CENTRELINE is off — so the footage is roughly
 * correct while the wall it describes does not exist. The same shape appears
 * when a double wall's two layers are each paired separately and only one
 * layer is accepted.
 *
 * It cannot be seen in the panel, which shows a length and a thickness, and
 * both look ordinary. It cannot be seen on the plan at normal zoom either: six
 * inches at 1/8" is a thirty-second of an inch of paper.
 *
 * ── WHAT SEPARATES A WALL PAIR FROM A WALL-AND-SHELF PAIR ──
 *
 * Not the gap: a shelf sits a plausible wall-thickness from the wall it is
 * fixed to, which is exactly why the pairing was made. What separates them is
 * that **a wall's two faces are both as long as the wall**, and a shelf line
 * is not. A shelf-end line is shorter still.
 *
 * So this measures, for each accepted run, how far its centreline sits from
 * the centreline of the best FULL-LENGTH face pair near it. A run sitting on
 * one face of a real pair comes out at half the wall's thickness — two to six
 * inches — and a run paired with something that is not a wall comes out
 * further, because the partner it used is not where the real second face is.
 *
 * ── WHY THE THRESHOLD IS A JUDGEMENT AND SAYS SO ──
 *
 * Diego's number is "more than about 6 inches off". That is deliberately
 * larger than half of any partition in these sets, so a run that is merely
 * half a wall thick off its own pair's centre is not flagged. It is reported
 * as a RANKED LIST with the measured offset beside each, never as a verdict:
 * nothing here can tell a shelf from a furring layer, and the estimator can.
 */

/** How far off, in inches, before a run is worth a second look. */
export const OFFSET_INCHES = 6;

/** How much of the run a face has to span to count as that run's face. */
const FACE_COVERAGE = 0.7;

/** Parallel to within this, as |sin| of the angle between them. */
const PARALLEL = 0.035;

/** The widest gap between two faces that could be one wall, in feet. */
const WIDEST_WALL_FEET = 14 / 12;

/** The narrowest, in feet — thinner than this is a drawn line pair, not a wall. */
const NARROWEST_WALL_FEET = 2 / 12;

/**
 * How far either side of a run to look for its faces, in feet.
 *
 * ── THIS BOUND IS THE WHOLE FUNCTION, AND LEAVING IT OUT PRODUCED NUMBERS ──
 *
 * Without it the search considers every stroke on the sheet that is parallel
 * to the run and overlaps its span — which on a floor plan is the opposite
 * side of the building. The first run reported offsets of **2,359 inches**
 * (196 feet) and flagged a third of every sheet, with a thousand "faces" per
 * run. Every one of those pairs was real: two parallel lines eight inches
 * apart, both spanning the run, two hundred feet away.
 *
 * Eighteen inches is chosen against the defect rather than the geometry: a
 * run sitting on one face of its own wall is half a thickness out (two to six
 * inches), and a run paired with a shelf instead of the far face is out by
 * the difference between the shelf and the wall — inches, not feet. Anything
 * beyond a foot and a half is a different wall, and saying so about it is not
 * a finding.
 */
const NEARBY_FEET = 1.5;

/**
 * ── WHAT THE RUN'S OWN TWO FACES LOOK LIKE ──
 *
 * The defect is a run paired with a shelf instead of the wall's far face, and
 * its signature is in the run's OWN pair: one face runs the length of the wall
 * and the other stops where the shelf stops.
 *
 * `offsetCandidates` went looking for a BETTER pair nearby instead, and three
 * sheets of output say that was the wrong question. Checked against the
 * labelled sheets:
 *
 *   - not one of its 62 findings has an offset of half the chosen pair's
 *     thickness, which is what "the run sits ON a face of the real wall"
 *     measures as — the shelf story leaves no trace in its own output;
 *   - 18 of 62 have an offset of one whole pair-thickness, which is a
 *     NEIGHBOURING parallel wall;
 *   - none of the chosen pairs is a wall the labeller accepted anywhere else.
 *
 * So it reports "there is other parallel geometry near this run", which is
 * true of most walls in a dense residential plan — furring, chases, finishes,
 * the next unit — and is not the defect.
 *
 * This asks the direct question instead, and needs no search: take the two
 * faces the run was BUILT from, at plus and minus half its own thickness, and
 * compare how far each one runs.
 */
export type OwnFaces = {
  /** The longer face's extent, in feet. */
  longFeet: number;
  /** The shorter face's extent, in feet. */
  shortFeet: number;
  /**
   * shortFeet / the RUN's own length. A wall is at or above 1; a shelf pairing
   * is below it.
   *
   * ── MEASURED AGAINST THE RUN, NOT AGAINST THE OTHER FACE ──
   *
   * The first version compared the two faces to each other, and flagged 49 of
   * 128 accepted runs on one sheet. Reading them says why: a short wall butting
   * into a long one has a 5 ft face and a 175 ft face — the building's whole
   * width — and a ratio of 0.03, while covering its own run perfectly. That is
   * an ordinary wall, not a defect.
   *
   * The question that separates a wall from a shelf is whether the face spans
   * THE RUN. Both faces of a wall do, by construction. A shelf stops where the
   * shelf stops.
   */
  ratio: number;
};

export type Run = {
  id?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet?: number;
};

export type OffsetFinding = {
  run: Run;
  /** How far the run's centreline is from the best face pair's, in inches. */
  offsetInches: number;
  /** The gap between the two faces of that pair, in inches. */
  pairThicknessInches: number;
  /** How much of the run each face of the pair covers, 0..1. */
  coverage: [number, number];
  /** Faces found parallel to the run at all — the denominator of the search. */
  facesNearby: number;
  /**
   * The two faces of the chosen pair, as signed perpendicular offsets from the
   * run, in page-width units.
   *
   * Returned so a reviewer can be SHOWN the claim rather than told it: a crop
   * with these two drawn over the sheet answers "is that pair the wall?" in a
   * second, and that is the one question this function cannot answer itself.
   */
  pairFaces: [number, number];
  /**
   * How long the shorter face of the chosen pair is, in feet.
   *
   * ── THE NUMBER THAT SAYS WHETHER THE PAIR IS A WALL OR A GRID LINE ──
   *
   * Pairs are ranked by this, so the longest wins — and the longest parallel
   * lines on a floor plan are the GRID and column lines, which run past the
   * building at both ends and are drawn in pairs. Two crops reviewed by eye
   * both showed the chosen pair spanning the whole crop, and 23 of 62 findings
   * chose a pair under five inches apart, with `(4.1in apart, 8.1in off)`
   * repeating five times — one long thin pair winning over and over.
   *
   * Whether those are grid lines or genuine long demising walls is a question
   * about the drawing, which this cannot answer and a reviewer can. So the
   * number is reported rather than acted on: a face thirty times the length of
   * the run it is supposed to belong to is the thing to be suspicious of.
   */
  pairFaceFeet: number;
};

type Band = {
  /** Signed perpendicular distance from the run's line, in page-width units. */
  offset: number;
  /** Fraction of the RUN this band spans, 0..1. */
  coverage: number;
  /** How long the band is in total, in feet, INCLUDING beyond the run's ends. */
  extentFeet: number;
};

/** Two offsets this close are the same drawn line, in inches. */
const SAME_LINE_INCHES = 0.75;

/**
 * The parallel lines near a run, collected into bands by offset.
 *
 * Banded rather than listed because a wall face is rarely one segment: it is
 * broken at every door, jamb and intersection, and a face read as twenty
 * fragments would look shorter than the shelf beside it. Each band keeps the
 * UNCLAMPED span of its pieces along the run's axis, so a face that carries on
 * past the run's ends is measured as the long thing it is.
 */
function bandsAlong(run: Run, segments: readonly StrokeSegment[], feetPerUnit: number): Band[] {
  const dx = run.x2 - run.x1;
  const dy = run.y2 - run.y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return [];
  const ux = dx / len;
  const uy = dy / len;

  const raw: { offset: number; lo: number; hi: number }[] = [];
  for (const seg of segments) {
    const sx = seg.x2 - seg.x1;
    const sy = seg.y2 - seg.y1;
    const slen = Math.hypot(sx, sy);
    if (!(slen > 0)) continue;
    // |cross| of the unit vectors is |sin| of the angle between them.
    if (Math.abs((sx / slen) * uy - (sy / slen) * ux) > PARALLEL) continue;
    const t1 = ((seg.x1 - run.x1) * ux + (seg.y1 - run.y1) * uy) / len;
    const t2 = ((seg.x2 - run.x1) * ux + (seg.y2 - run.y1) * uy) / len;
    const n1 = -(seg.x1 - run.x1) * uy + (seg.y1 - run.y1) * ux;
    const n2 = -(seg.x2 - run.x1) * uy + (seg.y2 - run.y1) * ux;
    const offset = (n1 + n2) / 2;
    if (Math.abs(offset) * feetPerUnit > NEARBY_FEET) continue;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    // Something that only reaches the run sideways is not along it.
    if (hi < -1 || lo > 2) continue;
    raw.push({ offset, lo, hi });
  }

  const tolerance = SAME_LINE_INCHES / 12 / feetPerUnit;
  raw.sort((a, b) => a.offset - b.offset);
  const bands: Band[] = [];
  let group: typeof raw = [];
  const flush = () => {
    if (group.length === 0) return;
    const offset = group.reduce((n, g) => n + g.offset, 0) / group.length;
    // Union of the pieces along the axis, so an overlap is not counted twice.
    const spans = [...group].sort((a, b) => a.lo - b.lo);
    let covered = 0;
    let lo = spans[0].lo;
    let hi = spans[0].hi;
    let extentLo = lo;
    let extentHi = hi;
    const add = () => {
      covered += Math.max(0, Math.min(1, hi) - Math.max(0, lo));
    };
    for (const span of spans.slice(1)) {
      extentLo = Math.min(extentLo, span.lo);
      extentHi = Math.max(extentHi, span.hi);
      if (span.lo > hi) {
        add();
        lo = span.lo;
        hi = span.hi;
      } else {
        hi = Math.max(hi, span.hi);
      }
    }
    add();
    bands.push({
      offset,
      coverage: covered,
      extentFeet: (extentHi - extentLo) * run.lengthFeet,
    });
    group = [];
  };
  for (const one of raw) {
    if (group.length > 0 && one.offset - group[group.length - 1].offset > tolerance) flush();
    group.push(one);
  }
  flush();
  return bands;
}

export function offsetCandidates(input: {
  runs: readonly Run[];
  /**
   * The sheet's strokes **in the same units as the runs** — page-width, x/widthPt.
   *
   * `sheetStrokes` returns POINTS, and `findWallsOnSheet` normalises them
   * internally, so a caller holding both has two different coordinate systems
   * in hand. Passing points here finds no faces at all and every run comes
   * back clean, which is indistinguishable from a tidy sheet. The first run of
   * this function did exactly that on three sheets.
   */
  segments: readonly StrokeSegment[];
  feetPerUnit: number;
  minInches?: number;
}): OffsetFinding[] {
  const { runs, segments, feetPerUnit } = input;
  const min = input.minInches ?? OFFSET_INCHES;
  if (!(feetPerUnit > 0)) return [];
  const found: OffsetFinding[] = [];

  for (const run of runs) {
    const bands = bandsAlong(run, segments, feetPerUnit);
    const full = bands.filter((b) => b.coverage >= FACE_COVERAGE);
    // ── THE MOST WALL-LIKE PAIR, NOT THE NEAREST ──
    //
    // Nearest cannot work, and a fixture proved it before this shipped: the
    // run's OWN pair — the wall face and the shelf it was wrongly paired with
    // — is a full-length pair at a plausible gap sitting exactly on the run's
    // centreline. So "nearest pair" returns the mistake itself, offset zero,
    // for a correct run and a wrong one alike.
    //
    // What separates them is the one thing the header of this file names: a
    // wall's two faces both run the LENGTH of the wall, and a shelf does not.
    // So pairs are ranked by the shorter of their two faces, and the winner is
    // the pair whose weaker member is still long. A wall-and-shelf pair is
    // beaten by the wall's own two faces whenever both are drawn.
    let best: {
      centre: number;
      gap: number;
      cov: [number, number];
      weakest: number;
      faces: [number, number];
    } | null = null;
    for (let i = 0; i < full.length; i += 1) {
      for (let j = i + 1; j < full.length; j += 1) {
        const gapFeet = Math.abs(full[i].offset - full[j].offset) * feetPerUnit;
        if (gapFeet < NARROWEST_WALL_FEET || gapFeet > WIDEST_WALL_FEET) continue;
        const centre = (full[i].offset + full[j].offset) / 2;
        const weakest = Math.min(full[i].extentFeet, full[j].extentFeet);
        const better =
          best === null ||
          weakest > best.weakest + 0.01 ||
          // A tie on length goes to the pair this run actually sits in, which
          // keeps a correct run reported as correct.
          (Math.abs(weakest - best.weakest) <= 0.01 && Math.abs(centre) < Math.abs(best.centre));
        if (better) {
          best = {
            centre,
            gap: gapFeet,
            cov: [full[i].coverage, full[j].coverage],
            weakest,
            faces: [full[i].offset, full[j].offset],
          };
        }
      }
    }
    if (best === null) continue;
    const offsetInches = Math.abs(best.centre) * feetPerUnit * 12;
    if (offsetInches < min) continue;
    found.push({
      run,
      offsetInches,
      pairThicknessInches: best.gap * 12,
      coverage: best.cov,
      facesNearby: bands.length,
      pairFaces: best.faces,
      pairFaceFeet: best.weakest,
    });
  }
  return found.sort((a, b) => b.offsetInches - a.offsetInches);
}

/**
 * How lopsided each run's own face pair is.
 *
 * A wall's two faces are both as long as the wall, so the ratio is near 1. A
 * run paired with a shelf, a shelf end or a counter edge has one long face and
 * one short one, and the ratio falls away from 1 — which is the defect, stated
 * as a measurement rather than as a search.
 *
 * Returns one entry per run that HAS both faces findable, worst ratio first. A
 * run whose faces cannot be found is left out rather than reported as perfect:
 * it is the same silence-is-not-success trap the offset search fell into, and
 * the count of runs examined is returned beside the findings so a caller can
 * tell an empty list from an empty question.
 */
export function lopsidedPairs(input: {
  runs: readonly Run[];
  segments: readonly StrokeSegment[];
  feetPerUnit: number;
  /**
   * Report runs whose shorter face covers at or below this share of the run.
   * The default allows a face to fall a tenth short of its own wall, which
   * absorbs the gap a door or an intersection leaves in a face.
   */
  maxRatio?: number;
}): { findings: { run: Run; faces: OwnFaces }[]; examined: number } {
  const { runs, segments, feetPerUnit } = input;
  const maxRatio = input.maxRatio ?? 0.9;
  if (!(feetPerUnit > 0)) return { findings: [], examined: 0 };
  const findings: { run: Run; faces: OwnFaces }[] = [];
  let examined = 0;

  for (const run of runs) {
    const halfThick = (run.thicknessFeet ?? 0) / 2 / feetPerUnit;
    if (!(halfThick > 0)) continue;
    const bands = bandsAlong(run, segments, feetPerUnit);
    // The two bands nearest to where the run's own faces must be. Tolerance is
    // generous because the pairing that produced the run already decided these
    // two lines are a wall's width apart.
    const tolerance = Math.max(halfThick * 0.35, (1 / 12 / feetPerUnit) * 1.5);
    const near = (want: number) =>
      bands
        .filter((b) => Math.abs(b.offset - want) <= tolerance)
        .sort((a, b) => b.extentFeet - a.extentFeet)[0];
    const a = near(-halfThick);
    const b = near(halfThick);
    if (a === undefined || b === undefined) continue;
    examined += 1;
    const longFeet = Math.max(a.extentFeet, b.extentFeet);
    const shortFeet = Math.min(a.extentFeet, b.extentFeet);
    if (!(longFeet > 0)) continue;
    const ratio = run.lengthFeet > 0 ? shortFeet / run.lengthFeet : 1;
    if (ratio > maxRatio) continue;
    findings.push({ run, faces: { longFeet, shortFeet, ratio } });
  }
  findings.sort((x, y) => x.faces.ratio - y.faces.ratio);
  return { findings, examined };
}

/**
 * How well a run is supported by the lines actually drawn for it.
 *
 * ── THE NUMBER THAT PICKS THE RIGHT TWIN ──
 *
 * When the finder offers the same wall twice, one of the two usually sits ON
 * the wall and the other sits beside it — paired with a glass line, a shelf or
 * a furring layer nine inches away. Reported from E Street 421 A2.1: the
 * duplicate pre-marking auto-rejected the one on the wall twice, at the
 * conference room's east wall and the entry's west glass wall, because the
 * rule kept the LONGER of the two and the offset twin happened to be longer.
 *
 * Length cannot tell them apart and neither can thickness on its own. What
 * can is whether the run's OWN two faces are drawn for its whole length: a
 * wall has two faces and both run the length of it, so a candidate sitting on
 * one reads 1, and a candidate pairing a wall face with something else reads
 * low on the side that is not a wall.
 *
 * Returns 0 when the faces cannot be found at all, which is the same answer as
 * "nothing supports this" — the caller treats an unmeasurable run as no better
 * than its twin rather than as worse, because an unreadable sheet must not
 * silently invert the rule.
 */
export function wallSupport(input: {
  run: Run;
  segments: readonly StrokeSegment[];
  feetPerUnit: number;
}): { support: number; longFeet: number; shortFeet: number } {
  const { run, segments, feetPerUnit } = input;
  const halfThick = (run.thicknessFeet ?? 0) / 2 / feetPerUnit;
  if (!(halfThick > 0) || !(feetPerUnit > 0) || !(run.lengthFeet > 0)) {
    return { support: 0, longFeet: 0, shortFeet: 0 };
  }
  const bands = bandsAlong(run, segments, feetPerUnit);
  const tolerance = Math.max(halfThick * 0.35, (1 / 12 / feetPerUnit) * 1.5);
  const near = (want: number) =>
    bands
      .filter((b) => Math.abs(b.offset - want) <= tolerance)
      .sort((a, b) => b.extentFeet - a.extentFeet)[0];
  const a = near(-halfThick);
  const b = near(halfThick);
  if (a === undefined || b === undefined) return { support: 0, longFeet: 0, shortFeet: 0 };
  const longFeet = Math.max(a.extentFeet, b.extentFeet);
  const shortFeet = Math.min(a.extentFeet, b.extentFeet);
  // Against the RUN, not against the other face: a short wall butting into a
  // long one has a 5 ft face and a 175 ft face and is perfectly ordinary.
  return {
    support: Math.min(1, shortFeet / run.lengthFeet),
    longFeet,
    shortFeet,
  };
}

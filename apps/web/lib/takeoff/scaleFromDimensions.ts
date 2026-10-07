import type { StrokeSegment } from "./wallVectors";

/**
 * THE DRAWING SETS ITS OWN SCALE, because the architect already wrote the answer
 * on it.
 *
 * ── WHAT THIS IS, AND WHY IT IS NOT THE THING THE REPO DECLINED ──
 *
 * `CHANGELOG.md` records a deliberate absence: *"nothing prefills the typed
 * distance, because the printed scale implies a factor and not a dimension"*,
 * and #623: *"a calibration is the line somebody drew — `TakeoffScaleCalibration`
 * stores that line and deliberately never a factor, so the printed scale cannot
 * become one without inventing a second calibration mechanism with different
 * evidence behind it."*
 *
 * Both are still true and neither covers this. They are about the scale NAME in
 * the title block, which yields a factor and needs `pageWidthPt` — a column
 * whose own comment calls it "A LABEL INPUT AND NOTHING ELSE".
 *
 * A printed DIMENSION is a different animal. `11' - 0"` sitting on a dimension
 * line is **a line and a distance**, which is exactly the two facts
 * `TakeoffScaleCalibration` stores and exactly what a person supplies by
 * clicking twice and typing. So this proposes the same evidence by the same
 * route, found rather than typed: `TakeoffScaleCalibration` is UNCHANGED, no
 * factor is stored anywhere, and nothing here depends on `pageWidthPt` except
 * to convert points to paper inches, which is what that column is for.
 *
 * If a later version of this file ever returns a bare factor, it has become the
 * thing those entries declined.
 *
 * ── WHY THIS CAN BE ACCURATE: THE ANSWER IS DISCRETE ──
 *
 * A scale error is multiplicative — 1% off puts every wall and the whole bid 1%
 * off — so "close enough" is not a standard worth having. What rescues it is
 * that drawings are printed at a SHORT LIST of scales, so the output is a vote
 * over a fixed set rather than a free number, and a modest measurement error
 * lands on the same answer instead of a nearby wrong one.
 *
 * Measured over the architectural scales: the tightest neighbouring pair is
 * 1.333x apart, so picking the wrong one needs a **15.5% error**. A real CAD
 * export was off by **0.1%**.
 *
 * ── AND WHY THE ENGINEERING SCALES ARE EXCLUDED, WHICH IS LOAD-BEARING ──
 *
 * `STANDARD_SCALES` in `takeoff-plan.ts` holds 19 entries — the architectural
 * twelve plus seven civil ones. Across all nineteen the tightest gap collapses
 * to **3.3%**: `1" = 10'` and `3/32" = 1'-0"` are 1.0667x apart. A 4% error
 * would then pick the wrong scale CONFIDENTLY, which is the one outcome this
 * module exists to prevent.
 *
 * So the vote runs over the architectural twelve only. That is a statement about
 * this product rather than a convenience: Prova is for specialty trades —
 * framing, drywall, plaster, EIFS, ceilings, fireproofing — and they take off
 * ARCHITECTURAL sheets. A drywall estimator is never measuring a partition at
 * 1" = 50'; that is a site plan, and nobody takes drywall off one.
 *
 * A reading that also lands near an engineering scale is DECLINED rather than
 * resolved, because at that point the sheet is probably not the kind of sheet
 * this is for.
 */

/**
 * The architectural scales, as feet of building per inch of paper.
 *
 * Deliberately a SECOND list rather than a filter over `takeoff-plan.ts`'s
 * `STANDARD_SCALES`, and `scaleFromDimensions.test.ts` holds the two in step —
 * every name here must exist there, and every architectural name there must
 * exist here. CLAUDE.md's rule is that a canonical list needs both guards: one
 * that it is complete, one that it is the only one. This is the case where a
 * genuine second list is correct, so the census says so out loud instead of a
 * later reader finding an unexplained copy.
 */
export const ARCHITECTURAL_SCALES: { feetPerInch: number; name: string }[] = [
  { feetPerInch: 32, name: '1/32" = 1\'-0"' },
  { feetPerInch: 16, name: '1/16" = 1\'-0"' },
  { feetPerInch: 32 / 3, name: '3/32" = 1\'-0"' },
  { feetPerInch: 8, name: '1/8" = 1\'-0"' },
  { feetPerInch: 16 / 3, name: '3/16" = 1\'-0"' },
  { feetPerInch: 4, name: '1/4" = 1\'-0"' },
  { feetPerInch: 8 / 3, name: '3/8" = 1\'-0"' },
  { feetPerInch: 2, name: '1/2" = 1\'-0"' },
  { feetPerInch: 4 / 3, name: '3/4" = 1\'-0"' },
  { feetPerInch: 1, name: '1" = 1\'-0"' },
  { feetPerInch: 2 / 3, name: '1-1/2" = 1\'-0"' },
  { feetPerInch: 1 / 3, name: '3" = 1\'-0"' },
];

/** The civil scales, held here ONLY so a reading landing near one can be
 *  declined as the wrong kind of sheet. Never voted on. */
export const ENGINEERING_SCALES: number[] = [10, 20, 30, 40, 50, 60, 100];

/**
 * How close a measured reading must sit to a standard scale to count as it.
 *
 * `takeoff-plan.ts` uses 2% for a reading off two human clicks. This is the same
 * number for a different reason: these endpoints are exact, so 2% is not slack
 * for the measurement — it absorbs the dimension string being rounded on the
 * drawing. A plan prints `11' - 0"` for a wall the model holds at 10.97 ft.
 */
const SCALE_TOLERANCE = 0.02;

/**
 * Within this of the winning scale counts as "accurate enough to prefer the
 * longer line". A quarter of `SCALE_TOLERANCE`: tight enough that a sloppy pair
 * never wins on length alone, loose enough that the rounding in a printed
 * figure — `11' - 0"` for 10.97 ft is 0.3% — does not disqualify a good one.
 */
const BEST_PAIR_TOLERANCE = SCALE_TOLERANCE / 4;

/**
 * A printed dimension found on the sheet: what it says, and where it says it.
 *
 * Positions are in page POINTS, top-left origin — the space both
 * `planPdf.ts`'s `PlanTextItem` and `sheetStrokes.ts`'s `StrokeSegment` already
 * report, which is the only reason these two layers can be compared at all.
 */
export type DimensionLabel = {
  /** As printed — `11' - 0"`. Shown back to the estimator as evidence. */
  text: string;
  /** What it parses to, in feet. */
  feet: number;
  x: number;
  y: number;
};

/**
 * THE MOST ERROR THE AUTOMATIC PATH WILL CARRY INTO A STORED CALIBRATION, and
 * what it is measured against.
 *
 * This is what replaces a span floor here, and the reasoning is the reason it
 * can. `takeoff-plan.ts` refuses a human's calibration line below a twentieth
 * of the page because *"the error in a scale is the error in the two clicks
 * divided by the length between them"* — a TWO-PIXEL SLIP, which it measures at
 * ±3% at that floor. An automatic pair has no slip at all: its endpoints are
 * the vector line's own, exact to the file.
 *
 * So it is held to the error it ACTUALLY carries, which is knowable without
 * knowing the right answer: once the vote has named a standard scale, the
 * stored pair's own deviation FROM that scale is the error every later
 * measurement inherits. On the real export the proposed pair read 7.9748 ft/in
 * against 1/8"'s 8.0000 — **0.315%**, about a tenth of what the human floor
 * permits.
 *
 * A FIRST VERSION REPORTED THE WRONG NUMBER HERE and it is worth saying why.
 * It derived a theoretical bound from how precisely the figure was printed —
 * `16' - 4 1/2"` is written to the half inch, so ±1/4" on 16.375 ft is 0.127%
 * — and reported that. The pair's real deviation was 0.315%, nearly three times
 * worse, because a printed figure's rounding is not the only thing between a
 * dimension string and the line under it. An error band that understates itself
 * is worse than no error band, since it is the number somebody would rely on.
 * Measured beats derived.
 *
 * 0.5% of a 3,000 ft takeoff is 15 ft.
 */
const MAX_INHERITED_ERROR = 0.005;

/**
 * ENOUGH LINE WORK THAT A SHEET IS PLAINLY A DRAWING, so "no dimensions found"
 * can be told from "nothing on this page".
 *
 * Measured on three real exports: 167,911 segments on an ARCH E1 floor plan,
 * 79,001 on an ARCH D one, 23,351 on an enlarged plan. A cover sheet or a
 * schedule page is orders of magnitude below that. 2,000 sits under every real
 * plan and above anything that is not one.
 */
const PLAINLY_A_DRAWING = 2000;

export type ScaleCandidate = {
  /** The dimension line, in page POINTS. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** What the drawing says that line is. */
  declaredFeet: number;
  /** The label it came from, for the evidence sentence. */
  text: string;
  /** Feet of building per inch of paper this pair implies. */
  feetPerInch: number;
};

export type ScaleVerdict =
  | {
      ok: true;
      /** The winning scale's name, from `ARCHITECTURAL_SCALES`. */
      scaleName: string;
      feetPerInch: number;
      /** The pair to propose as the calibration — a real line, a real printed
       *  distance. Page points; the caller normalises. */
      best: ScaleCandidate;
      /** Every dimension that agreed, as printed. The evidence sentence. */
      agreed: string[];
      /** How many distinct dimension labels were considered at all. */
      considered: number;
      /** How far the stored pair sits from the scale the sheet voted for, as
       *  a fraction — 0.003 is three thousandths. This is the error every later
       *  measurement inherits, and it is shown to the estimator: a scale nobody
       *  can put a band on is one taken on faith. */
      inheritedError: number;
    }
  | {
      ok: false;
      /** Why, in words an estimator can act on. FALSE IS A FACT, NOT A FAILURE. */
      reason: string;
      considered: number;
    };

/**
 * HOW A LABEL IS RECOGNISED AS BELONGING TO A LINE, and the first version of
 * this got it backwards in a way that only a real sheet could show.
 *
 * It allowed a segment a radius proportional to ITS OWN LENGTH — so on a real
 * drawing every long wall face passing near a label collected a vote, and a
 * line four times too long "explains" the same printed figure at a scale four
 * times finer. Measured on the real export: 30 labels produced **5,698**
 * candidate pairings, and the vote split between 1/8" and 1/2" — a decline,
 * from evidence that was mostly noise.
 *
 * The real relationship is tight and worth stating as geometry: **a dimension
 * string sits CENTRED on the line it measures, just off to one side.** So a
 * pairing needs both
 *
 *   - the label within `LABEL_OFFSET_PT` of the line, measured perpendicular —
 *     an absolute distance, because lettering is a fixed size on paper whatever
 *     the drawing's scale; and
 *   - the label's position along the line within `LABEL_CENTRING` of its
 *     midpoint, as a fraction of its length.
 *
 * The second is what a long wall face cannot satisfy: it may pass under a
 * label, but the label lands at an arbitrary point along it rather than at its
 * centre.
 */
const LABEL_OFFSET_PT = 30;
const LABEL_CENTRING = 0.3;

/**
 * ── A BROKEN DIMENSION LINE: THE RIGHT MECHANISM, AND PAIRING ACROSS IT MADE
 * THINGS WORSE. MEASURED, TWICE. DO NOT REBUILD IT WITHOUT READING THIS. ──
 *
 * CAD does not draw a dimension line THROUGH its own numerals. It breaks it:
 *
 *     |————————  113'-0"  ————————|
 *
 * So the label sits at the INNER END of each half and never near either half's
 * middle, which the centring rule above rejects. That is a real description of
 * a real convention, and page 47 of a real 76-page bid set proves the halves are
 * all there is: a `113'-0"` dimension needs a 1017pt line at that sheet's stated
 * 1/8", **no segment on the page is 1017pt, and the longest anything on it is
 * 894pt.**
 *
 * It followed that rejoining the halves would rescue the 16 sheets of that set
 * which print a scale this finds nothing for. IT DID NOT. Both attempts went
 * BACKWARDS against the 9 sheets the centring rule alone reads:
 *
 *   | pairing                                    | sheets read |
 *   | ------------------------------------------ | ----------- |
 *   | centring only — what ships                 | **9**       |
 *   | + rejoin halves across the gap             | 3           |
 *   | + require the gap to match the lettering   | 7           |
 *
 * The extra candidates scatter the vote until no scale wins its margin, so the
 * cost falls on sheets that WORKED. The margin rule is doing its job — it
 * declines rather than guessing — and the honest reading is that the broken-line
 * halves do not carry enough signal to name a scale, not that one more
 * constraint would have found it. Requiring the gap to match the label's own
 * width is the tightest constraint the geometry offers and it recovered two of
 * the six lost sheets, nothing more.
 *
 * So the 16 remain unexplained by this. What is now KNOWN is that they are not
 * fixed here, which is worth more than the two days somebody would otherwise
 * spend rediscovering it. `DimensionLabel` deliberately no longer carries the
 * lettering width that attempt needed.
 */

/** The shortest segment worth considering, in points. Below this the rounding in
 *  a printed dimension dominates whatever it would imply. */
const MIN_SEGMENT_PT = 8;

const lengthOf = (s: StrokeSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** The nearest standard architectural scale, or null if the reading is not
 *  within tolerance of any. */
function snap(feetPerInch: number): { feetPerInch: number; name: string } | null {
  for (const scale of ARCHITECTURAL_SCALES) {
    if (Math.abs(feetPerInch - scale.feetPerInch) / scale.feetPerInch <= SCALE_TOLERANCE) return scale;
  }
  return null;
}

function nearEngineeringScale(feetPerInch: number): boolean {
  return ENGINEERING_SCALES.some((f) => Math.abs(feetPerInch - f) / f <= SCALE_TOLERANCE);
}

/**
 * Every (label, segment) pairing worth a vote.
 *
 * NOT one segment per label, and that is the whole design. A first version of
 * this picked each label's single best-fitting nearby segment, and on a real
 * sheet it matched `4' - 6"` to a 4.00 ft line — a wrong answer arrived at
 * confidently. Letting every plausible pairing vote means a mis-pairing is one
 * stray vote against a dozen agreeing ones, which is what actually happened:
 * 12 of 13 labels agreed and the outlier was outvoted rather than trusted.
 */
export function scaleCandidates(
  labels: readonly DimensionLabel[],
  segments: readonly StrokeSegment[],
): ScaleCandidate[] {
  const out: ScaleCandidate[] = [];
  for (const label of labels) {
    if (!(label.feet > 0)) continue;
    for (const segment of segments) {
      const lenPt = lengthOf(segment);
      if (lenPt < MIN_SEGMENT_PT) continue;
      // Perpendicular distance from the label to the line, and how far along
      // the line it falls. Both are needed; see `LABEL_OFFSET_PT`.
      const ux = (segment.x2 - segment.x1) / lenPt;
      const uy = (segment.y2 - segment.y1) / lenPt;
      const dx = label.x - segment.x1;
      const dy = label.y - segment.y1;
      const along = dx * ux + dy * uy;
      const across = Math.abs(dx * uy - dy * ux);
      if (across > LABEL_OFFSET_PT) continue;
      if (Math.abs(along - lenPt / 2) > lenPt * LABEL_CENTRING) continue;
      out.push({
        x1: segment.x1,
        y1: segment.y1,
        x2: segment.x2,
        y2: segment.y2,
        declaredFeet: label.feet,
        text: label.text,
        // Feet per inch of paper: the pair's own reading, 72 points to the inch.
        feetPerInch: label.feet / (lenPt / 72),
      });
    }
  }
  return out;
}

export type ScaleOptions = {
  /**
   * The fewest DISTINCT dimension labels that must agree before a scale is
   * proposed.
   *
   * Not a taste: `scaleFromDimensions.test.ts` mutates this down to 1 and the
   * suite reds, because one label and one segment agree with each other by
   * construction and prove nothing. Three is the smallest number at which a
   * single mis-pairing cannot carry the vote.
   */
  minAgreeing?: number;
  /**
   * How far ahead of the runner-up the winner must be, as a multiple of the
   * runner-up's support. Below this the sheet is ambiguous and is declined —
   * which is also how a genuinely two-scale sheet comes out, a 1/8" plan with a
   * 1-1/2" detail on it being ordinary drafting rather than a fault.
   */
  minMargin?: number;
};

const DEFAULTS = { minAgreeing: 3, minMargin: 2 };

/**
 * The scale this sheet is drawn at, or a reason it cannot be told.
 *
 * Counts DISTINCT LABELS rather than candidate pairs, deliberately: one label
 * sitting in a dense corner can generate twenty pairings, and a vote weighted
 * by pairings would let that one label — including one wrong reading of it —
 * outvote the rest of the sheet.
 */
export function scaleFromDimensions(
  labels: readonly DimensionLabel[],
  segments: readonly StrokeSegment[],
  options: ScaleOptions = {},
): ScaleVerdict {
  const minAgreeing = options.minAgreeing ?? DEFAULTS.minAgreeing;
  const minMargin = options.minMargin ?? DEFAULTS.minMargin;
  const considered = labels.length;

  // ── A SHEET WHOSE LETTERING WAS SAVED AS LINE WORK ──
  //
  // Found on the second real export this was ever pointed at, and it is a hard
  // limit rather than a defect: that sheet carries 79,001 stroked segments and
  // **85 text items, every one of them title-block content** — the firm's
  // address, the project name, the stamp. No room names, no door tags, no
  // dimension strings. Its drawing-area text was converted to OUTLINES when the
  // PDF was made, which a CAD export does routinely, and you cannot read
  // dimensions that are not characters.
  //
  // The decline is correct either way. What is worth the few lines is the
  // SENTENCE: "no printed dimensions were found" on a sheet visibly covered in
  // dimensions reads as the feature being broken, and an estimator who thinks
  // that stops trusting the rest of it. Saying which fact it is costs nothing
  // and is the posture `PlanSheetText.hasTextLayer` already takes — FALSE IS A
  // FACT, NOT A FAILURE.
  if (considered < minAgreeing && segments.length >= PLAINLY_A_DRAWING) {
    return {
      ok: false,
      reason:
        `This sheet has plenty of line work and ${considered === 0 ? "no" : `only ${considered}`} printed ` +
        `dimension${considered === 1 ? "" : "s"} that can be read as text — its lettering was saved as line ` +
        `work rather than characters, so there is nothing here to read a scale from. Set it by hand.`,
      considered,
    };
  }

  if (considered === 0) {
    return { ok: false, reason: "No printed dimensions were found on this sheet.", considered };
  }

  const candidates = scaleCandidates(labels, segments);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "The dimensions on this sheet are not beside any line this could measure.",
      considered,
    };
  }

  // Votes per scale name, counting distinct labels.
  const supporters = new Map<string, Set<string>>();
  const bestPerScale = new Map<string, ScaleCandidate>();
  for (const candidate of candidates) {
    const scale = snap(candidate.feetPerInch);
    if (scale === null) continue;
    const set = supporters.get(scale.name) ?? new Set<string>();
    set.add(candidate.text);
    supporters.set(scale.name, set);
    // THE PAIR TO PROPOSE: THE LONGEST ACCURATE ONE, not the most accurate.
    //
    // The stored line is what every later measurement inherits, and `takeoff-plan.ts`
    // explains why length is what matters: *"the error in a scale is the error in the
    // two clicks divided by the length between them"*. A longer line is steadier under
    // any later nudge, and on a real sheet several candidates are accurate to the limit
    // of the printed figure's own rounding anyway.
    //
    // A first version took the single lowest error with length as a TIE-BREAK, compared
    // with `===` on floats — a tie that essentially never happens, so the first
    // near-exact candidate won and the real sheet proposed its 54pt `6' - 0"` while a
    // 137pt `15' - 3 7/16"` sat there equally exact.
    const held = bestPerScale.get(scale.name);
    const err = (c: ScaleCandidate) => Math.abs(c.feetPerInch - scale.feetPerInch) / scale.feetPerInch;
    const accurate = (c: ScaleCandidate) => err(c) <= BEST_PAIR_TOLERANCE;
    if (held === undefined) {
      bestPerScale.set(scale.name, candidate);
    } else if (accurate(candidate) && accurate(held)) {
      if (lengthOf(candidate) > lengthOf(held)) bestPerScale.set(scale.name, candidate);
    } else if (accurate(candidate) && !accurate(held)) {
      bestPerScale.set(scale.name, candidate);
    } else if (!accurate(held) && err(candidate) < err(held)) {
      bestPerScale.set(scale.name, candidate);
    }
  }

  if (supporters.size === 0) {
    return {
      ok: false,
      reason: "The dimensions on this sheet do not match any standard architectural scale.",
      considered,
    };
  }

  const ranked = [...supporters.entries()]
    .map(([name, set]) => ({ name, votes: set.size, agreed: [...set] }))
    .sort((a, b) => b.votes - a.votes);
  const winner = ranked[0];
  const runnerUp = ranked[1];

  if (winner.votes < minAgreeing) {
    return {
      ok: false,
      reason:
        `Only ${winner.votes} printed dimension${winner.votes === 1 ? "" : "s"} on this sheet agree on a scale — ` +
        `too few to set one from.`,
      considered,
    };
  }

  if (runnerUp !== undefined && winner.votes < runnerUp.votes * minMargin) {
    return {
      ok: false,
      reason:
        `The dimensions on this sheet imply two different scales — ${winner.name} and ${runnerUp.name}. ` +
        `If this sheet carries a detail at its own scale that is expected; set the scale by hand against the ` +
        `part you are measuring.`,
      considered,
    };
  }

  const best = bestPerScale.get(winner.name);
  if (best === undefined) {
    // Unreachable: a name in `supporters` was put there with a candidate.
    return { ok: false, reason: "No dimension line could be proposed for this scale.", considered };
  }

  if (nearEngineeringScale(best.feetPerInch)) {
    return {
      ok: false,
      reason:
        "This sheet reads at an engineering scale, which is a site or civil drawing rather than one to take " +
        "off. Set the scale by hand if that is wrong.",
      considered,
    };
  }

  const scale = snap(best.feetPerInch);
  // The error every later measurement inherits: how far the pair being stored
  // sits from the scale the sheet voted for.
  const inheritedError =
    scale === null ? Infinity : Math.abs(best.feetPerInch - scale.feetPerInch) / scale.feetPerInch;

  if (inheritedError > MAX_INHERITED_ERROR) {
    return {
      ok: false,
      reason:
        `The dimensions on this sheet agree on ${winner.name}, but the best line to set it from is ` +
        `${(inheritedError * 100).toFixed(1)}% out — enough to move every quantity. Set the scale by hand ` +
        `against a dimension you trust.`,
      considered,
    };
  }

  return {
    ok: true,
    scaleName: winner.name,
    feetPerInch: scale?.feetPerInch ?? best.feetPerInch,
    best,
    agreed: winner.agreed,
    considered,
    inheritedError,
  };
}

import type { ScaleVerdict } from "./scaleFromDimensions";

/**
 * ── A SHEET WHOSE DIMENSIONS MEASURE AT EXACTLY TWICE, OR HALF, WHAT IT PRINTS ──
 *
 * A reproduction carries the ORIGINAL's scale in its title block — the words
 * were drawn before anyone chose the paper — so a half-size print says
 * `1/16" = 1'-0"` while every dimension on it measures at `1/32"`. The
 * dimension reader already sees this: it votes for the scale the dimensions
 * imply and does not care what the title block says. Where it then declines
 * for a reason that is not about the vote (too short a line, an off line),
 * this takes the vote — ONLY when it is exactly a factor of two off the one
 * printed scale, won by a clear margin, and backed by a MAJORITY of the
 * labels that sat beside a line at all.
 *
 * That last condition is the measured one. `reducedPrint.ts` records why
 * counting raw candidates against the printed name "fails DANGEROUSLY": every
 * plausible label-to-line pairing is a hypothesis, and clean multiples are
 * abundant among hypotheses. The vote weighs them; the majority is what
 * separates a sheet that IS at half size from a code plan whose forty-five
 * "dimensions" are mostly travel distances. Swept over sixteen training sets
 * (2026-10-22): no sheet qualifies — Topeka G-100b, the sheet this was asked
 * for, votes `1/32"` with 10 of 45 labels against a printed `1/16"`, a
 * plurality and not a majority — so this rule has never fired on a real
 * drawing, and the first sheet it fires on is the one to look at hard.
 *
 * Nothing here sets a scale by hand: the scale is the dimensions' own, the
 * line is the sheet's width at that scale (as the printed fallback does), and
 * the agreeing dimensions are stored as the evidence.
 */

export const REPRODUCTION_SOURCE = "DIMENSIONS_REPRODUCTION";

/** Within this of exactly 2 or exactly 1/2. */
export const FACTOR_TOLERANCE = 0.02;
/** The vote must hold at least this share of every label that measured. */
export const MAJORITY = 0.5;

export type ReproductionReading = {
  scaleName: string;
  feetPerInch: number;
  factor: 2 | 0.5;
  votes: number;
  measured: number;
  agreed: string[];
  printedScaleName: string;
};

export function reproductionReading(input: {
  verdict: ScaleVerdict;
  /** The ONE scale the sheet prints, by name and feet per inch; null when none or several. */
  printed: { name: string; feetPerInch: number } | null;
  minAgreeing?: number;
}): ReproductionReading | null {
  const { verdict, printed } = input;
  if (verdict.ok || verdict.vote === undefined || printed === null) return null;
  const { vote } = verdict;
  if (!(vote.feetPerInch > 0) || !(printed.feetPerInch > 0)) return null;
  const ratio = vote.feetPerInch / printed.feetPerInch;
  const factor: 2 | 0.5 | null = Math.abs(ratio / 2 - 1) <= FACTOR_TOLERANCE ? 2 : Math.abs(ratio / 0.5 - 1) <= FACTOR_TOLERANCE ? 0.5 : null;
  if (factor === null) return null;
  if (vote.votes < (input.minAgreeing ?? 3)) return null;
  if (vote.measured <= 0 || vote.votes < MAJORITY * vote.measured) return null;
  return {
    scaleName: vote.scaleName,
    feetPerInch: vote.feetPerInch,
    factor,
    votes: vote.votes,
    measured: vote.measured,
    agreed: vote.agreed,
    printedScaleName: printed.name,
  };
}

/** The sentence the estimator reads above the scale. */
export function reproductionCaution(printedScaleName: string, scaleName: string, factor: 2 | 0.5): string {
  return (
    `This sheet appears to be printed at ${factor === 2 ? "half" : "double"} size; scale taken from its dimensions. ` +
    `The title block says ${printedScaleName}, but the dimensions on the sheet measure at ${scaleName}, ` +
    `so ${scaleName} is being offered. Check one known distance before you bid off it.`
  );
}

import { CATALOG_MIN_SAMPLE, CATALOG_VARIANCE_THRESHOLD } from "@/lib/catalog-actuals";

/**
 * IS THIS LINE AN OUTLIER AGAINST WHAT THE WORK HAS ACTUALLY COST US.
 *
 * `lib/catalog-actuals.ts` already answers a neighbouring question — "is my
 * catalog default stale?" — and surfaces it on `/catalog`. This asks the one an
 * estimator has in front of them: the bid is about to go out, is a line on it
 * wrong. Same history, same thresholds, different question.
 *
 * ── THE ERROR WORTH CATCHING IS NOT A 20% DRIFT ──
 *
 * It is the typed decimal. `$2.85/SF` entered as `$28.50`, or as `$0.285`. That
 * survives review because the line looks plausible on its own and the total
 * merely looks big, and it is the single most expensive keystroke in estimating:
 * ten times too high loses the job, ten times too low wins it and loses money.
 *
 * So `TYPED_WRONG` is its own kind rather than the top of a sorted list. A 20%
 * variance means "look at your pricing"; a 10× variance means "you hit the wrong
 * key", and those are different sentences leading to different actions. One list
 * ordered by magnitude would make the expensive one read like the cheap one.
 *
 * ── DRIFT LOOKS AT COST. ONLY TYPOS LOOK AT PRICE ──
 *
 * Comparing a line's COST to history is checking a fact: this work has cost us
 * $2.85/SF and you have written $3.40. Comparing its PRICE is second-guessing a
 * margin call somebody made on purpose — a hard job, a GC who pays late, a
 * schedule nobody wants. So `COST_DRIFT` never reads `unitPrice`.
 *
 * A decimal slip in a price is still a typo, though, so `TYPED_WRONG` reads
 * both. That is the whole of the boundary and it is Diego's call, 2026-10-06.
 *
 * ── NOTHING HERE IS A VERDICT ──
 *
 * `bid-responsiveness.ts`'s rule, which this file follows: there is no "your
 * bid looks right". It cannot see what it has no rule for, and most lines have
 * no history at all — so the coverage counts are returned alongside the
 * anomalies and the screen states them. A clean result must not read as "all
 * twenty lines are fine".
 */

export const PRICE_ANOMALY_KINDS = ["TYPED_WRONG", "UNIT_MISMATCH", "COST_DRIFT"] as const;
export type PriceAnomalyKind = (typeof PRICE_ANOMALY_KINDS)[number];

/**
 * HOW FAR OFF COUNTS AS A TYPED DIGIT RATHER THAN A PRICING DECISION.
 *
 * Ten, not five. A genuinely hard job can plausibly cost two or three times the
 * usual — high work off scaffold, a tight occupied site, night shift at a
 * premium — and flagging those as typos is the cry-wolf failure. A factor of ten
 * is a moved decimal point essentially every time.
 */
export const TYPO_FACTOR = 10;

/** A line as this check needs to read it. Structural, so the module couples to
 *  nothing — the shape `estimate-crosschecks.ts` uses for the same reason. */
export type AnomalyLine = {
  id: string;
  description: string;
  /** What the line says this work costs, per unit. Null is a cost-only or
   *  unpriced line and is somebody else's check (`bid-recap.ts`). */
  budgetedUnitCost: number | null;
  /** What we charge. Read ONLY by `TYPED_WRONG` — see the header. */
  unitPrice: number | null;
  /** As the line states it. Compared against the catalog entry's own unit,
   *  which is a declared column on both sides. */
  unit: string | null;
};

/** What the history says, straight off `catalogActuals`. Null when the line
 *  came from no catalog entry — which is most lines. */
export type AnomalyHistory = {
  /** The catalog entry's own unit, for the mismatch check. */
  unit: string | null;
  /** `catalogActuals().actualUnitCost` — cost per unit across FINISHED jobs. */
  actualUnitCost: number | null;
  /** `catalogActuals().linesWithCosts` — the sample. Stated in every sentence,
   *  because an anomaly off three jobs is not an anomaly. */
  sampleSize: number;
};

export type PriceAnomaly = {
  kind: PriceAnomalyKind;
  lineId: string;
  /** One sentence, naming the figures and the sample it is judged against. */
  sentence: string;
};

export type PriceAnomalyReport = {
  anomalies: PriceAnomaly[];
  /** Lines that had history to be judged against. */
  checked: number;
  /**
   * Lines with no history at all.
   *
   * REPORTED RATHER THAN IGNORED, and this is the difference between a check
   * and a reassurance. Most lines are typed by hand and carry no
   * `sourceCatalogEntryId`, so a panel that said only "no anomalies" would be
   * read as "all of these are fine" when it had looked at a third of them.
   * Matching the rest by DESCRIPTION was considered and refused: it is the
   * text-matching this repo declines for `costCategory`, the takeoff recipes
   * and the cross-checks, and a renamed line reads as a different one.
   */
  unchecked: number;
};

const money = (value: number): string =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "14 finished jobs" / "1 finished job" — the sample, in words. */
const sample = (size: number): string => `${size} finished ${size === 1 ? "job" : "jobs"}`;

/** Ten times out, in either direction, against a history that can be divided. */
function isTypo(value: number, actual: number): boolean {
  if (!(actual > 0) || !(value > 0)) return false;
  const ratio = value / actual;
  return ratio >= TYPO_FACTOR || ratio <= 1 / TYPO_FACTOR;
}

export function priceAnomalies(
  rows: readonly { line: AnomalyLine; history: AnomalyHistory | null }[],
): PriceAnomalyReport {
  const anomalies: PriceAnomaly[] = [];
  let checked = 0;
  let unchecked = 0;

  for (const { line, history } of rows) {
    // NO HISTORY IS NOT A FINDING. It is the common case and it is counted, not
    // reported — see `unchecked`.
    if (history === null || history.actualUnitCost === null || history.sampleSize === 0) {
      unchecked += 1;
      continue;
    }
    checked += 1;
    const actual = history.actualUnitCost;

    // ── UNIT MISMATCH, which needs no arithmetic at all ──
    // Both units are declared columns. This is the error that makes a number
    // PLAUSIBLE BUT WRONG: priced per square foot against a quantity measured
    // in linear feet reads fine and is out by the height of the wall.
    if (line.unit !== null && history.unit !== null && line.unit.trim() !== "" && history.unit.trim() !== "") {
      if (line.unit.trim().toUpperCase() !== history.unit.trim().toUpperCase()) {
        anomalies.push({
          kind: "UNIT_MISMATCH",
          lineId: line.id,
          sentence:
            `${line.description} is priced per ${line.unit.trim()}, but this work has always been measured ` +
            `per ${history.unit.trim()}. One of the two is wrong, and the quantity will be out by whatever ` +
            `converts between them.`,
        });
      }
    }

    // ── TYPED WRONG: cost or price, ten times out ──
    // NOT gated on CATALOG_MIN_SAMPLE, deliberately. A tenfold difference from
    // even one costed job is worth a look, because the claim is "you typed this
    // wrong" rather than "your price is off the average" — and a decimal point
    // does not become more or less moved with a bigger sample.
    const typoCost = line.budgetedUnitCost !== null && isTypo(line.budgetedUnitCost, actual);
    if (typoCost && line.budgetedUnitCost !== null) {
      anomalies.push({
        kind: "TYPED_WRONG",
        lineId: line.id,
        sentence:
          `${line.description} is costed at ${money(line.budgetedUnitCost)} per ${line.unit ?? "unit"}, and this ` +
          `work has cost ${money(actual)} across ${sample(history.sampleSize)}. Check what you typed — that is a ` +
          `moved decimal point more often than a price.`,
      });
    }
    // The price gets the same test and nothing else. A slip here is a typo; a
    // margin decision is not this file's business.
    if (!typoCost && line.unitPrice !== null && isTypo(line.unitPrice, actual)) {
      anomalies.push({
        kind: "TYPED_WRONG",
        lineId: line.id,
        sentence:
          `${line.description} is priced at ${money(line.unitPrice)} per ${line.unit ?? "unit"} against a cost of ` +
          `${money(actual)} across ${sample(history.sampleSize)}. Check the price — a figure that far from cost is ` +
          `usually a keystroke.`,
      });
    }

    // ── COST DRIFT, the ordinary case ──
    // Gated on the sample, reusing `CATALOG_MIN_SAMPLE` rather than a second
    // constant: "one job that went badly is not evidence the template is
    // wrong", and it is not evidence this line is wrong either. And skipped
    // when the typo check already spoke — one line should not say both "you
    // typed it wrong" and "it is 900% high".
    if (!typoCost && line.budgetedUnitCost !== null && history.sampleSize >= CATALOG_MIN_SAMPLE && actual > 0) {
      const ratio = line.budgetedUnitCost / actual;
      const off = Math.abs(ratio - 1);
      if (off >= CATALOG_VARIANCE_THRESHOLD && ratio < TYPO_FACTOR && ratio > 1 / TYPO_FACTOR) {
        const direction = ratio > 1 ? "above" : "below";
        anomalies.push({
          kind: "COST_DRIFT",
          lineId: line.id,
          sentence:
            `${line.description} is costed at ${money(line.budgetedUnitCost)}, ${Math.round(off * 100)}% ` +
            `${direction} the ${money(actual)} this work has cost across ${sample(history.sampleSize)}.`,
        });
      }
    }
  }

  // TYPED_WRONG FIRST, because it is the one that loses a job, then the unit
  // mismatch, then drift. Within a kind the input order is kept, which is the
  // order the lines are on the estimate.
  const rank: Record<PriceAnomalyKind, number> = { TYPED_WRONG: 0, UNIT_MISMATCH: 1, COST_DRIFT: 2 };
  anomalies.sort((a, b) => rank[a.kind] - rank[b.kind]);

  return { anomalies, checked, unchecked };
}

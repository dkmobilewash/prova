import type { ImportRow } from "./catalog-import";

/**
 * WHAT A PRICE LIST'S "HOURS" COLUMN MEANS — asked, never guessed.
 *
 * THE DEFECT. `importCatalogEntries` wrote that column straight into
 * `LineItemCatalogEntry.defaultLaborHours`, which is FLAT hours for a whole
 * line. A real price list's hours column is a per-unit productivity factor —
 * the importer's own sample carried 0.012 for a square foot of board — so a
 * 600 SF line imported that way priced **0.012 hours** of labor instead of
 * 7.2, and `Decimal(8,2)` rounded it to 0.01 on the way in. Two errors
 * stacked, both silent, on the number that decides whether a bid is
 * profitable.
 *
 * THE FIX THAT WOULD HAVE BEEN WORSE, and it is why this module exists
 * instead of a one-line change. Issue #514's own prescription was to map the
 * hours column into `productionRate`. Those two are **reciprocals**:
 *
 *     a price list's Hours = HOURS PER UNIT     0.012 hr/SF
 *     productionRate       = UNITS PER HOUR     83.33 SF/hr
 *
 * so writing one into the other makes `hoursFromRate` compute `600 / 0.012` =
 * **50,000 hours** where the truth is 7.2 — wrong by 1/x², about 6,900× here,
 * in the direction that loses a bid rather than the direction anybody notices.
 * Inverting unconditionally is no better: a list that genuinely carries
 * units-per-hour ("60 SF/hr") inverts to 0.0167 and then 600 SF reads as
 * 36,000 hours. **Both blind rules are catastrophic, in opposite directions.**
 *
 * WHICH CONVENTION A FILE USES IS A FACT ABOUT THE FILE. Nothing in the app
 * can know it — there is no unit on the column, no header that distinguishes
 * "Hours" from "Hours", and published lists exist in both shapes. So the
 * import asks.
 *
 * AND IT ASKS AS A CONSEQUENCE, NOT AS A UNIT. "Is this hours per unit or
 * units per hour?" is a question a good estimator can read the wrong way
 * round at 6pm, and a misread question is worse than no question because it
 * produces a confident answer. So the choice is offered as what each reading
 * DOES to a row out of their own file:
 *
 *     100 SF of 5/8" Type X board would take
 *       · 1.2 hours          — hours per unit
 *       · 8,333 hours        — units per hour
 *       · 0.01 hours         — flat, at any quantity
 *
 * Nobody in this trade picks 8,333 hours. That is a check a foreman can make
 * in two seconds without knowing what a reciprocal is, and it is the same
 * move as the takeoff calibration readback: prove the scale by stating what
 * it implies, not by naming the ratio.
 *
 * NOTHING HERE WRITES, PARSES TEXT, OR IMPORTS REACT. The client renders the
 * question from these functions and the server re-derives the answer from the
 * same ones over the same text, so the two can never disagree about what the
 * file said — the property `catalog-import.ts` already holds and this must
 * not break.
 */

/**
 * The three readings. `FLAT` is what the import did before and is kept as a
 * choice rather than removed: an assembly list ("Hang one door — 2.5 hrs")
 * really does carry flat per-line hours, and silently dropping the reading
 * somebody's last import used would change their numbers with nothing on
 * screen to say so.
 */
export type LaborReading = "PER_UNIT" | "PER_HOUR" | "FLAT";

export const LABOR_READINGS: readonly LaborReading[] = ["PER_UNIT", "PER_HOUR", "FLAT"] as const;

/**
 * The quantity the consequence is stated at. Nominal and fixed: a price-list
 * row carries no quantity, so one has to be supplied to turn a rate into
 * hours, and it is named in the copy ("100 SF would take…") rather than
 * implied. 100 keeps both readings legible at the values that actually
 * occur — 0.012 gives 1.2 against 8,333 — where 1 would collapse the flat
 * and per-unit readings onto the same number and hide the difference.
 */
export const NOMINAL_QUANTITY = 100;

/**
 * The bounds a stored rate has to clear, shared with the hand-typed field on
 * `/catalog` so an imported rate and a typed one cannot be governed by two
 * different rules. A rate of 0 divides into infinite hours; a six-figure
 * units-per-hour is a decimal slip rather than a fast crew.
 */
export const PRODUCTION_RATE_MIN = 0.0001;
export const PRODUCTION_RATE_MAX = 100000;

/** `LineItemCatalogEntry.productionRate` is `Decimal(10,4)`. */
const RATE_DECIMALS = 4;
/** `LineItemCatalogEntry.defaultLaborHours` is `Decimal(8,2)`. */
const FLAT_DECIMALS = 2;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * What one reading would actually store and imply for one cell.
 *
 * THE HOURS ARE COMPUTED FROM THE STORED NUMBER, NOT THE RAW CELL, and that
 * is deliberate rather than fussy. `1 / 0.012` is 83.333…, the column holds
 * four decimals, and the app will later divide by the 83.3333 it read back —
 * so quoting hours from the unrounded value would promise a figure the
 * product does not produce. It also makes the FLAT reading's own loss
 * visible: 0.012 stored in `Decimal(8,2)` is 0.01, so that row shows 0.01
 * rather than the 0.012 the file said, which is the clearest possible
 * statement of why flat is the wrong reading for a per-unit file.
 */
export type LaborConsequence = {
  reading: LaborReading;
  /** `productionRate` this reading would store, or null when it stores none. */
  productionRate: number | null;
  /** `defaultLaborHours` this reading would store, or null. */
  laborHours: number | null;
  /**
   * Hours for `NOMINAL_QUANTITY` units, derived from the STORED figures the
   * way the app derives them (`estimatedHours`). Null when this reading
   * cannot store anything usable — a non-positive cell, or a rate outside
   * the bounds — which is a real outcome and not an error to hide.
   */
  hoursAtNominal: number | null;
  /** Why this reading would store nothing, for the one line that says so. */
  refusal: string | null;
};

function rateConsequence(reading: LaborReading, rate: number | null, cell: number): LaborConsequence {
  if (rate === null || !Number.isFinite(rate)) {
    return {
      reading,
      productionRate: null,
      laborHours: null,
      hoursAtNominal: null,
      refusal:
        cell <= 0
          ? `${cell} is not a rate anything can divide by, so this row would import with no labor.`
          : "That works out to a rate outside what this field holds, so this row would import with no labor.",
    };
  }
  const stored = roundTo(rate, RATE_DECIMALS);
  if (stored < PRODUCTION_RATE_MIN || stored > PRODUCTION_RATE_MAX) {
    return {
      reading,
      productionRate: null,
      laborHours: null,
      hoursAtNominal: null,
      refusal: `That reading makes the rate ${stored}, outside ${PRODUCTION_RATE_MIN}–${PRODUCTION_RATE_MAX}, so this row would import with no labor.`,
    };
  }
  return {
    reading,
    productionRate: stored,
    laborHours: null,
    // Exactly what the app will do with the stored rate: quantity ÷ rate.
    hoursAtNominal: NOMINAL_QUANTITY / stored,
    refusal: null,
  };
}

/** Every reading's outcome for one cell value, in a fixed order. */
export function consequencesFor(cell: number): LaborConsequence[] {
  const perUnit = cell > 0 ? 1 / cell : null;
  const perHour = cell > 0 ? cell : null;
  const flatStored = roundTo(cell, FLAT_DECIMALS);

  return [
    rateConsequence("PER_UNIT", perUnit, cell),
    rateConsequence("PER_HOUR", perHour, cell),
    flatStored > 0
      ? {
          reading: "FLAT",
          productionRate: null,
          laborHours: flatStored,
          // Flat means flat: the same hours at 1 unit and at 100. That the
          // number does not move with the quantity IS the reading, and
          // showing it next to two that do is what makes it choosable.
          hoursAtNominal: flatStored,
          refusal: null,
        }
      : {
          reading: "FLAT",
          productionRate: null,
          laborHours: null,
          hoursAtNominal: null,
          refusal:
            cell <= 0
              ? `${cell} is not an amount of labor, so this row would import with no hours.`
              : `Rounded to the two decimals this field holds, ${cell} is 0.00 — so this row would import with no hours.`,
        },
  ];
}

/**
 * Which reading the magnitudes LEAN toward, and null when they do not lean.
 *
 * THE LEAN IS A PRE-SELECTION, NEVER A DECISION, and the reason is in the
 * counter-case rather than in the rule. A list of door and frame assemblies
 * carries 1.5, 2.0, 3.0 hours per unit — and read as units per hour those
 * same items are 0.67, 0.5, 0.33. So "small numbers mean hours per unit" is
 * not a theorem; it is true of the lists people actually write, because
 * nobody records a production rate as "0.67 doors an hour".
 *
 * Hence two deliberately timid tests, and silence in between:
 *
 *   - every value UNDER 1 → hours per unit, because a units-per-hour column
 *     where every line is slower than one unit an hour is not something
 *     anybody publishes;
 *   - every value OVER 10 → units per hour, because ten-plus hours for a
 *     single unit of every item on the list is not a trade price list.
 *
 * Anything overlapping 1–10 gets NO pre-selection and a sentence saying the
 * numbers do not settle it. That band contains the real ambiguity (1.5 hr
 * per door against 5 SF/hr of something slow) and a guess there is the
 * failure this whole module exists to avoid.
 *
 * Do not tighten these without a file that proves the tighter rule. A lean
 * that is right 95% of the time still ships a 6,900× error one import in
 * twenty, and the person it ships to has no way to see it.
 */
export const LEAN_PER_UNIT_BELOW = 1;
export const LEAN_PER_HOUR_ABOVE = 10;

export type LaborLean = { suggested: LaborReading | null; because: string };

export function leanFrom(values: number[]): LaborLean {
  const usable = values.filter((value) => value > 0);
  if (usable.length === 0) {
    return { suggested: null, because: "No usable hours figure to read a pattern from." };
  }

  const max = Math.max(...usable);
  const min = Math.min(...usable);

  if (max < LEAN_PER_UNIT_BELOW) {
    return {
      suggested: "PER_UNIT",
      because: `Every hours figure in this file is below ${LEAN_PER_UNIT_BELOW} (largest ${max}), which reads as hours per unit — a production rate under one unit an hour is not something a price list carries.`,
    };
  }
  if (min > LEAN_PER_HOUR_ABOVE) {
    return {
      suggested: "PER_HOUR",
      because: `Every hours figure in this file is above ${LEAN_PER_HOUR_ABOVE} (smallest ${min}), which reads as units per hour — ten or more hours for one unit of every item is not a price list.`,
    };
  }
  return {
    suggested: null,
    because: `The hours figures here run ${min} to ${max}, which does not settle it — that range is written both ways in real price lists. Pick the line that matches how you priced it.`,
  };
}

/**
 * The row the question is asked about.
 *
 * The MEDIAN carrier of an hours value, so the example is typical of the file
 * rather than whichever row happens to be first — and a row with a unit is
 * preferred, because "100 SF would take" reads as a sentence and "100 would
 * take" does not.
 */
export function sampleRowFor(rows: ImportRow[]): ImportRow | null {
  const carriers = rows.filter((row) => row.laborHours != null && row.laborHours > 0);
  if (carriers.length === 0) return null;
  const withUnit = carriers.filter((row) => row.unit != null && row.unit.trim() !== "");
  const pool = withUnit.length > 0 ? withUnit : carriers;
  const sorted = [...pool].sort((a, b) => (a.laborHours as number) - (b.laborHours as number));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export type LaborQuestion =
  | {
      /** No hours column, or no row carries a value — there is nothing to ask. */
      kind: "absent";
    }
  | {
      kind: "ask";
      sample: ImportRow;
      /** The sample's cell value, which every consequence is computed from. */
      cell: number;
      consequences: LaborConsequence[];
      lean: LaborLean;
      /** How many rows carry an hours figure at all. */
      carrying: number;
      /** Rows whose hours figure is zero or negative and will import with no labor. */
      unusable: number;
    };

/** The whole question, or `absent` when the file does not raise it. */
export function laborQuestion(rows: ImportRow[]): LaborQuestion {
  const withValue = rows.filter((row) => row.laborHours != null);
  if (withValue.length === 0) return { kind: "absent" };

  const sample = sampleRowFor(rows);
  // Every value is present but none is positive: there is no reading to
  // choose between, because no reading can store anything.
  if (sample === null) return { kind: "absent" };

  const cell = sample.laborHours as number;
  return {
    kind: "ask",
    sample,
    cell,
    consequences: consequencesFor(cell),
    lean: leanFrom(withValue.map((row) => row.laborHours as number)),
    carrying: withValue.length,
    unusable: withValue.filter((row) => (row.laborHours as number) <= 0).length,
  };
}

/**
 * The submitted answer, or null when it is missing or not one of the three.
 *
 * Strict on purpose. The caller's contract is to REFUSE on null rather than
 * fall back to a reading, because every available fallback is a guess about
 * a labor number — which is the one thing this module exists to prevent. An
 * unrecognised value means a form and a server that disagree, and guessing
 * through that disagreement is how the original defect shipped.
 */
export function readingFromForm(raw: unknown): LaborReading | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  return (LABOR_READINGS as readonly string[]).includes(value) ? (value as LaborReading) : null;
}

/**
 * What to write for one row under a chosen reading.
 *
 * Returns the two catalog columns as strings, the shape `createMany` wants,
 * and NEVER both: a row carrying flat hours and a rate would have an inert
 * rate (`estimatedHours` takes the flat hours as the override), so an import
 * that produced both would quietly ignore half of what it wrote.
 */
export function laborFieldsFor(
  row: ImportRow,
  reading: LaborReading,
): { defaultLaborHours: string | null; productionRate: string | null } {
  if (row.laborHours == null) return { defaultLaborHours: null, productionRate: null };

  const chosen = consequencesFor(row.laborHours).find((c) => c.reading === reading);
  if (!chosen) return { defaultLaborHours: null, productionRate: null };

  return {
    defaultLaborHours: chosen.laborHours != null ? chosen.laborHours.toString() : null,
    productionRate: chosen.productionRate != null ? chosen.productionRate.toString() : null,
  };
}

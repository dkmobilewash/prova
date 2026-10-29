import { excludedSheetReason, heldOutReason } from "./heldOutSets";

/**
 * ── TURNING LABELLED SHEETS INTO TRAINING ROWS, HELD-OUT SETS REFUSED ──
 *
 * This existed as a script in a scratch directory, which is why the census
 * that was supposed to guard it found NOTHING to guard: zero builders, a
 * green test, and the rule enforced by whoever remembered it. A rule that
 * lives outside the repository is a rule nothing can check.
 *
 * So the builder lives here, it refuses a held-out set by asking
 * `heldOutSets.ts`, and `trainingRowsCensus.test.ts` requires that anything
 * reading the label directory does the same.
 *
 * ── FAMILIES ARE PLAN SETS, AND THAT IS WHAT MAKES A SPLIT MEAN ANYTHING ──
 *
 * `train-wall-model.py` holds back one FAMILY at a time. A family has to be a
 * building, not a sheet: A4.B.1 and A4.B.2 are two floors of one tower drawn
 * by one office, so splitting between them scores a model on the building it
 * trained on. Measured on 2026-10-19 — six labelled sheets turned out to be
 * three buildings, one of them carrying 89% of the positives, and the model
 * transferred to nothing.
 */

export type LabelRow = {
  features: number[];
  label: number;
  lengthFt?: number | null;
};

export type LabelledSheet = {
  /** The PDF the labels came from, as the label file records it. */
  set: string;
  /** The sheet within that set — a case, never a family. */
  sheet: string;
  rows: LabelRow[];
};

export type TrainingRow = {
  case: string;
  family: string;
  features: number[];
  label: number;
  lengthFt: number | null;
};

export type TrainingRowsResult = {
  rows: TrainingRow[];
  /** Sets refused, with the reason and what it cost, for the run's report. */
  refused: { set: string; sheet: string; why: string; rows: number }[];
  counts: {
    sheets: number;
    sheetsRefused: number;
    rows: number;
    positive: number;
    families: number;
  };
};

/** One family per plan SET, lower-cased so two spellings are one family. */
function familyOf(set: string): string {
  return set
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

/**
 * Build the training rows from labelled sheets.
 *
 * A held-out set contributes NOTHING and is reported. Its labels are an
 * answer key: a model that has seen the test is not being tested, and a run
 * that silently skipped four sets looks exactly like a run that never had
 * them.
 */
export function trainingRows(sheets: readonly LabelledSheet[]): TrainingRowsResult {
  const rows: TrainingRow[] = [];
  const refused: { set: string; sheet: string; why: string; rows: number }[] = [];

  for (const sheet of sheets) {
    const why = heldOutReason(sheet.set);
    if (why !== null) {
      refused.push({ set: sheet.set, sheet: sheet.sheet, why, rows: sheet.rows.length });
      continue;
    }
    // A SHEET that is the wrong question, rather than a SET being kept as a
    // key. Refused here and not elsewhere, for the reason this file's header
    // gives: two refusals are how the two stop agreeing.
    const excluded = excludedSheetReason(sheet.set, sheet.sheet);
    if (excluded !== null) {
      refused.push({ set: sheet.set, sheet: sheet.sheet, why: excluded, rows: sheet.rows.length });
      continue;
    }
    const family = familyOf(sheet.set);
    for (const row of sheet.rows) {
      rows.push({
        case: `${family}-${sheet.sheet}`,
        family,
        features: row.features,
        label: row.label,
        lengthFt: row.lengthFt ?? null,
      });
    }
  }

  return {
    rows,
    refused,
    counts: {
      sheets: sheets.length - refused.length,
      sheetsRefused: refused.length,
      rows: rows.length,
      positive: rows.reduce((n, r) => n + (r.label === 1 ? 1 : 0), 0),
      families: new Set(rows.map((r) => r.family)).size,
    },
  };
}

/** One line for the run's own output, naming what was left out. */
export function trainingRowsSentence(result: TrainingRowsResult): string {
  const { counts } = result;
  const head =
    `${counts.rows.toLocaleString()} rows from ${counts.sheets} sheets across ` +
    `${counts.families} buildings, ${counts.positive.toLocaleString()} positive`;
  if (result.refused.length === 0) return `${head}. Nothing was held out.`;
  const sets = [...new Set(result.refused.map((r) => r.set))];
  const held = result.refused.reduce((n, r) => n + r.rows, 0);
  return (
    `${head}. REFUSED ${held.toLocaleString()} rows from ${sets.length} held-out ` +
    `set(s): ${sets.join(", ")}.`
  );
}

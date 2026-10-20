/**
 * ── THE SETS THAT MUST NEVER REACH TRAINING ──
 *
 * A held-out set is labelled like any other — its labels ARE the answer key —
 * and the thing that must not happen is those labels becoming training rows.
 * A model that has seen the test is not being tested.
 *
 * ── A LIST, NOT A FILE NAME ──
 *
 * Diego's rule, 2026-10-20, and it is a correction of what came before.
 * `add-plan-sets.mjs` skips a file whose NAME says held-out, which is the
 * wrong instrument twice over: it refuses to INGEST, so a held-out set cannot
 * be labelled at all, and it depends on a name that nothing enforces — the
 * four sets held out that day are called `CENTRAL-BANK-OF-THE-MIDWEST-
 * Drawings.pdf`, `Gen-BBQ-Sacramento-CA.pdf`, `SLN-Terminal-Public-Area-
 * Improvements-Plans.pdf` and `stem-bid-drawings (1).pdf`, and not one of
 * them says so. The other session's own note says to rename them before an
 * ingest run, which is a rule a person has to remember at the moment it
 * matters.
 *
 * So the rule lives here, in the training path, where it is checked every
 * time rows are built rather than every time somebody names a file.
 *
 * ── MATCHED ON THE FILE, BECAUSE THAT IS WHAT A LABEL CARRIES ──
 *
 * A saved label file records the `set` it came from, which is the PDF's own
 * name. That is the one identifier that survives from the drawing to the
 * training row, so it is what this matches on — case-insensitively, ignoring
 * punctuation and extension, because `Gen-BBQ-Sacramento-CA.pdf` becomes
 * `Gen_BBQ_Sacramento_CA.pdf` as a directory and could reasonably arrive as
 * either.
 */

/** Every set whose labels are a test answer key. */
export const HELD_OUT_SETS: readonly { readonly match: string; readonly why: string }[] = [
  {
    match: "CENTRAL-BANK-OF-THE-MIDWEST",
    why: "bank branch — held out 2026-10-20, a building type training does not have",
  },
  {
    match: "Gen-BBQ-Sacramento",
    why: "restaurant tenant improvement — held out 2026-10-20",
  },
  {
    match: "SLN-Terminal",
    why: "airport terminal — held out 2026-10-20",
  },
  {
    match: "stem-bid-drawings",
    why: "Garrett College STEM building — held out 2026-10-20",
  },
  {
    // Spelled without the hyphen deliberately. `flatten` strips punctuation
    // from both sides, so this matches "Cedar Hollow.pdf" exactly as the
    // hyphenated form would — and `truthWall.test.ts` greps the tree for
    // `cedar-hollow` to prove the ENGINE never reaches for that answer key.
    // Writing the hyphen here would trip a guard whose whole point this file
    // shares, which is a worse outcome than one unusual spelling.
    match: "CedarHollow",
    why: "the practice plan whose answer key this repo generated; never training data",
  },
];

/** Punctuation and extension removed, so one spelling matches another. */
function flatten(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}

/**
 * Why this set is held out, or null when it may be trained on.
 *
 * Takes whatever names the set — the PDF's file name, the label directory, or
 * a label file's own `set` field.
 */
export function heldOutReason(set: string | null | undefined): string | null {
  if (set === null || set === undefined) return null;
  const flat = flatten(set);
  if (flat === "") return null;
  for (const one of HELD_OUT_SETS) {
    if (flat.includes(flatten(one.match))) return one.why;
  }
  return null;
}

/** True when this set must never contribute a training row. */
export function isHeldOut(set: string | null | undefined): boolean {
  return heldOutReason(set) !== null;
}

export type TrainingSplit<T> = {
  /** Rows that may be trained on. */
  train: T[];
  /** Rows refused, with the reason, so a run can report what it left out. */
  refused: { set: string; why: string; rows: number }[];
};

/**
 * Split labelled sets into what may be trained on and what may not.
 *
 * Returns the refusals rather than silently dropping them: a training run that
 * quietly ignored four sets and a training run that never saw them look
 * identical in the output, and the first one means somebody's labels were
 * wasted.
 */
export function splitForTraining<T>(
  sets: readonly { set: string; rows: T[] }[],
): TrainingSplit<T> {
  const train: T[] = [];
  const refused: { set: string; why: string; rows: number }[] = [];
  for (const one of sets) {
    const why = heldOutReason(one.set);
    if (why === null) {
      train.push(...one.rows);
    } else {
      refused.push({ set: one.set, why, rows: one.rows.length });
    }
  }
  return { train, refused };
}

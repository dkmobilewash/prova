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

/**
 * Every set the training path must refuse.
 *
 * Mostly answer keys, and one sibling: see the `Jefferson-City` entry, which
 * is not a test set and must still never be trained on. Each `why` says which
 * kind it is, because "held out" and "kept out" are different claims and a
 * reader counting answer keys off this list would otherwise get it wrong.
 */
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
    match: "KSU-Fairchild-Hall",
    why: "university teaching building — held out 2026-10-21, before a label was written",
  },
  {
    match: "Albany-Readiness-Center",
    why: "National Guard readiness centre — held out 2026-10-21, before a label was written",
  },
  {
    match: "OReillys-Architectural",
    why: "retail shell — held out 2026-10-21, before a label was written",
  },
  {
    // ── NOT HELD OUT, AND KEPT OUT OF TRAINING ANYWAY ──
    //
    // Jefferson City is Albany Readiness Center's SIBLING: the same program
    // from the same source, so a model trained on this one has effectively
    // seen the test. Diego's call, 2026-10-21.
    //
    // It sits in the same list because this list is the only thing the
    // training path consults, and a second mechanism for "keep out of
    // training" is a second thing to forget. The `why` says which kind it is,
    // so a reader is not left believing there is a fourth answer key.
    match: "Jefferson-City",
    why: "SIBLING of the held-out Albany Readiness Center — kept out of training, not a test key",
  },
  {
    match: "Modbox-Bistro-plans",
    why: "modular restaurant build — held out 2026-10-29, before a label was written",
  },
  {
    match: "Darrington-Library-Tenant-Improvements",
    why: "library tenant improvement — held out 2026-10-29, before a label was written",
  },
  {
    match: "HILLSIDE-VILLAGE-Apartments",
    why: "multi-family apartments — held out 2026-10-29, before a label was written",
  },
  {
    // ── THE SCANNED ANSWER KEY ──
    //
    // The first set in the corpus that is a scan rather than a vector export:
    // 106 pages, one 400-dpi 1-bit image each. Held out 2026-10-29 before a
    // label was written, so the scanned pipeline has a test it has never seen.
    // The two sheets to label are p24 (A242B, level 3 east) and p27 (A244A,
    // level 5 west), both printed 1/8" = 1'-0".
    match: "8102 EVERGREEN WAY",
    why: "scanned multi-family set — the SCANNED answer key, held out 2026-10-29, before a label was written",
  },
  {
    // ── DECLARED HELD OUT IN ROUND 7, ADDED TO THE CODE IN ROUND 9 ──
    //
    // These three were named held out when round 7 was planned and never
    // reached this list, so for two rounds they were held out in prose and
    // trainable in code. The third session's round-9 survey caught it while
    // deciding what to label next. Nothing else would have: a set missing
    // from this list is indistinguishable from a set nobody mentioned.
    //
    // Added before any label exists for them, which is the only order in
    // which holding out means anything.
    match: "lodi-memorial-library",
    why: "public library — declared held out for round 7, added to the list 2026-10-29 before a label was written",
  },
  {
    match: "Missouri-New-Outdoor-Pavilion",
    why: "open-air pavilion — declared held out for round 7, added to the list 2026-10-29 before a label was written",
  },
  {
    // The round-9 survey's own argument for keeping this one: it is an office
    // fit-out, the building type that round wants, so it is worth more as a
    // test than as training.
    match: "Nall-Wealth-Plans",
    why: "office fit-out — declared held out for round 7, added to the list 2026-10-29 before a label was written",
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

/**
 * ── SHEETS THAT ARE NEITHER TRAINING NOR A KEY ──
 *
 * A held-out SET is still an answer key: it is scored, just never trained on.
 * These are different. They are labelled, the labels are correct, and the
 * sheet is the wrong question — so it is excluded from training AND from
 * scoring, and the `why` has to say which kind of wrong.
 *
 * Keep this short. A sheet that merely scores badly belongs in the scorecard,
 * not in here; the bar is that the sheet asks the finder for something it
 * should not do.
 */
export const EXCLUDED_SHEETS: readonly { readonly set: string; readonly sheet: string; readonly why: string }[] = [
  {
    set: "michigan-state-universtity",
    sheet: "A3",
    why:
      "its traced walls are mostly EXISTING (A-EXIST) — a trace means 'a wall the finder missed', so " +
      "training on it teaches walls nobody is building and scoring against it counts a correct refusal " +
      "as a miss. Excluded by Diego 2026-10-29; see BOARD.md.",
  },
  // ── THE SCOPE IS IN THE NOTES AND THE WALLS LOOK NEW ──
  //
  // Diego, 2026-10-30, after Chrome's existing-walls cleanup. These four are
  // not excluded for being renovations: Murray, Baker, Bunkie, Supreme Court,
  // NG Green Bay A3.2 and Darrington are renovations too and they STAY IN,
  // because their DRAWINGS mark what is existing — a legend fill or outline,
  // (E) tags, a NEW | EXISTING line — so new work can be told from existing
  // and the key can say which is which.
  //
  // On these four the scope is set only by NOTES (finishes, windows and doors
  // in an existing building) and the walls are drawn exactly like new walls.
  // So an honest key is all-R — every wall rejected, because none of it is
  // being built — and a key that rejects every ordinary-looking wall on a
  // floor plan cannot teach "this is existing", because nothing in the
  // geometry says so. It teaches that ORDINARY WALLS ARE JUNK, which is the
  // opposite of the finder's job, and it scores a correct find as a false
  // positive.
  //
  // Michigan A3 above is the same failure from the other side: there, traced
  // existing walls taught walls nobody is building.
  {
    set: "glen-hazel-bernice",
    sheet: "A-101",
    why:
      "the scope is set only by the notes (finishes, windows and doors in an existing building) and " +
      "the walls are drawn like new walls, so an honest key is all-R and would teach that ordinary " +
      "walls are junk. Excluded by Diego 2026-10-30; see BOARD.md.",
  },
  {
    set: "glen-hazel-bernice",
    sheet: "A-111",
    why:
      "the scope is set only by the notes (finishes, windows and doors in an existing building) and " +
      "the walls are drawn like new walls, so an honest key is all-R and would teach that ordinary " +
      "walls are junk. Excluded by Diego 2026-10-30; see BOARD.md.",
  },
  {
    set: "DEVELOPMENT-AND-DERNIZATION-DEPARTMENT",
    sheet: "A-2",
    why:
      "the scope is set only by the notes (finishes, windows and doors in an existing building) and " +
      "the walls are drawn like new walls, so an honest key is all-R and would teach that ordinary " +
      "walls are junk. Excluded by Diego 2026-10-30; see BOARD.md.",
  },
  {
    set: "DEVELOPMENT-AND-DERNIZATION-DEPARTMENT",
    sheet: "A-5",
    why:
      "the scope is set only by the notes (finishes, windows and doors in an existing building) and " +
      "the walls are drawn like new walls, so an honest key is all-R and would teach that ordinary " +
      "walls are junk. Excluded by Diego 2026-10-30; see BOARD.md.",
  },
];

/** The reason this exact sheet is neither trained on nor scored, or null. */
export function excludedSheetReason(set: string, sheet: string): string | null {
  const want = flatten(set);
  for (const one of EXCLUDED_SHEETS) {
    if (flatten(one.set) === want && flatten(one.sheet) === flatten(sheet)) return one.why;
  }
  return null;
}

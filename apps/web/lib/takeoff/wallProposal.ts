import type { WallCandidate } from "./wallVectors";
import { type WallGroup, typesAtThickness } from "./wallGroups";
import { type MatchableWallType, sameDesignation } from "./wallTypeMatch";

/**
 * STORING WHAT THE GEOMETRY FOUND, AND READING IT BACK AS THE SAME GROUPS.
 *
 * `TakeoffWallProposal.runs` is a `Json` column, so the database cannot refuse a
 * malformed element — the schema comment says the refusal lives here, and this
 * is it. The reason that matters more than tidiness: the column is read back
 * into the panel an estimator ACCEPTS from, and a run missing `thicknessFeet`
 * would be grouped, measured and offered for pricing as a wall of thickness
 * `undefined`, which arithmetic turns into `NaN` feet rather than into an error
 * anybody sees.
 *
 * ── WHAT IS STORED AND WHAT IS REBUILT ──
 *
 * Stored: the centreline, the thickness, the openings, the cluster's average
 * thickness, and where the group's name came from. Rebuilt on every read: the
 * footage (from the geometry and the LIVE calibration) and the candidate wall
 * types (from the company's CURRENT library). A stored match would go stale the
 * moment somebody adds a wall type; stored footage would be a second copy of a
 * number the geometry already determines.
 */

/** One run as it goes into the column — `WallCandidate` minus what is derived. */
export type StoredRun = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thicknessFeet: number;
  openings?: { widthFt: number }[];
};

/**
 * NO `lengthFeet`, although `WallCandidate` carries one.
 *
 * It is `hypot` of the centreline times the calibration, so writing it down
 * would let a stored length disagree with the geometry beside it — and on the
 * day they disagree the stored one would win silently, on a number somebody
 * bids. `WallCandidate.lengthFeet` says so itself: "the app computes its own
 * from the geometry and the live calibration."
 */
export function storedRunsOf(group: WallGroup): StoredRun[] {
  return group.runs.map((run) => {
    const stored: StoredRun = {
      x1: run.x1,
      y1: run.y1,
      x2: run.x2,
      y2: run.y2,
      thicknessFeet: run.thicknessFeet,
    };
    // Only when there are any: an empty array and an absent key both mean "no
    // openings", and the absent one does not invite a reader to believe
    // somebody measured and found none.
    if (run.openings !== undefined && run.openings.length > 0) {
      stored.openings = run.openings.map((opening) => ({ widthFt: opening.widthFt }));
    }
    return stored;
  });
}

/**
 * How a group's evidence is written down: the kind, the printed text, and the
 * designation that text names.
 *
 * THE DESIGNATION IS WHY THIS FUNCTION EXISTS rather than three inline fields
 * at the call site. For a TAG it is the tag. For a GENERAL_NOTE the printed
 * text is a sentence and the designation has to come from the type the note
 * resolved to — which the caller has while it still has the sheet, and nothing
 * reading the table ever will.
 */
export function evidenceOf(group: WallGroup): {
  source: "TAG" | "REMAINDER" | "GENERAL_NOTE";
  sourceLabel: string | null;
  namedCode: string | null;
} {
  if (group.source.kind === "TAG") {
    return { source: "TAG", sourceLabel: group.source.tag, namedCode: group.source.tag };
  }
  if (group.source.kind === "GENERAL_NOTE") {
    return {
      source: "GENERAL_NOTE",
      sourceLabel: group.source.note,
      // `wallGroups` puts exactly the note's type in `candidates`, so this is
      // that type's own code — read from the group rather than re-parsed out
      // of the sentence, which would be a second reader for one fact.
      namedCode: group.candidates[0]?.code ?? null,
    };
  }
  return { source: "REMAINDER", sourceLabel: null, namedCode: null };
}

const isFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The element shape, refused rather than coerced.
 *
 * REFUSED, NOT SALVAGED, and that is the decision worth stating. A half-read
 * group is worse than no group: the panel would show an estimator a shorter
 * wall than the drawing has, with nothing on screen to say a run was dropped.
 * Returning null makes the caller fall back to detecting the sheet again, which
 * is slow and correct.
 */
export function storedRunsOrNull(value: unknown): StoredRun[] | null {
  if (!Array.isArray(value)) return null;
  const out: StoredRun[] = [];
  for (const element of value) {
    if (element === null || typeof element !== "object") return null;
    const run = element as Record<string, unknown>;
    if (
      !isFinite(run.x1) ||
      !isFinite(run.y1) ||
      !isFinite(run.x2) ||
      !isFinite(run.y2) ||
      !isFinite(run.thicknessFeet)
    ) {
      return null;
    }
    // A zero or negative thickness is not a wall, and it reaches the thickness
    // bucket as a label nobody can read. `NaN` is already excluded above, which
    // is the case that would otherwise survive every comparison.
    if (run.thicknessFeet <= 0) return null;

    const stored: StoredRun = {
      x1: run.x1,
      y1: run.y1,
      x2: run.x2,
      y2: run.y2,
      thicknessFeet: run.thicknessFeet,
    };

    if (run.openings !== undefined) {
      if (!Array.isArray(run.openings)) return null;
      const openings: { widthFt: number }[] = [];
      for (const opening of run.openings) {
        if (opening === null || typeof opening !== "object") return null;
        const width = (opening as Record<string, unknown>).widthFt;
        if (!isFinite(width) || width <= 0) return null;
        openings.push({ widthFt: width });
      }
      if (openings.length > 0) stored.openings = openings;
    }

    out.push(stored);
  }
  // AN EMPTY ARRAY IS A REFUSAL. A group with no runs is not a group — it is a
  // row that would render as a 0 ft proposal of some wall type, which reads as
  // a finding rather than as the absence of one.
  return out.length === 0 ? null : out;
}

/** One row on its way INTO the table. */
export type NewProposalRow = {
  pageId: string;
  calibrationId: string;
  thicknessInches: number;
  source: "TAG" | "REMAINDER" | "GENERAL_NOTE";
  sourceLabel: string | null;
  namedCode: string | null;
  runs: StoredRun[];
};

/**
 * Every row one detection run writes, as a pure function.
 *
 * ── WHY THIS IS NOT INLINE IN THE DETECTOR, WHICH IS WHERE IT WAS ──
 *
 * `detectWallsForCalibration` needs a PDF and a database, so nothing can call
 * it in a unit test — and three mutations proved what that costs: writing every
 * group as a REMAINDER, writing the raw runs with their derived `lengthFeet`,
 * and writing rows for a detection that found nothing ALL left the suite green.
 * Not one of those is exotic; each is the sort of thing a careless edit does.
 *
 * Lifting the decision out gives it a caller a test can be, which is the same
 * move `fromBaseline` and `findWallsOnSheet` itself were made for. The detector
 * keeps the I/O and nothing else.
 */
export function proposalRowsFor(
  groups: readonly WallGroup[],
  at: { pageId: string; calibrationId: string },
): NewProposalRow[] {
  // AN EMPTY DETECTION WRITES NOTHING, and it is a decision rather than a
  // shortcut. A sheet with no walls on it — a schedule, a detail page, a site
  // plan — is a fact about the drawing, and a row recording "none" would be
  // indistinguishable from never having looked.
  return groups.map((group) => ({
    pageId: at.pageId,
    calibrationId: at.calibrationId,
    thicknessInches: group.inches,
    ...evidenceOf(group),
    runs: storedRunsOf(group),
  }));
}

/** One stored proposal row, as the page reads it back. */
export type ProposalRow = {
  thicknessInches: number;
  source: "TAG" | "REMAINDER" | "GENERAL_NOTE";
  sourceLabel: string | null;
  /** The designation the evidence names — see the column's own comment. */
  namedCode: string | null;
  runs: unknown;
};

/**
 * Back into the panel's own type, with every derived field recomputed.
 *
 * `feetPerUnit` comes from the calibration the row is KEYED to, so a
 * recalibration cannot reach these numbers — it writes a new calibration, and
 * rows under the old one are never read again.
 *
 * Returns null if ANY row fails to parse, for the same reason `storedRunsOrNull`
 * refuses a single run: a page showing three of its four groups looks exactly
 * like a page that has three.
 */
export function groupsFromProposals(
  rows: readonly ProposalRow[],
  wallTypes: readonly MatchableWallType[],
  feetPerUnit: number,
): WallGroup[] | null {
  const groups: WallGroup[] = [];
  for (const row of rows) {
    const runs = storedRunsOrNull(row.runs);
    if (runs === null) return null;
    if (!Number.isFinite(row.thicknessInches) || row.thicknessInches <= 0) return null;
    if (row.source !== "REMAINDER") {
      // A TAG with no tag, or a note with no words, cannot be RENDERED; a named
      // kind with no designation cannot be MATCHED. Both are the evidence for
      // those two kinds, so a row missing either is not a weaker finding — it
      // is an unreadable one, and showing it would put an unpriceable group in
      // a list whose whole purpose is pricing.
      if (row.sourceLabel === null || row.sourceLabel === "") return null;
      if (row.namedCode === null || row.namedCode === "") return null;
    }

    const candidates: WallCandidate[] = runs.map((run) => ({
      x1: run.x1,
      y1: run.y1,
      x2: run.x2,
      y2: run.y2,
      thicknessFeet: run.thicknessFeet,
      // RECOMPUTED FROM THE GEOMETRY AND THIS CALIBRATION, never read from the
      // column — see `storedRunsOf`.
      lengthFeet: Math.hypot(run.x2 - run.x1, run.y2 - run.y1) * feetPerUnit,
      ...(run.openings === undefined ? {} : { openings: run.openings }),
    }));

    const feet = candidates.reduce((sum, run) => sum + run.lengthFeet, 0);

    // THE MATCH, DERIVED AGAINST TODAY'S WALL TYPES. The two rules are the ones
    // `wallGroups` applies when it builds a group the first time, and they are
    // deliberately different: a TAG is an IDENTITY, so its candidates are
    // whatever carries that code and are never narrowed by thickness as well —
    // if the drawing says A1 and the company's A1 is on file at another
    // thickness, that is worth a person's attention rather than a silent drop.
    if (row.source === "TAG") {
      const tag = row.sourceLabel as string;
      const code = row.namedCode as string;
      groups.push({
        inches: row.thicknessInches,
        runs: candidates,
        feet,
        source: { kind: "TAG", tag },
        candidates: wallTypes.filter((type) => sameDesignation(type.code, code)),
      });
      continue;
    }

    if (row.source === "GENERAL_NOTE") {
      // THE TYPE THE NOTE NAMED, not every type of this thickness — which is
      // what `wallGroups` does when it builds this group the first time
      // (`candidates: [fromNote.type]`). Getting this wrong was caught by the
      // round-trip test rather than by reading: `typesAtThickness` here would
      // have offered an estimator a CHOICE on a group the drawing had already
      // answered, which reads as the detection having found less than it did.
      const note = row.sourceLabel as string;
      const code = row.namedCode as string;
      groups.push({
        inches: row.thicknessInches,
        runs: candidates,
        feet,
        source: { kind: "GENERAL_NOTE", note },
        candidates: wallTypes.filter((type) => sameDesignation(type.code, code)),
      });
      continue;
    }

    groups.push({
      inches: row.thicknessInches,
      runs: candidates,
      feet,
      source: { kind: "REMAINDER" },
      candidates: typesAtThickness(row.thicknessInches, wallTypes),
    });
  }
  return groups;
}

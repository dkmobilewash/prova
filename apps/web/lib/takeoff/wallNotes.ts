import { sameDesignation, type MatchableWallType } from "./wallTypeMatch";

/**
 * ── THE DRAWING ALREADY ANSWERED THE QUESTION THE PANEL WAS ASKING ──
 *
 * Reported from a click-through of School-01's A-101, 2026-10-11. The largest
 * group on the sheet — 29 runs, 577 ft, about 30% of its footage — carried no
 * tag, so the panel asked "which type?" and offered A1, A2 or C1 as equals.
 *
 * General Note 1 on that same sheet reads:
 *
 *     1. ALL PARTITIONS TYPE A1 U.N.O.
 *
 * `U.N.O.` is "unless noted otherwise", and it is the convention that makes an
 * UNTAGGED wall meaningful rather than unknown: the architect tags the
 * exceptions and lets the note cover the rest. An estimator who picked A2 from
 * that dropdown would have mis-priced the biggest group on the sheet, and the
 * app offered it as an equally good answer.
 *
 * ── WHY THIS IS SAFE TO READ, WHICH IS THE WHOLE DESIGN ──
 *
 * Two independent facts have to agree before a note names anything:
 *
 *   1. the note has to name a code THE COMPANY ACTUALLY HAS. A sheet note
 *      saying "ALL PARTITIONS SEE A-501" mentions `A-501`, which is a sheet
 *      number; it is not a wall type, so nothing matches and nothing is
 *      proposed. The library is the filter, and it costs nothing to apply.
 *
 *   2. the GROUP'S MEASURED THICKNESS has to match that type — enforced by the
 *      caller, in `wallGroups`. Without it, "ALL PARTITIONS ARE A1" would
 *      swallow the 6-5/8" exterior walls and the 10-1/4" chase, which are
 *      exactly the walls the "unless noted otherwise" is excusing. A different
 *      thickness IS a notation.
 *
 * And nothing is applied: the group is PROPOSED as that type with the note
 * quoted beside it, and a person presses the button. Same posture as the scale
 * prefill, the sheet index and every tag match.
 */

/** A text item as the sheet reader returns it — only the string is read here. */
export type NoteTextItem = { str: string };

export type WallTypeFromNote = {
  /** The company's type the note names. */
  type: MatchableWallType;
  /** The note itself, verbatim, so the screen can quote its evidence. */
  note: string;
};

/**
 * `ALL PARTITIONS …` in the forms architects write it.
 *
 * Deliberately anchored on ALL + PARTITION. Without the `ALL` this matches
 * "2. SEE A-501 FOR PARTITION TYPES", which names a sheet rather than a
 * default — measured on the same set, where that note sits directly under the
 * one this reads.
 */
const ALL_PARTITIONS = /\bALL\s+(?:INTERIOR\s+|NEW\s+)?PARTITIONS?\b/i;

/** Anything shaped like a wall-type designation: `A1`, `A-1`, `EXT-2`, `C1A`. */
const DESIGNATION = /\b[A-Z]{1,4}[-\s]?\d{1,3}[A-Z]?\b/gi;

/**
 * The wall type a sheet's general notes make the default, or null.
 *
 * Returns the FIRST note that names a type the company has. A sheet with two
 * such notes is a contradiction the drawing itself carries, and picking the
 * first is no worse than picking the second — but it is worth knowing that
 * nothing here detects that case.
 */
export function defaultWallTypeFromNotes(
  items: readonly NoteTextItem[],
  wallTypes: readonly MatchableWallType[],
): WallTypeFromNote | null {
  if (wallTypes.length === 0) return null;
  for (const item of items) {
    const note = item.str.trim();
    if (!ALL_PARTITIONS.test(note)) continue;
    // `matchAll` rather than a single match: "ALL PARTITIONS TYPE A1 U.N.O."
    // has one candidate, but a wordier note can mention a sheet before the
    // type, and the library is what decides between them.
    for (const [code] of note.matchAll(DESIGNATION)) {
      const type = wallTypes.find((one) => sameDesignation(one.code, code));
      if (type) return { type, note };
    }
  }
  return null;
}

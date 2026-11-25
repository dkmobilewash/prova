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
  /**
   * Further defaults the legend names for OTHER thicknesses — Joplin's
   * "all interior masonry partitions are type 'B'" beside its drywall 'A'.
   * `wallGroups` picks, per thickness cluster, the one whose thickness covers it.
   */
  others?: WallTypeFromNote[];
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
  // ── THE LEGEND'S OWN U.N.O., WHEN THE SHEET SAYS NOTHING ──
  // Joplin prints the sentence on the partition sheet, not on the floor plan,
  // so it reaches here on the type (`unoNote`). More than one — drywall A,
  // masonry B — are kept together; the thickness decides which covers a run.
  const fromLegend = wallTypes.filter((one) => typeof one.unoNote === "string" && one.unoNote.trim() !== "").map((type) => ({ type, note: type.unoNote! }));
  if (fromLegend.length === 0) return null;
  const [first, ...others] = fromLegend;
  return others.length > 0 ? { ...first!, others } : first!;
}

// ── prereg-uno-default-type.md (TAKEOFF_UNO_DEFAULT; unset = today exactly) ──
//
// The reader above needs the code in the company's library, and on a set read
// with no legend that library is empty, so a sheet's own "ALL PARTITIONS TO BE
// TYPE 'S4' UNLESS NOTED OTHERWISE" reached nothing (training census: 114026,
// Wendell, Baker). This reads the sentence itself and lets its code stand in as
// the type. The U.N.O. is REQUIRED here (it is what makes the code a default
// rather than a mention), the code must look like a designation, and a sheet or
// set naming two different defaults (Topeka: P1 interior, P30 exterior) gives
// none — with no legend there is no thickness to say which wall is which.

export const UNO_DEFAULT_ON = () => process.env.TAKEOFF_UNO_DEFAULT === "1";

const QUOTE = `['"‘’“”]?`;
/** "ALL [INTERIOR] PARTITIONS TO BE [TYPE] 'S4' … UNLESS NOTED", or Baker's "… WALL ASSEMBLY TYPE TO BE S6B UNLESS NOTED". */
const UNO_SENTENCE = new RegExp(
  `\\b(?:(?:ALL|TYPICAL)\\s+(?:[A-Z/-]+\\s+){0,3}?(?:PARTITIONS?|WALLS?)|WALL\\s+ASSEMBLY)\\s+(?:TYPE\\s+)?(?:SHALL\\s+BE|TO\\s+BE|ARE|IS)\\s+(?:WALL\\s+)?(?:TYPE\\s+)?${QUOTE}([A-Z0-9][A-Z0-9.-]{0,6}?)${QUOTE}(?=[\\s,.]|$)[^.]{0,80}?(?:U\\.?\\s?N\\.?\\s?O\\b|UNLESS\\s+(?:OTHERWISE\\s+)?NOTED)`,
  "i",
);
const DESIGNATION_CODE = /^[A-Z]{1,4}-?\d{1,3}[A-Z]?$/;

/** Each a named check with a test: what a captured word must not be to count as a wall type. */
export const UNO_CODE_GUARDS: { name: string; refuses: (code: string) => boolean }[] = [
  { name: "not a designation", refuses: (c) => !DESIGNATION_CODE.test(c) },
  { name: "sheet reference", refuses: (c) => /^[A-Z]{1,2}-?\d{3,}/.test(c) },
];

export type UnoDefault = { code: string; note: string };

/** Rows of a page's text, top to bottom, each read left to right. */
function rows(items: readonly { str: string; x: number; y: number }[]): string[] {
  const byRow = new Map<number, { str: string; x: number }[]>();
  for (const i of items) {
    const k = Math.round(i.y / 4);
    byRow.set(k, [...(byRow.get(k) ?? []), i]);
  }
  return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
}

/** Every U.N.O. default a page prints, one per distinct code (a sentence wrapped onto a second row included). */
export function unoDefaults(items: readonly { str: string; x: number; y: number }[]): UnoDefault[] {
  const lines = rows(items);
  const found = new Map<string, UnoDefault>();
  lines.forEach((line, i) => {
    for (const text of [line, `${lines[i - 1] ?? ""} ${line}`]) {
      const m = UNO_SENTENCE.exec(text);
      if (m === null) continue;
      const code = m[1]!.toUpperCase();
      if (UNO_CODE_GUARDS.some((g) => g.refuses(code)) || found.has(code)) continue;
      found.set(code, { code, note: m[0].trim() });
    }
  });
  return [...found.values()];
}

/**
 * The default a sheet works to: its own, else the set's — and only when exactly one code is named.
 * The library's type when it has the code (its thickness then limits which walls it covers),
 * else the code standing in as a type with no thickness.
 */
export function unoDefaultType(
  sheet: readonly UnoDefault[],
  set: readonly UnoDefault[] | null,
  wallTypes: readonly MatchableWallType[],
): WallTypeFromNote | null {
  const named = sheet.length > 0 ? sheet : (set ?? []);
  if (named.length !== 1) return null;
  const { code, note } = named[0]!;
  const type = wallTypes.find((one) => sameDesignation(one.code, code)) ?? { id: `uno:${code}`, code, name: code, hasParts: false, thicknessIn: null };
  return { type, note };
}

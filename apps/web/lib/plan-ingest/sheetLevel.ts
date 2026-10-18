/**
 * ── WHICH FLOOR A QUANTITY IS ON, READ OFF THE SHEET'S OWN TITLE ──
 *
 * Step 3 of an estimator's day is "tag measurements by phase, floor level,
 * building, scope zone". #694 gave a measurement its PRICING PACKAGE — base bid
 * against an alternate. The other axis is the floor, and it is still typed by
 * hand or not recorded at all.
 *
 * The drawing already says it. A sheet titled `LEVEL 01 - OVERALL FLOOR PLAN`
 * or `FIRST FLOOR PLAN` names its floor in the title block, and every
 * measurement knows which sheet it was traced on.
 *
 * ── IT READS THE TITLE, NOT THE TITLE BLOCK ──
 *
 * This is the whole correctness argument and it was nearly got wrong. A probe
 * over five real sets matched a level in `titleBlockText()` — the whole corner
 * region — on 25 of 31 Augusta plan sheets, which looked like a result. Reading
 * what it had actually matched:
 *
 *     Naples p8   "SCOPE OF WORK FOR THE FIRST FLOOR AREA WILL BE NIGHT WORK"
 *     SRFR p3     "CIENCY PACKAGE OPTIONS & NEW) LEVEL 1 THE FOLLOWING…"
 *     SRFR p5     "(E) MAINTENANCE BAY FLOOR LEVEL 1  3,244 TOTAL"
 *
 * General notes and a schedule row. The LEVEL they returned happened to be
 * right, which is worse than being wrong: a rule that works by luck on the
 * sheets you tried is a rule that mislabels a quantity on the one you did not.
 * A sheet whose notes mention the second floor while the sheet itself draws the
 * first would be tagged confidently and wrongly, and nothing downstream could
 * tell.
 *
 * So this takes the EXTRACTED TITLE — `proposedTitle`, or `acceptedTitle` where
 * somebody has corrected it — which is one short string naming what the sheet
 * is. Nothing else on the page can reach it.
 *
 * ── AND ONLY ON A PLAN ──
 *
 * `FIRST FLOOR` in an elevation's title names what is DRAWN in it, not where
 * the sheet's quantities live, and a detail sheet mentioning a level is
 * referring somewhere rather than describing itself. The caller passes the page
 * type; anything but `PLAN` gets no level.
 */

/** A floor, with an order so a list sorts the way a building stacks. */
export type SheetLevel = {
  /** What the drawing called it, tidied — `Level 1`, `Roof`, `Basement`. */
  label: string;
  /** Basement below ground below the numbered floors below the roof. */
  order: number;
};

/** Floors that have a name rather than a number, and where they sit. */
const NAMED: readonly (readonly [RegExp, string, number])[] = [
  [/\bSUB[- ]?BASEMENT\b/, "Sub-basement", -200],
  [/\bBASEMENT\b/, "Basement", -100],
  [/\bCELLAR\b/, "Cellar", -100],
  [/\bGROUND\s+(?:FLOOR|LEVEL)\b/, "Ground floor", 0],
  [/\bPENTHOUSE\b/, "Penthouse", 900],
  [/\bROOF\b/, "Roof", 1000],
];

/** Words a drawing uses for the first few floors. */
const ORDINALS: Readonly<Record<string, number>> = {
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  FOURTH: 4,
  FIFTH: 5,
  SIXTH: 6,
  SEVENTH: 7,
  EIGHTH: 8,
  NINTH: 9,
  TENTH: 10,
};

/** `LEVEL 2`, `LVL 02`, `FLOOR 3`, `L2` — a number after a floor word. */
const NUMBERED = /\b(?:LEVEL|LVL|FLOOR)\s*0*([1-9][0-9]?)\b/;
/** `2ND FLOOR`, `3RD LEVEL`. */
const ORDINAL_DIGIT = /\b0*([1-9][0-9]?)(?:ST|ND|RD|TH)\s+(?:FLOOR|LEVEL)\b/;
/** `FIRST FLOOR`, `SECOND LEVEL`. */
const ORDINAL_WORD = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+(?:FLOOR|LEVEL)\b/;

/** How many distinct floors a title names. Two means it covers both. */
function floorsNamed(text: string): number {
  const floors = new Set<number>();
  for (const pattern of [/\b(?:LEVEL|LVL|FLOOR)\s*0*([1-9][0-9]?)\b/g, /\b0*([1-9][0-9]?)(?:ST|ND|RD|TH)\s+(?:FLOOR|LEVEL)\b/g]) {
    for (const m of text.matchAll(pattern)) floors.add(Number(m[1]));
  }
  // `FIRST & SECOND FLOOR` and `1ST & 2ND FLOOR` — the FIRST of the pair has
  // no floor word after it, which is exactly why the single-match rule reads
  // either as the second floor alone.
  //
  // THIS USED TO BE GUARDED by "only when a floor word is somewhere about", to
  // stop `FIRST ISSUE` counting. Mutation showed the guard could not change a
  // single outcome and it was deleted: a bare ordinal only ever raises this
  // count, a count above one only ever DECLINES, and with no floor word in the
  // title nothing below matches anyway — so the answer was null either way. A
  // guard that cannot change an answer is a line that has to be read and
  // understood forever for nothing.
  for (const m of text.matchAll(/\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\b/g)) {
    const n = ORDINALS[m[1]];
    if (n !== undefined) floors.add(n);
  }
  for (const m of text.matchAll(/\b0*([1-9][0-9]?)(?:ST|ND|RD|TH)\b/g)) floors.add(Number(m[1]));
  return floors.size;
}

/**
 * The floor a sheet's title names, or null.
 *
 * `pageType` comes from the stored proposal. Null is treated as "not known to
 * be a plan" and gets no level: a sheet nobody has classified yet is not a
 * sheet to start tagging quantities from.
 */
export function levelFromTitle(title: string | null, pageType: string | null): SheetLevel | null {
  if (pageType !== "PLAN") return null;
  const text = (title ?? "").toUpperCase();
  if (text.trim() === "") return null;

  // ROOF BEFORE THE NUMBERED FLOORS, because `ROOF PLAN - LEVEL 2` is a roof
  // and `LEVEL 2 ROOF PLAN` is the same sheet written the other way round.
  // Taking the number first would file a roof among the occupied floors, where
  // its quantities are a different trade entirely.
  for (const [pattern, label, order] of NAMED) {
    if (pattern.test(text)) return { label, order };
  }

  // A MEZZANINE SITS BETWEEN TWO FLOORS, so it is half a storey above the one
  // it belongs to — `LEVEL 3 MEZZANINE` is above level 3 and below level 4. A
  // flat order for every mezzanine put it above every numbered floor, which
  // sorted a ground-floor mezzanine above the top storey.
  if (/\bMEZZANINE\b/.test(text)) {
    const floor = NUMBERED.exec(text) ?? ORDINAL_DIGIT.exec(text);
    const word = ORDINAL_WORD.exec(text);
    const below = floor ? Number(floor[1]) : word ? ORDINALS[word[1]] : 1;
    return { label: below === 1 ? "Mezzanine" : `Level ${below} mezzanine`, order: below + 0.5 };
  }

  // A SHEET COVERING TWO FLOORS GETS NO LEVEL. Naples prints `ARCHITECTURAL
  // PLAN - FIRST & SECOND FLOOR`, and taking the last floor named would tag
  // every quantity on it to the second — confidently, and wrong for half of
  // them. Declining leaves the estimator to split it, which is the work they
  // would have to do anyway and now know about.
  if (floorsNamed(text) > 1) return null;

  const numbered = NUMBERED.exec(text) ?? ORDINAL_DIGIT.exec(text);
  if (numbered) {
    const floor = Number(numbered[1]);
    return { label: `Level ${floor}`, order: floor };
  }

  const word = ORDINAL_WORD.exec(text);
  if (word) {
    const floor = ORDINALS[word[1]];
    return { label: `Level ${floor}`, order: floor };
  }

  return null;
}

/** A sheet as the review screen stores it, for levelling. */
export type LevelledSheet = {
  pageNumber: number;
  proposedTitle: string | null;
  acceptedTitle: string | null;
  /**
   * NO `acceptedPageType`, and that is the schema rather than an omission here:
   * `PlanSheetProposal` lets somebody correct the sheet NUMBER and the TITLE
   * and nothing else. So a plan the model filed as a DETAIL cannot be put right
   * by a person, and its quantities get no level however the title reads.
   *
   * Left as it is rather than worked around. The alternative — trusting the
   * title when the page type disagrees — would hand a level to every elevation
   * and section whose title names a floor, which is the thing this file refuses
   * on purpose.
   */
  proposedPageType: string | null;
};

/**
 * The level for each page of a set, by page number.
 *
 * THE ACCEPTED VALUES WIN, the same way `effectiveSheetNumber` reads them on
 * the screen: somebody who corrected a misread title has said what the sheet
 * is, and tagging quantities from the machine's superseded guess would be
 * ignoring them twice.
 *
 * AND THE FIRST ROW PER PAGE WINS, which is the same contract
 * `printedScalesFromProposals` has: a page accumulates a proposal per ingest
 * run, callers hand them over newest-first, and keeping the first seen is what
 * makes the newest the one that counts. Overwriting as it goes would quietly
 * read the OLDEST reading of every sheet.
 */
export function levelsByPage(sheets: readonly LevelledSheet[]): Map<number, SheetLevel> {
  const levels = new Map<number, SheetLevel>();
  for (const sheet of sheets) {
    const level = levelFromTitle(sheet.acceptedTitle ?? sheet.proposedTitle, sheet.proposedPageType);
    if (level && !levels.has(sheet.pageNumber)) levels.set(sheet.pageNumber, level);
  }
  return levels;
}

/** Levels in building order, each with how many sheets carry it. */
export function levelSummary(levels: Map<number, SheetLevel>): { level: SheetLevel; sheets: number }[] {
  const counts = new Map<string, { level: SheetLevel; sheets: number }>();
  for (const level of levels.values()) {
    const seen = counts.get(level.label);
    if (seen) seen.sheets += 1;
    else counts.set(level.label, { level, sheets: 1 });
  }
  return [...counts.values()].sort((a, b) => a.level.order - b.level.order);
}

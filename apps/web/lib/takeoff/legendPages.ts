/**
 * ── FINDING THE SHEET THAT DEFINES THE WALL TYPES ──
 *
 * `SCHEDULE_ROWS` reads a partition schedule when there is one, and across the
 * five real sets there is not one: measured 2026-10-20, the only partition
 * legend in any of them is Camp Bow Wow A130, titled PARTITION TYPES and drawn
 * as five DETAILS side by side. `planSheets`' own prompt types a page like
 * that as OTHER — "OTHER for anything else, including a legend" — so the
 * schedule stage correctly never runs on it, and the information sits there
 * unread.
 *
 * So a legend is found by what it IS rather than by being a table:
 *
 *   - its title says PARTITION, WALL TYPE or ASSEMBLY; or
 *   - it carries a crowd of small wall-section details with assembly notes —
 *     studs, board, insulation, spacings — which is what a legend drawn as
 *     details looks like from the text alone.
 *
 * The second test exists because the first is not enough: an office that
 * titles the sheet `A130` and nothing else still draws the same legend.
 *
 * ── THIS FILE DECIDES WHERE TO LOOK, NOT WHAT THE TEXT MEANS ──
 *
 * Which codes exist and what each is made of is text interpretation and goes
 * to the model, once per set. Narrowing three hundred pages to one is a
 * counting job, and doing it here is what makes that call affordable.
 */

/** Words in a sheet title that name a partition legend outright. */
const TITLE_SAYS =
  /\b(?:PARTITION|WALL)\s+(?:TYPE|TYPES|SCHEDULE|ASSEMBL(?:Y|IES)|LEGEND)\b|\bPARTITION\s+DETAILS?\b|\bWALL\s+ASSEMBL(?:Y|IES)\b/i;

/** Phrases that only appear where an assembly is being described. */
const ASSEMBLY_WORDS = [
  /\bSTUDS?\b/i,
  /\bGYP\.?(?:SUM)?\b|\bGWB\b|\bG\.?W\.?B\.?\b/i,
  /\bO\.?\s*C\.?\b|\bON\s+CENTER\b/i,
  /\bBATTS?\b|\bINSULATION\b/i,
  /\bTYPE\s*['"]?X\b/i,
  /\bTRACK\b|\bRUNNER\b/i,
  /\bRATED\b|\bUL\b|\bSTC\b/i,
];

/**
 * How many assembly phrases a page needs before it counts as a legend on the
 * strength of its content alone.
 *
 * Deliberately high. Measured across Camp Bow Wow and ELEVEN03: a wall SECTION
 * sheet names studs and board too — p22 and p28 carry a dozen such lines each
 * — and a UL firestop sheet names them fifty times. The number is not what
 * separates a legend from those; the TITLE is, which is why content alone has
 * to clear a bar high enough that it rarely fires on its own.
 */
export const ASSEMBLY_LINES_FOR_LEGEND = 12;

/**
 * How many assembly lines a page needs when its TITLE already says it is a
 * legend.
 *
 * ── A COVER SHEET'S INDEX NAMES EVERY SHEET IN THE SET ──
 *
 * Found by running this against Camp Bow Wow: page 1 came first, because its
 * drawing index lists "PARTITION TYPES" as the name of sheet A130. The model
 * read it and said so — "PARTITION TYPES appears only as the name of another
 * sheet in the drawing index, so no wall assemblies are defined here" — which
 * cost a call to learn something the page itself could have been asked.
 *
 * A sheet that IS a legend both says so and describes assemblies. A sheet that
 * merely mentions the words does one or the other. Three lines is enough to
 * tell them apart and low enough that a terse legend still qualifies.
 */
export const ASSEMBLY_LINES_WITH_TITLE = 3;

/**
 * ── A LEGEND DRAWN AS A BLOCK ON ANOTHER SHEET HAS A HEADING, NOT A TITLE ──
 *
 * Measured 2026-10-20 on the twelve new sets. Three of them put the partition
 * types in a block on a sheet whose title says something else: Bunkie's G003
 * (title block reads SECTION VIEW), MHK's A1.01 FIRST FLOOR PLAN, and
 * Crosslines' A001 general-notes sheet. Each block is headed `WALL TYPES` or
 * `Partiton Types` — Crosslines spells it that way on the drawing, which is
 * why the pattern tolerates a dropped letter — and each ranked below a
 * mechanical schedule or an exterior-detail sheet that merely says STUD and
 * GYP more often. The model was sent to M601 and A314 and came back empty.
 *
 * A heading is a text cell that IS the phrase, not one that contains it:
 * `REFER TO WALL TYPES` on a section sheet is a pointer, not a legend. And a
 * cover sheet's index prints `WALL TYPES` as a sheet name beside zero assembly
 * lines, which is why a heading needs more assembly lines behind it than a
 * title does and fewer than content alone.
 */
export const ASSEMBLY_LINES_WITH_HEADING = 6;
const BLOCK_HEADING =
  /^(?:\d+\s+)?(?:PARTI[TI]*ON|WALL)\s+TYPES?(?:\s+(?:LEGEND|SCHEDULE|DETAILS?))?$|^(?:PARTI[TI]*ON|WALL)\s+(?:LEGEND|SCHEDULE)$/i;

/**
 * ── A TRADE'S SHEET IS NOT WHERE THE PARTITIONS ARE DEFINED ──
 *
 * Crosslines' M601 MECHANICAL SCHEDULES and P601 PLUMBING SCHEDULES describe
 * pipe insulation TYPE 1 to 6 and out-rank its A001 on assembly words alone;
 * MHK's S0.01 structural notes do the same. A sheet whose number starts with
 * M, P, E, FP, S or C is an engineer's, and the partition legend is on an
 * architectural or general sheet. Demoted below every architectural
 * candidate rather than dropped, so a set with nothing else still gets a try.
 */
const TRADE_SHEET = /^(M|P|E|FP|S|C|T|MEP)-?\d[\d.]*\b/i;
const TRADE_SHEET_DEMOTION = 10;

export type LegendCandidate = {
  page: number;
  /** Why this page was picked, in words a person can check. */
  why: string;
  /**
   * 0 a titled legend, 1 a headed block, 2 content alone, 3 a named but empty
   * page — plus `TRADE_SHEET_DEMOTION` for an engineer's sheet. Lower first.
   */
  rank: number;
  /** How many of the page's lines describe an assembly; breaks ties in rank. */
  assemblyLines: number;
};

export type PageForLegend = {
  page: number;
  /** The sheet's title, where one has been read. */
  title: string | null;
  /** Every line of the page's text. */
  lines: readonly string[];
};

/**
 * The pages of a set that could define its wall types, best first.
 *
 * Returns ALL candidates rather than one: a set may legend its partitions on
 * one sheet and its shaft walls on another, and picking the first silently
 * loses the second. The caller decides how many to spend a model call on.
 */
export function legendPages(pages: readonly PageForLegend[]): LegendCandidate[] {
  const out: LegendCandidate[] = [];
  for (const page of pages) {
    const title = (page.title ?? "").replace(/\s+/g, " ").trim();
    const titleHit = title === "" ? null : title.match(TITLE_SAYS);
    const trade = title.match(TRADE_SHEET);
    const demoted = trade === null ? 0 : TRADE_SHEET_DEMOTION;
    const tradeNote = trade === null ? "" : `; sheet ${trade[0]} is a ${trade[1].toUpperCase()}-series sheet, so it is tried last`;
    let assemblyLines = 0;
    let heading: string | null = null;
    for (const line of page.lines) {
      if (ASSEMBLY_WORDS.some((re) => re.test(line))) assemblyLines += 1;
      if (heading === null) {
        const cell = line.split("|").map((c) => c.trim()).find((c) => BLOCK_HEADING.test(c));
        if (cell !== undefined) heading = cell;
      }
    }

    if (titleHit !== null && assemblyLines >= ASSEMBLY_LINES_WITH_TITLE) {
      out.push({
        page: page.page,
        why: `the title says "${titleHit[0]}" and ${assemblyLines} lines describe an assembly${tradeNote}`,
        rank: 0 + demoted,
        assemblyLines,
      });
      continue;
    }
    if (heading !== null && assemblyLines >= ASSEMBLY_LINES_WITH_HEADING) {
      out.push({
        page: page.page,
        why: `a block on the sheet is headed "${heading}" and ${assemblyLines} lines describe an assembly${tradeNote}`,
        rank: 1 + demoted,
        assemblyLines,
      });
      continue;
    }
    if (assemblyLines >= ASSEMBLY_LINES_FOR_LEGEND) {
      out.push({
        page: page.page,
        why: `${assemblyLines} lines describe an assembly, and the title does not say what the sheet is${tradeNote}`,
        rank: 2 + demoted,
        assemblyLines,
      });
      continue;
    }
    if (titleHit !== null) {
      // Named but empty — an index entry, almost always. Reported last rather
      // than dropped: a legend whose text layer failed looks like this too,
      // and silently losing it would be the worse error.
      out.push({
        page: page.page,
        why: `the title says "${titleHit[0]}" but only ${assemblyLines} lines describe an assembly — probably an index entry${tradeNote}`,
        rank: 3 + demoted,
        assemblyLines,
      });
    }
  }
  // ── WITHIN A RANK, THE PAGE THAT SAYS MOST ABOUT ASSEMBLIES COMES FIRST ──
  //
  // Measured 2026-10-20 on the sets whose title block does not carry the
  // sheet name: SLN's A-002 PARTITION TYPES (21 lines) sorted behind its
  // A-001 general notes (12 lines) on page order alone, and the one model
  // call went to the notes and came back empty. Page order is kept only as
  // the last tie-break.
  return out.sort((a, b) => a.rank - b.rank || b.assemblyLines - a.assemblyLines || a.page - b.page);
}

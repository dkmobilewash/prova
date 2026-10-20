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

export type LegendCandidate = {
  page: number;
  /** Why this page was picked, in words a person can check. */
  why: string;
  /** Title first, content second — a titled legend is the better witness. */
  rank: number;
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
    let assemblyLines = 0;
    for (const line of page.lines) {
      if (ASSEMBLY_WORDS.some((re) => re.test(line))) assemblyLines += 1;
    }

    if (titleHit !== null && assemblyLines >= ASSEMBLY_LINES_WITH_TITLE) {
      out.push({
        page: page.page,
        why: `the title says "${titleHit[0]}" and ${assemblyLines} lines describe an assembly`,
        rank: 0,
      });
      continue;
    }
    if (assemblyLines >= ASSEMBLY_LINES_FOR_LEGEND) {
      out.push({
        page: page.page,
        why: `${assemblyLines} lines describe an assembly, and the title does not say what the sheet is`,
        rank: 1,
      });
      continue;
    }
    if (titleHit !== null) {
      // Named but empty — an index entry, almost always. Reported last rather
      // than dropped: a legend whose text layer failed looks like this too,
      // and silently losing it would be the worse error.
      out.push({
        page: page.page,
        why: `the title says "${titleHit[0]}" but only ${assemblyLines} lines describe an assembly — probably an index entry`,
        rank: 2,
      });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.page - b.page);
}

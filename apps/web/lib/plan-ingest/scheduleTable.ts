import type { PlanPageText, PlanTextItem } from "./planPdf";

/**
 * A SCHEDULE IS A TABLE, AND A TABLE IS GEOMETRY — so code recovers the grid and
 * the model only reads what the cells MEAN.
 *
 * `PlanPageText.items` is a flat list of strings with x/y/width/height in points.
 * A door schedule on a drawing is thirty of those per row and no row structure at
 * all: pdfjs reports "101", "3'-0\"", "7'-0\"", "HM", "A" as five unrelated items
 * that happen to share a y. Handing that list to a model and asking for rows is
 * asking it to do arithmetic on coordinates, which is the one thing
 * ARCHITECTURE.md says never to delegate — *the arithmetic underneath stays
 * deterministic code and the model only narrates what it is handed.*
 *
 * So this file is the deterministic half. It answers "which strings are on the
 * same row, and in what order" from position alone, and it can be tested to the
 * character without a model, a database or a PDF. What the model is then given is
 * a clean grid, and what it is asked is a question only a person could answer:
 * which column is the door mark, which is the width, is this row a header.
 *
 * NOTHING HERE KNOWS WHAT A SCHEDULE IS. It does not look for the word "DOOR",
 * does not guess at columns and does not drop anything. A legend, a general-notes
 * sheet and a door schedule all come out as rows of cells; whether the page is a
 * schedule at all was decided upstream by `proposedPageType`.
 */

/** One row of a reconstructed table: the cells in reading order, left to right. */
export type TableRow = {
  /** Points from the top of the page, so a reader can find the row on the sheet. */
  y: number;
  cells: string[];
};

/**
 * HOW CLOSE TWO ITEMS' BASELINES MUST BE TO COUNT AS ONE ROW, as a fraction of
 * the taller item's height.
 *
 * Not an absolute number of points, because a 36-inch sheet's schedule is set in
 * larger type than a letter-size one and a fixed tolerance would merge two rows
 * on one and split one row on the other. 0.6 of the line height is wide enough
 * for the baseline jitter of a cell whose text is a different size — a 1/4"
 * fraction set smaller than its row — and narrower than the gap to the next row,
 * which in every schedule set by hand or by CAD is at least one line height.
 */
const ROW_TOLERANCE = 0.6;

/**
 * HOW WIDE A GAP SEPARATES TWO CELLS rather than two words of one cell, as a
 * fraction of the character width around it.
 *
 * A space inside "HOLLOW METAL" is one character wide. The gap between two
 * columns of a schedule is several. 1.5 characters splits those and does not
 * split "3'-0\" x 7'-0\"", which is the value this had to be chosen against:
 * that string is ONE cell, and a tolerance of 1.0 cut it into three.
 */
const CELL_GAP_CHARS = 1.5;

/** Text with no ink in it is not a cell. */
function hasInk(item: PlanTextItem): boolean {
  return item.str.trim().length > 0;
}

/**
 * Group a page's text into rows, then each row into cells.
 *
 * Deliberately tolerant of a page that is not a table: a sheet of prose comes
 * back as rows of long cells, which is true and useless rather than wrong.
 */
export function tableRowsFromPage(page: PlanPageText): TableRow[] {
  const items = page.items.filter(hasInk);
  if (items.length === 0) return [];

  // Sorted top-to-bottom first, so a row's members are adjacent and one pass
  // builds the groups. Ties broken by x, which also leaves each row's cells in
  // reading order before the gap pass looks at them.
  const sorted = [...items].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  const groups: PlanTextItem[][] = [];
  let current: PlanTextItem[] = [sorted[0]];
  for (const item of sorted.slice(1)) {
    const previous = current[current.length - 1];
    const tolerance = Math.max(previous.height, item.height) * ROW_TOLERANCE;
    // Compared against the group's FIRST member, not the previous one: a row of
    // twelve cells whose baselines each drift a little would otherwise walk into
    // the next row one cell at a time.
    const anchor = current[0];
    if (Math.abs(item.y - anchor.y) <= tolerance) {
      current.push(item);
    } else {
      groups.push(current);
      current = [item];
    }
  }
  groups.push(current);

  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    return { y: ordered[0].y, cells: cellsFromRow(ordered) };
  });
}

/** Join the items of one row into cells, splitting where the gap is wide. */
function cellsFromRow(ordered: PlanTextItem[]): string[] {
  const cells: string[] = [];
  let buffer = ordered[0].str.trim();
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const item = ordered[i];
    const gap = item.x - (previous.x + previous.width);
    // The character width of the NARROWER neighbour, so a large-type heading
    // beside small-type text does not make every gap look small. Guarded
    // against a zero-length string, which pdfjs can report for a positioning
    // item that carries no glyphs.
    const charWidths = [previous, item]
      .map((candidate) => (candidate.str.length > 0 ? candidate.width / candidate.str.length : 0))
      .filter((width) => width > 0);
    const charWidth = charWidths.length > 0 ? Math.min(...charWidths) : 0;
    if (charWidth > 0 && gap > charWidth * CELL_GAP_CHARS) {
      cells.push(buffer);
      buffer = item.str.trim();
    } else {
      // One cell whose text pdfjs split into several items. A single space, so
      // "HOLLOW" + "METAL" reads as one value rather than as "HOLLOWMETAL".
      buffer = `${buffer} ${item.str.trim()}`.trim();
    }
  }
  cells.push(buffer);
  return cells.filter((cell) => cell.length > 0);
}

/**
 * The grid as the model is given it: one row per line, cells separated by a pipe.
 *
 * A PIPE RATHER THAN A TAB OR TWO SPACES, because the cell values themselves
 * contain spaces, quotes and inch marks — `3'-0" x 7'-0"` — and a separator a
 * value can contain is a separator that lies about where a cell ends. A pipe
 * appears in no schedule this product has seen; if one ever does, the cell is
 * escaped rather than the format changed.
 */
export function gridText(rows: readonly TableRow[]): string {
  return rows.map((row) => row.cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")).join("\n");
}

/**
 * Is there enough of a grid here to be worth a model call?
 *
 * THE POINT OF THIS IS MONEY, not correctness. A page typed SCHEDULE by the
 * title-block reader might be a cover sheet that says "SCHEDULES" in its index,
 * and sending a page of prose to a model to be told it holds no schedule costs
 * the same as sending a real one. A table has SEVERAL ROWS OF SEVERAL CELLS;
 * prose has many rows of one.
 *
 * Deliberately generous — two columns and three rows — because refusing a real
 * schedule is far worse than paying for one wasted call: the first is a silent
 * gap in a bid and the second is a few cents.
 */
export function looksLikeTable(rows: readonly TableRow[]): boolean {
  const multiCell = rows.filter((row) => row.cells.length >= 2);
  return multiCell.length >= 3;
}

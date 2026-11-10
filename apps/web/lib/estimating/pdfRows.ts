import { isHeaderRow } from "./priceList";

type Item = { str: string; x: number; y: number; width: number; height: number };
type Cell = { text: string; x: number; end: number };

/**
 * A PDF page's text items into table rows. Items on one baseline are a row; two items closer than
 * about a space apart are one cell ("Steel" "Stud" "25" "GA" is one description, not four columns).
 *
 * THEN EVERY CELL IS PUT UNDER THE HEADER COLUMN IT SITS BENEATH. A PDF has no empty cells: a quote
 * row with no size simply has nothing printed there, so reading cells left to right shifts every
 * column after the gap — the extended price lands in the unit-price column. Measured on the fixture
 * before this existed: compound priced at $4.16/lb from its $256.80 extension. Text layer only.
 */
export function pdfRows(items: readonly Item[]): string[][] {
  const lines = new Map<number, Item[]>();
  for (const item of items) {
    if (item.str.trim() === "") continue;
    const key = Math.round(item.y / 4);
    const near = [key, key - 1, key + 1].find((k) => lines.has(k)) ?? key;
    lines.set(near, [...(lines.get(near) ?? []), item]);
  }
  const rows: Cell[][] = [...lines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => {
      const cells: Cell[] = [];
      for (const item of [...row].sort((a, b) => a.x - b.x)) {
        const last = cells[cells.length - 1];
        const gap = last ? item.x - last.end : Infinity;
        if (last && gap < Math.max(item.height, 6) * 0.8) {
          last.text += (gap > 0.5 ? " " : "") + item.str.trim();
          last.end = item.x + item.width;
        } else cells.push({ text: item.str.trim(), x: item.x, end: item.x + item.width });
      }
      return cells;
    });
  const at = rows.findIndex((r) => isHeaderRow(r.map((c) => c.text)));
  if (at === -1) return rows.map((r) => r.map((c) => c.text));
  const header = rows[at];
  // Column i spans from its heading's left edge to the next heading's; the last runs to the page edge.
  const spans = header.map((h, i) => [i === 0 ? -Infinity : h.x - 2, i === header.length - 1 ? Infinity : header[i + 1].x - 2] as const);
  const place = (cell: Cell) => {
    let best = 0;
    let most = -Infinity;
    spans.forEach(([from, to], i) => {
      const overlap = Math.min(cell.end, to) - Math.max(cell.x, from);
      if (overlap > most) [best, most] = [i, overlap];
    });
    return best;
  };
  return rows.map((row, i) => {
    if (i <= at) return row.map((c) => c.text);
    const out: string[] = header.map(() => "");
    for (const cell of row) {
      const col = place(cell);
      out[col] = out[col] ? `${out[col]} ${cell.text}` : cell.text;
    }
    return out;
  });
}

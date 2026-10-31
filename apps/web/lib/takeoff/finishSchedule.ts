/**
 * ── A ROOM FINISH SCHEDULE, READ BY COLUMN ──
 *
 * Two shapes reach here. Baker A631 and Joplin A-611 give one row per room
 * number, with a wall finish for each compass side. glen-hazel A-001 gives one
 * row per finish TYPE (T1, T2), and its plans tag each room with a type.
 *
 * It reads positions rather than `tableRowsFromPage`, because on Baker other
 * text shares a schedule row's height, so a row comes back as "CARPET TILE 1 |
 * 105 | CONFERENCE | CPTT-1". Columns are found from the header words, then each
 * cell is the text under its column at the row's height.
 */

export type FinishRow = {
  /** A room number, or a finish type like T1 when `byType`. */
  key: string;
  name: string | null;
  floor: string | null;
  base: string | null;
  /** One finish for every wall, or null where the schedule gives each side. */
  wall: string | null;
  sides: { N: string | null; E: string | null; S: string | null; W: string | null } | null;
  ceiling: string | null;
};

export type FinishSchedule = { byType: boolean; rows: FinishRow[] };

export type TextItem = { str: string; x: number; y: number; width: number; height: number };

const ROOM_KEY = /^(?=.*\d)[A-Z]{0,2}\d{1,4}[A-Z]?(?:\.\d)?$/;
const TYPE_KEY = /^T-?\d{1,2}$/;
/** Header words sit within this many points of each other across their two lines. */
const HEADER_BAND = 36;
/** A schedule is no wider than this, in points. */
const TABLE_WIDTH = 1100;

const centre = (t: TextItem) => t.x + t.width / 2;
const norm = (t: TextItem) => t.str.trim().toUpperCase();

type Columns = { key: number; name: number | null; floor: number; base: number; wall: number | null; N: number | null; E: number | null; S: number | null; W: number | null; ceiling: number | null; byType: boolean };

function columnsFrom(items: readonly TextItem[], floor: TextItem): Columns | null {
  const near = items.filter((t) => Math.abs(t.y - floor.y) <= HEADER_BAND && Math.abs(t.x - floor.x) <= TABLE_WIDTH);
  const right = (re: RegExp, from: number) => near.filter((t) => re.test(norm(t)) && centre(t) > from).sort((a, b) => a.x - b.x)[0] ?? null;
  const left = (re: RegExp, to: number) => near.filter((t) => re.test(norm(t)) && centre(t) < to).sort((a, b) => b.x - a.x)[0] ?? null;
  const fx = centre(floor);
  const base = right(/^BASE(\s+FINISH)?$/, fx);
  if (base === null) return null;
  const bx = centre(base);
  const type = left(/^(FINISH\s+TYPE|TYPE)$/, fx);
  const key = type ?? left(/^(ROOM\s+)?(NUMBER|NO\.?|#)$/, fx) ?? left(/^RM\.?\s*#?$/, fx);
  if (key === null) return null;
  const name = left(/^(ROOM\s+NAME|NAME)$/, fx);
  const sideOf = (word: string) => right(new RegExp(`^(FINISH\\s*-\\s*)?${word}$`), Math.min(fx, bx));
  const north = sideOf("NORTH"), east = sideOf("EAST"), south = sideOf("SOUTH"), west = sideOf("WEST");
  const wall = near.filter((t) => /^WALLS?(\s+FINISH)?$/.test(norm(t)) && centre(t) > Math.min(fx, bx)).sort((a, b) => Math.abs(a.y - floor.y) - Math.abs(b.y - floor.y))[0] ?? null;
  const sided = north !== null && east !== null && south !== null && west !== null;
  if (!sided && wall === null) return null;
  const last = Math.max(fx, bx, sided ? centre(west!) : centre(wall!));
  // Baker A631 prints CEILIING, so the word is matched loosely.
  const ceilingWord = /^(FINISH\s*-\s*)?CEI[LI]+NG(\s+FINISH)?$/;
  const ceiling = right(ceilingWord, last) ?? right(ceilingWord, Math.max(fx, bx));
  return { key: centre(key), name: name === null ? null : centre(name), floor: fx, base: bx, wall: sided ? null : centre(wall!), N: sided ? centre(north!) : null, E: sided ? centre(east!) : null, S: sided ? centre(south!) : null, W: sided ? centre(west!) : null, ceiling: ceiling === null ? null : centre(ceiling), byType: type !== null };
}

/** Left edges this close, in points, are one column. */
const SAME_EDGE = 6;
const SHEET_TEXT_MAX_CHARS = 28;

/**
 * Cells line up on their LEFT edges and headers are centred over them (Joplin:
 * FLOOR at 672 over cells starting at 656), so a cell's centre is near no
 * header. Columns come from the rows instead: left edges that recur, each header
 * claiming the last edge at or before its centre. Columns nobody named, like
 * Joplin's casework, are edges of their own, so they cannot bleed into a wall.
 */
function rowsUnder(items: readonly TextItem[], c: Columns, headerY: number): FinishRow[] {
  const named = [c.key, c.name, c.floor, c.base, c.wall, c.N, c.E, c.S, c.W, c.ceiling].filter((v): v is number => v !== null).sort((a, b) => a - b);
  const spacing = Math.min(...named.slice(1).map((v, i) => v - named[i]));
  const lo = named[0] - spacing * 1.5, hi = named[named.length - 1] + spacing;
  const keyRe = c.byType ? TYPE_KEY : ROOM_KEY;
  // A key starts at or left of its header's centre, so "RR 1" in the name column is not a room number.
  const keys = items.filter((t) => t.y > headerY + 2 && t.x <= c.key + SAME_EDGE && t.x >= c.key - spacing * 1.2 && keyRe.test(norm(t).replace(/\s+/g, ""))).sort((a, b) => a.y - b.y);
  if (keys.length === 0) return [];
  const rowItems = keys.map((k) => { const tol = Math.max(k.height * 0.7, 3); return items.filter((t) => Math.abs(t.y - k.y) <= tol && t.x >= lo && t.x <= hi); });
  const lefts = rowItems.flat().map((t) => t.x).sort((a, b) => a - b);
  const edges: { x: number; n: number }[] = [];
  for (const x of lefts) { const last = edges[edges.length - 1]; if (last && x - last.x <= SAME_EDGE) last.n += 1; else edges.push({ x, n: 1 }); }
  const firm = edges.filter((e) => e.n >= Math.max(2, keys.length * 0.15)).map((e) => e.x);
  const edgeOf = (col: number | null) => (col === null ? null : firm.filter((x) => x <= col + SAME_EDGE).pop() ?? null);
  const rows: FinishRow[] = [];
  keys.forEach((k, at) => {
    const cell = (col: number | null) => {
      const edge = edgeOf(col);
      if (edge === null) return null;
      const next = firm.find((x) => x > edge + SAME_EDGE) ?? Infinity;
      const hit = rowItems[at].filter((t) => t !== k && t.x >= edge - 1 && t.x < next - 1 && t.str.length <= SHEET_TEXT_MAX_CHARS).map((t) => t.str.trim()).join(" ").trim();
      return hit === "" || /^[-–—]+$/.test(hit) ? null : hit;
    };
    const row: FinishRow = {
      key: norm(k).replace(/[\s-]+/g, ""),
      name: cell(c.name),
      floor: cell(c.floor),
      base: cell(c.base),
      wall: cell(c.wall),
      sides: c.N === null ? null : { N: cell(c.N), E: cell(c.E), S: cell(c.S), W: cell(c.W) },
      ceiling: cell(c.ceiling),
    };
    if (row.floor !== null || row.base !== null || row.wall !== null || row.sides !== null) rows.push(row);
  });
  return rows;
}

/** Every finish schedule on one page. A page can repeat a table: the first reading of a key wins. */
export function readFinishSchedule(items: readonly TextItem[]): FinishSchedule | null {
  const seen = new Map<string, FinishRow>();
  let byType: boolean | null = null;
  // The fullest header first: Baker heads a group "FLOOR" above the real "FLOOR FINISH".
  for (const floor of items.filter((t) => /^FLOOR(\s+FINISH)?$/.test(norm(t))).sort((a, b) => b.str.length - a.str.length)) {
    const c = columnsFrom(items, floor);
    if (c === null) continue;
    const rows = rowsUnder(items, c, Math.max(floor.y, ...items.filter((t) => Math.abs(t.y - floor.y) <= HEADER_BAND && /^(FINISH|NORTH|FINISH - NORTH|NUMBER|ROOM NAME|FLOOR FINISH)$/.test(norm(t)) && Math.abs(t.x - floor.x) <= TABLE_WIDTH).map((t) => t.y)));
    if (rows.length === 0) continue;
    if (byType === null) byType = c.byType;
    if (c.byType !== byType) continue;
    for (const r of rows) if (!seen.has(r.key)) seen.set(r.key, r);
  }
  return byType === null ? null : { byType, rows: [...seen.values()] };
}

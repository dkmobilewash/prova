/**
 * ── WHAT CHANGED BETWEEN TWO VERSIONS OF ONE SHEET ──
 *
 * Togal parity: a revised sheet is laid over the one it replaces, and the
 * estimator sees what was added and what was taken away. Line work only, in
 * page-width units (x across 0..1, y down 0..height/width), which is how every
 * sheet here is already measured.
 *
 * Pieces of lines, not whole segments: a drafter who extends a wall leaves the
 * old length where it was and adds a piece, and the piece is the change. So
 * each segment is walked in grid steps, and a run of steps the other version
 * has no ink near is reported as a piece.
 *
 * Revisions are often re-plotted a little off from the first issue, so the new
 * sheet is first slid over the old one to where the most ink agrees.
 * ponytail: translation only. A sheet re-plotted at another scale or rotated
 * compares as all changed; add a scale search if a set ever does that.
 */
export type Seg = { x1: number; y1: number; x2: number; y2: number };
export type SheetCompare = {
  /** Where the new sheet sits over the old one, in page-width units. */
  offset: { dx: number; dy: number };
  added: Seg[];
  removed: Seg[];
  /** Of the new sheet's ink, the share the old one also has, 0..1. */
  agreement: number;
};

const FINE = 3000;
const COARSE = 500;
/** Cells either side a line may move and still be the same line. */
const SLACK = 2;
/** The longest run of agreement inside a change that is a crossing wall, in points (two a cell). */
const BRIDGE = 4 * (2 * SLACK + 1);
/** The shortest piece worth reporting, in fine cells. */
const MIN_PIECE = 4;

type Grid = { cells: Uint8Array; w: number; h: number };

function cellsOf(segs: readonly Seg[], n: number, h: number, dx = 0, dy = 0): Grid {
  const g: Grid = { cells: new Uint8Array(n * h), w: n, h };
  for (const s of segs) walk(s, n, (x, y) => {
    const cx = Math.floor((x + dx) * n), cy = Math.floor((y + dy) * n);
    if (cx >= 0 && cy >= 0 && cx < n && cy < h) g.cells[cy * n + cx] = 1;
  });
  return g;
}

/** Points along a segment, half a cell apart, so no cell it crosses is skipped. */
function walk(s: Seg, n: number, at: (x: number, y: number) => void) {
  const steps = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * n * 2));
  for (let i = 0; i <= steps; i += 1) at(s.x1 + ((s.x2 - s.x1) * i) / steps, s.y1 + ((s.y2 - s.y1) * i) / steps);
}

function dilate(g: Grid, r: number): Grid {
  const rows = new Uint8Array(g.cells.length), out = new Uint8Array(g.cells.length);
  for (let y = 0; y < g.h; y += 1) for (let x = 0; x < g.w; x += 1) {
    if (!g.cells[y * g.w + x]) continue;
    for (let k = Math.max(0, x - r); k <= Math.min(g.w - 1, x + r); k += 1) rows[y * g.w + k] = 1;
  }
  for (let y = 0; y < g.h; y += 1) for (let x = 0; x < g.w; x += 1) {
    if (!rows[y * g.w + x]) continue;
    for (let k = Math.max(0, y - r); k <= Math.min(g.h - 1, y + r); k += 1) out[k * g.w + x] = 1;
  }
  return { ...g, cells: out };
}

function bestShift(a: Grid, b: Grid, range: number, around = { x: 0, y: 0 }): { x: number; y: number; hits: number } {
  const ink: number[] = [];
  for (let i = 0; i < b.cells.length; i += 1) if (b.cells[i]) ink.push(i);
  let best = { x: around.x, y: around.y, hits: -1 };
  for (let sy = around.y - range; sy <= around.y + range; sy += 1) for (let sx = around.x - range; sx <= around.x + range; sx += 1) {
    let hits = 0;
    for (const i of ink) {
      const x = (i % b.w) - sx, y = Math.floor(i / b.w) - sy;
      if (x >= 0 && y >= 0 && x < a.w && y < a.h && a.cells[y * a.w + x]) hits += 1;
    }
    if (hits > best.hits || (hits === best.hits && Math.abs(sx) + Math.abs(sy) < Math.abs(best.x) + Math.abs(best.y))) best = { x: sx, y: sy, hits };
  }
  return best;
}

/** The pieces of `segs` with no ink of `other` near them. */
function piecesMissing(segs: readonly Seg[], other: Grid, n: number, dx: number, dy: number): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const pts: { x: number; y: number; miss: boolean }[] = [];
    walk(s, n, (x, y) => {
      const cx = Math.floor((x + dx) * n), cy = Math.floor((y + dy) * n);
      pts.push({ x, y, miss: !(cx >= 0 && cy >= 0 && cx < other.w && cy < other.h && other.cells[cy * other.w + cx]) });
    });
    // A removed wall still crosses the walls that stay, and each crossing has
    // ink; a short hit between two misses is one of those, not a kept piece.
    for (let i = 0; i < pts.length; ) {
      if (pts[i]!.miss) { i += 1; continue; }
      let j = i;
      while (j < pts.length && !pts[j]!.miss) j += 1;
      if (i > 0 && j < pts.length && j - i <= BRIDGE) for (let k = i; k < j; k += 1) pts[k]!.miss = true;
      i = j;
    }
    let start = -1;
    for (let i = 0; i <= pts.length; i += 1) {
      const miss = i < pts.length && pts[i]!.miss;
      if (miss && start < 0) start = i;
      if (!miss && start >= 0) {
        // Two points a step, so a piece of MIN_PIECE cells is 2 * MIN_PIECE points.
        if (i - start >= 2 * MIN_PIECE || (start === 0 && i === pts.length)) out.push({ x1: pts[start]!.x, y1: pts[start]!.y, x2: pts[i - 1]!.x, y2: pts[i - 1]!.y });
        start = -1;
      }
    }
  }
  return out;
}

export function compareSheets(before: readonly Seg[], after: readonly Seg[], aspect: number): SheetCompare {
  const hc = Math.ceil(aspect * COARSE) + 1, hf = Math.ceil(aspect * FINE) + 1;
  const coarse = bestShift(dilate(cellsOf(before, COARSE, hc), 1), cellsOf(after, COARSE, hc), 12);
  const ratio = FINE / COARSE;
  const fine = bestShift(cellsOf(before, FINE, hf), cellsOf(after, FINE, hf), Math.ceil(ratio), { x: coarse.x * ratio, y: coarse.y * ratio });
  const dx = -fine.x / FINE, dy = -fine.y / FINE;
  const oldNear = dilate(cellsOf(before, FINE, hf), SLACK);
  const newNear = dilate(cellsOf(after, FINE, hf, dx, dy), SLACK);
  const newInk = cellsOf(after, FINE, hf, dx, dy);
  let inkCells = 0, shared = 0;
  for (let i = 0; i < newInk.cells.length; i += 1) if (newInk.cells[i]) { inkCells += 1; if (oldNear.cells[i]) shared += 1; }
  return {
    offset: { dx, dy },
    // Reported where they sit on the NEW sheet, which is the one on screen.
    added: piecesMissing(after, oldNear, FINE, dx, dy),
    removed: piecesMissing(before, newNear, FINE, 0, 0).map((s) => ({ x1: s.x1 - dx, y1: s.y1 - dy, x2: s.x2 - dx, y2: s.y2 - dy })),
    agreement: inkCells === 0 ? 1 : shared / inkCells,
  };
}

/**
 * Which measurements on the old sheet run through a change: any point of
 * their outline within `near` (page-width units) of an added or removed piece.
 */
export function measurementsNearChanges(
  measurements: readonly { id: string; xs: readonly number[]; ys: readonly number[]; closed: boolean }[],
  changes: readonly Seg[],
  aspect: number,
  near: number,
): Set<string> {
  const n = COARSE * 2, h = Math.ceil(aspect * n) + 1;
  const grid = dilate(cellsOf(changes, n, h), Math.max(1, Math.round(near * n)));
  const hit = new Set<string>();
  for (const m of measurements) {
    const count = m.xs.length;
    const edges = count === 1 ? 1 : m.closed ? count : count - 1;
    for (let i = 0; i < edges && !hit.has(m.id); i += 1) {
      const j = count === 1 ? 0 : (i + 1) % count;
      walk({ x1: m.xs[i]!, y1: m.ys[i]!, x2: m.xs[j]!, y2: m.ys[j]! }, n, (x, y) => {
        const cx = Math.floor(x * n), cy = Math.floor(y * n);
        if (cx >= 0 && cy >= 0 && cx < n && cy < h && grid.cells[cy * n + cx]) hit.add(m.id);
      });
    }
  }
  return hit;
}

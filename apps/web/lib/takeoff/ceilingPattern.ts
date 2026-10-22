import { familyOf, type CeilingFamily, type UnitStroke } from "./ceilingTags";
import type { PositionedText } from "./roomTags";

/**
 * ── THE CEILING TYPE NOBODY WROTE DOWN: THE PATTERN DRAWN IN THE ROOM ──
 *
 * Five of the thirteen training RCPs print a height in each room and leave
 * the TYPE to the drawing: a regular grid for lay-in tile (2x2, 2x4, Topeka's
 * 2x6 — at the sheet's scale), a fine stipple for gypsum board, nothing or
 * joist lines or a diagonal hatch for open-to-structure. This reads the
 * strokes inside a window round the room's printed tag and names the
 * pattern; `familyOfPattern` turns it into a family.
 *
 * The mapping is taken from the sheet's own LEGEND where it draws swatches
 * — the little box beside each legend row holds the same pattern, so a
 * sheet whose diagonal means "gyp board with wood veneer" (Joplin) is read
 * as that sheet says, not as a convention. Only where a swatch is missing
 * does the convention apply: grid → ACT, stipple → GYP, joists → OPEN,
 * diagonal → nothing (it means a different thing on every sheet).
 *
 * The window is round the TAG, not a polygon, because an RCP's rooms rarely
 * close (NOTES-rooms §12): half a side is at most `halfFeet`, and never more
 * than 45% of the way to the nearest other room tag. A grid needs four
 * evenly spaced lines in one direction and two in the other, because a
 * window also holds the room's walls, which are few and irregular.
 */
export type PatternKind = "grid" | "stipple" | "joists" | "diagonal" | "blank";

export type Pattern = {
  kind: PatternKind;
  /** Grid or joist spacing in feet along each axis, where measured. */
  spacingFeet: { x: number | null; y: number | null };
  counts: { horizontal: number; vertical: number; diagonal: number; tiny: number };
  /** The window actually read, page-width units. */
  window: { cx: number; cy: number; half: number };
};

/** Lines at one position, with how much of the window's width they cover between them. */
const clusters = (segments: { at: number; cover: number }[], tolerance: number): { at: number; cover: number }[] => {
  const sorted = [...segments].sort((a, b) => a.at - b.at);
  const out: { at: number; cover: number }[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || p.at - last.at > tolerance) out.push({ ...p });
    else last.cover += p.cover;
  }
  return out;
};

/**
 * The spacing a set of lines is laid out on: the most common gap between any
 * two of them, within the plausible range, that at least `need` lines sit on
 * as a chain. Light fixtures and diffusers add lines at odd positions, so the
 * consecutive gaps are irregular even when the grid is perfect.
 */
const dominantSpacing = (lines: number[], min: number, max: number, need: number): number | null => {
  const bins = new Map<number, number>();
  for (let i = 0; i < lines.length; i += 1)
    for (let j = i + 1; j < lines.length; j += 1) {
      const d = lines[j] - lines[i];
      if (d < min || d > max) continue;
      const bin = Math.round(d / (0.08 * min));
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
  const best = [...bins.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best === undefined || best[1] < need - 1) return null;
  const spacing = best[0] * 0.08 * min;
  // A chain: from some line, lines at successive multiples of the spacing.
  const tol = 0.2 * spacing;
  for (const base of lines) {
    let n = 1;
    let at = base;
    while (lines.some((l) => Math.abs(l - (at + spacing)) <= tol)) {
      at += spacing;
      n += 1;
    }
    if (n >= need) return spacing;
  }
  return null;
};

/** The pattern inside a square window, `half` in page-width units. `feetPerUnit` 0 reads a legend swatch (no scale). */
export function patternInWindow(strokes: readonly UnitStroke[], cx: number, cy: number, half: number, feetPerUnit: number): Pattern {
  const toFeet = feetPerUnit > 0 ? feetPerUnit : 1;
  const inWindow = (x: number, y: number) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;
  // A grid line runs the length of the room, so its MIDPOINT is usually outside a
  // window round the tag: a stroke counts when its box crosses the window.
  const crosses = (s: UnitStroke) =>
    Math.min(s.x1, s.x2) <= cx + half && Math.max(s.x1, s.x2) >= cx - half && Math.min(s.y1, s.y2) <= cy + half && Math.max(s.y1, s.y2) >= cy - half;
  const hs: { at: number; cover: number }[] = [];
  const vs: { at: number; cover: number }[] = [];
  let diagonal = 0;
  let tiny = 0;
  const minLine = feetPerUnit > 0 ? 1 / feetPerUnit : half * 0.4;
  const tinyMax = feetPerUnit > 0 ? 0.3 / feetPerUnit : half * 0.12;
  for (const s of strokes) {
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    const len = Math.hypot(dx, dy);
    if (len < tinyMax ? !inWindow(mx, my) : !crosses(s)) continue;
    if (len < tinyMax) {
      tiny += 1;
      continue;
    }
    if (len < minLine) continue;
    const coverX = Math.min(Math.max(s.x1, s.x2), cx + half) - Math.max(Math.min(s.x1, s.x2), cx - half);
    const coverY = Math.min(Math.max(s.y1, s.y2), cy + half) - Math.max(Math.min(s.y1, s.y2), cy - half);
    if (dy < 0.15 * dx && Math.abs(my - cy) <= half) hs.push({ at: my, cover: coverX });
    else if (dx < 0.15 * dy && Math.abs(mx - cx) <= half) vs.push({ at: mx, cover: coverY });
    else if (dx > 0.4 * len && dy > 0.4 * len) diagonal += 1;
  }
  const tol = feetPerUnit > 0 ? 0.2 / feetPerUnit : half * 0.05;
  // A grid line runs the window's whole width; a fixture's edge covers a fraction of it.
  const full = (c: { at: number; cover: number }) => c.cover >= 1.4 * half;
  const hLines = clusters(hs, tol).filter(full).map((c) => c.at);
  const vLines = clusters(vs, tol).filter(full).map((c) => c.at);
  const [gMin, gMax] = feetPerUnit > 0 ? [1.6 / feetPerUnit, 6.5 / feetPerUnit] : [half * 0.15, half * 1.2];
  const hSpacing = dominantSpacing(hLines, gMin, gMax, 3);
  const vSpacing = dominantSpacing(vLines, gMin, gMax, 3);
  const feet = (u: number | null) => (u === null ? null : u * toFeet);
  const counts = { horizontal: hLines.length, vertical: vLines.length, diagonal, tiny };
  const window = { cx, cy, half };
  // Four lines on a spacing one way and two the other — or three and three.
  const gridish = (a: number[], sa: number | null, b: number[], sb: number | null) =>
    (sa !== null && a.length >= 4 && b.length >= 2) || (sa !== null && sb !== null && a.length >= 3 && b.length >= 3);
  if (gridish(hLines, hSpacing, vLines, vSpacing) || gridish(vLines, vSpacing, hLines, hSpacing)) {
    return { kind: "grid", spacingFeet: { x: feet(vSpacing), y: feet(hSpacing) }, counts, window };
  }
  // Stipple by density, since a window is 6 to 16 ft across: a tiny stroke per three square feet.
  const sqft = feetPerUnit > 0 ? (2 * half * toFeet) ** 2 : 1;
  if (feetPerUnit > 0 ? tiny / sqft >= 0.3 && tiny >= 30 : tiny >= 12) return { kind: "stipple", spacingFeet: { x: null, y: null }, counts, window };
  if (diagonal >= (feetPerUnit > 0 ? 8 : 3)) return { kind: "diagonal", spacingFeet: { x: null, y: null }, counts, window };
  const [jMin, jMax] = feetPerUnit > 0 ? [0.8 / feetPerUnit, 2.5 / feetPerUnit] : [half * 0.1, half * 0.6];
  const joisty = (lines: number[], other: number[]) => lines.length >= 5 && dominantSpacing(lines, jMin, jMax, 5) !== null && other.length <= 2;
  if (joisty(hLines, vLines) || joisty(vLines, hLines)) {
    return { kind: "joists", spacingFeet: { x: feet(dominantSpacing(vLines, jMin, jMax, 5)), y: feet(dominantSpacing(hLines, jMin, jMax, 5)) }, counts, window };
  }
  return { kind: "blank", spacingFeet: { x: null, y: null }, counts, window };
}

const LEGEND_TITLE = /CEILING\s+(?:PLAN\s+)?(?:LEGEND|TYPES?|FINISH\s+SCHEDULE|MATERIALS?(?:\s+LEGEND)?|SYMBOLS?)|RCP\s+(?:SYMBOL\s+)?LEGEND|REFLECTED\s+CEILING\s+(?:PLAN\s+)?(?:LEGEND|SYMBOLS)/i;
const CEILING_ROW = /ACOUST|LAY-?IN|TILE|\bACT\b|GYP|GWB|PLASTER|BOARD|EXPOSED|OPEN TO|STRUCTURE|CEILING/i;

/**
 * The legend's swatches: which pattern each family is drawn with on THIS
 * sheet. Joplin's legend has no codes at all — a swatch, then the words — so
 * the rows are the ceiling-worded lines under a legend title, and the swatch
 * is the box just left of each, about a line and a half tall.
 */
export function legendSwatches(
  items: readonly PositionedText[],
  strokes: readonly UnitStroke[],
  widthPt: number,
): Map<PatternKind, CeilingFamily> {
  const out = new Map<PatternKind, CeilingFamily>();
  const all = items.map((i) => ({ ...i, str: i.str.trim(), u: i.x / widthPt, v: i.y / widthPt, h: Math.max(i.height, 1) / widthPt })).filter((i) => i.str !== "");
  const titles = all.filter((i) => LEGEND_TITLE.test(i.str) && i.str.length < 60);
  for (const i of all) {
    if (!CEILING_ROW.test(i.str) || i.str.length > 70 || /LEGEND|NOTES?\b|SCHEDULE/i.test(i.str)) continue;
    if (!titles.some((t) => i.v > t.v && i.v - t.v < 0.32 && i.u > t.u - 0.16 && i.u < t.u + 0.3)) continue;
    const cx = i.u - 2.2 * i.h;
    const cy = i.v - i.h / 2;
    const p = patternInWindow(strokes, cx, cy, 1.2 * i.h, 0);
    if (p.kind === "blank") continue;
    const family = familyOf(i.str);
    if (family !== "OTHER" && !out.has(p.kind)) out.set(p.kind, family);
  }
  return out;
}

/** A family for a pattern: the sheet's swatch where it has one, else the convention. */
export function familyOfPattern(kind: PatternKind, swatches: ReadonlyMap<PatternKind, CeilingFamily>): CeilingFamily | null {
  const own = swatches.get(kind);
  if (own !== undefined) return own;
  if (kind === "grid") return "ACT";
  if (kind === "stipple") return "GYP";
  if (kind === "joists") return "OPEN";
  return null;
}

/** The window round a room tag: at most `halfFeet`, never past 45% of the way to the nearest other tag. */
export function windowRound(
  tag: { x: number; y: number },
  others: readonly { x: number; y: number }[],
  widthPt: number,
  feetPerUnit: number,
  halfFeet = 8,
): { cx: number; cy: number; half: number; away: { cx: number; cy: number } | null } {
  const cx = tag.x / widthPt;
  const cy = tag.y / widthPt;
  let nearest = Number.POSITIVE_INFINITY;
  let nearestAt: { x: number; y: number } | null = null;
  for (const o of others) {
    if (o === tag) continue;
    const d = Math.hypot(o.x / widthPt - cx, o.y / widthPt - cy);
    if (d === 0) continue;
    if (d < nearest) {
      nearest = d;
      nearestAt = o;
    }
  }
  const half = Math.max(4 / feetPerUnit, Math.min(halfFeet / feetPerUnit, 0.45 * nearest));
  // A tag crowded by its neighbour's tag (Joplin's clerical workstations beside two
  // toilets) gets a second window the same size, stepped away from that neighbour.
  let away: { cx: number; cy: number } | null = null;
  if (nearestAt !== null && half <= 4.01 / feetPerUnit) {
    const dx = cx - nearestAt.x / widthPt;
    const dy = cy - nearestAt.y / widthPt;
    const d = Math.hypot(dx, dy) || 1;
    away = { cx: cx + (dx / d) * 1.6 * half, cy: cy + (dy / d) * 1.6 * half };
  }
  return { cx, cy, half, away };
}

const RANK: Record<PatternKind, number> = { grid: 4, stipple: 3, diagonal: 2, joists: 2, blank: 0 };

/** The pattern round a tag: the window on it, or the window stepped away from a crowding neighbour, whichever says more. */
export function patternRound(
  strokes: readonly UnitStroke[],
  w: ReturnType<typeof windowRound>,
  feetPerUnit: number,
): Pattern {
  const here = patternInWindow(strokes, w.cx, w.cy, w.half, feetPerUnit);
  if (w.away === null) return here;
  const there = patternInWindow(strokes, w.away.cx, w.away.cy, w.half, feetPerUnit);
  return RANK[there.kind] > RANK[here.kind] ? there : here;
}

import { DOOR_TAG_REACH_FEET, type DoorSymbol } from "./doorWindowSymbols";
import { GREY_PEN, nicHatch, textRows, type TextItem } from "./existingWalls";
import { renovationMarks, showsExistingWork } from "./renovationMarks";
import { segmentGrid } from "./segmentGrid";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── AN EXISTING DOOR IS NOT A DOOR TO TAKE OFF ──
 *
 * Diego's call (2026-11-13), after the UCCS A2.1.2 audit: 19 of its 23 "false" found doors were
 * real doors in the building that stays (the existing restrooms N141 (E) / N142 (E) inside a
 * dashed boundary, two (E) corridor doors, a row along the hatched existing-scope edge), and they
 * outscored every new door. Walls already have an existing set-aside (`existingWalls.ts`, plan
 * comparison); found doors had none. A found door is SET ASIDE as existing, never dropped, when:
 *
 *   1. `wall`: it sits on a wall the product already set aside as existing by the sheet's own marks
 *      (the `existing` set-aside of `offeredCandidates`: a tag, the legend's pen, grey, a NIC hatch).
 *      NOT a wall plan comparison set aside: there the demolition plan is the witness for the door
 *      too (route 4). E Street A2.1's doors 1 and 6 are new openings cut into walls the comparison
 *      set aside, and the first cut of this rule lost them (the original's audit, 2026-11-13); the
 *      demolition plan draws no door within 7 ft of either;
 *   2. `area`: it is inside a HATCHED area labelled not in contract / existing (`nicHatch`, the
 *      wall rule's own reading), or inside a closed DASHED box with such a label in it;
 *   3. `tag`: its tag carries (E): a mark ending `(E)` (`N141 (E)`) or `EXISTING DOOR` within a
 *      leaf and a foot of it, or a bare `(E)` INSIDE its swing (UCCS's corridor doors). A bare `(E)`
 *      across the wall from the swing is the DIMENSION's, not the door's tag: E Street A2.1 prints
 *      `(E)` under the opening dimension of doors E-9 to E-11. Those doors are in fact existing (the
 *      paired demolition plan keys them C11.04, "existing wood door to remain"), and route 4 sets them
 *      aside when the sheet is paired; route 3 stays with the door's own tag, as Diego worded it;
 *   4. `demo`: the paired demolition plan draws a door in the same place on a wall it does not
 *      remove (`priorPlanFor`'s `doors`): existing to remain;
 *   5. `series`: its own mark (the nearest mark-shaped word, within the mark reach) is in a series
 *      the set calls existing: `E-9` where E Street's door schedule says DOORS WITH PREFIX "E" ARE
 *      EXISTING DOORS TO REMAIN. Round 22c's door line failed on exactly these: 12 E-numbered doors,
 *      printed tags and all, out of the key and scoring like perfect doors. A prefix counts only with
 *      support, never from its letter: a definition on the sheet or on the set's door schedule page
 *      (`existingPrefixes`), or a paired demolition plan that keeps most of the series' doors. An
 *      `E-` series with neither (an east wing's doors) is left alone;
 *   6. `grey`: its arc and leaf are drawn in the existing pen, the wall rule's route 3 for doors (Diego,
 *      2026-11-14): on a sheet whose words say it shows existing work, a door drawn mostly grey (at least
 *      `GREY_DOOR_SHARE` of its arc and leaf by length, at most `DARK_DOOR_SHARE` dark) where most of the
 *      sheet's doors are drawn dark; on a sheet with no such words, only a door nearly all grey
 *      (`NO_WORDS_GREY_DOOR_SHARE`) where at least `NO_WORDS_DARK_DOORS` of the doors are dark. The 2020-09-24
 *      set's A1.1 draws an existing door open at 45 degrees in grey beside its existing-work keynotes.
 *
 * Pure. Positions in page-width units.
 */
export type ExistingDoor = { door: DoorSymbol; route: "wall" | "area" | "tag" | "demo" | "series" | "grey"; why: string };

/** What a caller knows beyond the page itself. Both optional: without them routes 1 and 4 are silent. */
export type ExistingDoorEvidence = {
  /** Walls set aside as existing, page-width units. */
  asideWalls?: readonly { x1: number; y1: number; x2: number; y2: number; thicknessFeet?: number }[];
  /** Doors the paired demolition plan keeps, moved onto this sheet. */
  priorDoors?: readonly { hinge: { x: number; y: number }; strike: { x: number; y: number } }[];
  /** The demolition plan's sheet number, for the sentence. */
  priorSheet?: string;
  /** Mark prefixes the set's door schedule page(s) define as existing (`existingPrefixes` over their text). */
  existingPrefixes?: readonly string[];
  /** A person chose to count this sheet's existing doors (`existingDoorsCounted.ts`): nothing is set aside. */
  counted?: boolean;
};

/** How far beyond a set-aside wall's face a door's leaf may sit and still be in it. */
export const ON_WALL_FEET = 0.75;
/** A demolition-plan door within this of a found one, at its middle, is the same door. */
export const SAME_DOOR_FEET = 1;
/** A dash: a short straight piece, on a line with others and gaps between. */
export const DASH_SHORTEST_FEET = 0.15;
export const DASH_LONGEST_FEET = 3;
export const DASH_GAP_FEET = 2.5;
export const DASHED_LINE_PIECES = 4;
/** A dashed box's sides end this close to the sides across from them (rounded corners). */
export const BOX_CORNER_FEET = 3;
export const BOX_LARGEST_FEET = 200;
/** Route 6: a door's arc and leaf grey by length at least this share, dark at most this, on a sheet showing existing work... */
export const GREY_DOOR_SHARE = 0.6;
export const DARK_DOOR_SHARE = 0.2;
/** ...or, with no renovation words, grey at least this share where at least this share of the sheet's doors are dark. */
export const NO_WORDS_GREY_DOOR_SHARE = 0.9;
export const NO_WORDS_DARK_DOORS = 0.75;
/** A door's own strokes: within this of its arc's circle, or of its open leaf. */
const ON_DOOR_FEET = 0.12;

/**
 * How much of a door's arc and open leaf, by length, is drawn grey and how much dark; null with no pen to read.
 * The arc is the circle of the leaf's radius about the hinge, between the strike and the open leaf; the leaf the
 * hinge-to-open radius. A stroke with no colour is black, as `existingMarks` reads it.
 */
export function doorPen(d: DoorSymbol, segments: readonly StrokeSegment[], feetPerUnit: number): { grey: number; dark: number } | null {
  if (d.open === undefined) return null;
  const r = d.widthFeet / d.leaves / feetPerUnit, on = ON_DOOR_FEET / feetPerUnit;
  if (!(r > 0)) return null;
  const ang = (p: { x: number; y: number }) => Math.atan2(p.y - d.hinge.y, p.x - d.hinge.x);
  const a0 = ang(d.leaves === 2 ? { x: d.hinge.x + (d.strike.x - d.hinge.x) / 2, y: d.hinge.y + (d.strike.y - d.hinge.y) / 2 } : d.strike), a1 = ang(d.open);
  let span = a1 - a0;
  while (span > Math.PI) span -= 2 * Math.PI;
  while (span < -Math.PI) span += 2 * Math.PI;
  const within = (t: number) => { let u = t - a0; while (u > Math.PI) u -= 2 * Math.PI; while (u < -Math.PI) u += 2 * Math.PI; return span >= 0 ? u >= -0.05 && u <= span + 0.05 : u <= 0.05 && u >= span - 0.05; };
  const ux = (d.open.x - d.hinge.x) / r, uy = (d.open.y - d.hinge.y) / r;
  let grey = 0, dark = 0;
  for (const i of segmentGrid(segments).near(d.hinge.x - r - on, d.hinge.y - r - on, d.hinge.x + r + on, d.hinge.y + r + on)) {
    const s = segments[i]!;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len === 0) continue;
    const m = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    const onArc = Math.abs(Math.hypot(m.x - d.hinge.x, m.y - d.hinge.y) - r) <= on && within(ang(m));
    const t = (m.x - d.hinge.x) * ux + (m.y - d.hinge.y) * uy, off = Math.abs(-(m.x - d.hinge.x) * uy + (m.y - d.hinge.y) * ux);
    const onLeaf = off <= on && t >= 0 && t <= r;
    if (!onArc && !onLeaf) continue;
    if ((s.gray ?? 0) >= GREY_PEN) grey += len;
    else dark += len;
  }
  const total = grey + dark;
  return total === 0 ? null : { grey: grey / total, dark: dark / total };
}

/** A demolition plan supports a series when it keeps at least this many of its doors, and at least half. */
export const SERIES_KEPT_MIN = 2;

/** A short label that puts an area outside the new work. */
const AREA_LABEL = /^(?:EXISTING\b|EXIST\.|\(E\)|NOT\s+IN\s+(?:CONTRACT|SCOPE)\b|N\.?\s?I\.?\s?C\.?\b|BY\s+OTHERS\b|NO\s+WORK\b)|\(E\)$/i;
/** A door's own tag saying it is existing: `N141 (E)`, `EXISTING DOOR`. A bare `(E)` must sit in the swing (`BARE_E`). */
const DOOR_TAG = /\S\s*\(E\)$|^EXIST(?:ING|\.|'G)?\s+DOOR\b/i;
const BARE_E = /^\(E\)$/i;

const mid = (d: { hinge: { x: number; y: number }; strike: { x: number; y: number } }) => ({ x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2 });

function toSegment(p: { x: number; y: number }, l: { x1: number; y1: number; x2: number; y2: number }): { d: number; t: number } {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1, L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / L2;
  const c = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p.x - (l.x1 + c * dx), p.y - (l.y1 + c * dy)), t };
}

/** Which side of the closed leaf (hinge to strike) the swing lies on: the side its open leaf ends on, or 0 unknown. */
export function swingSide(d: DoorSymbol): -1 | 0 | 1 {
  const lx = d.strike.x - d.hinge.x, ly = d.strike.y - d.hinge.y;
  if (d.open === undefined || (lx === 0 && ly === 0)) return 0;
  const v = (d.open.x - d.hinge.x) * -ly + (d.open.y - d.hinge.y) * lx;
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/**
 * The door-mark prefixes a text defines as existing: `DOORS WITH PREFIX "E" ARE EXISTING DOORS TO REMAIN`
 * (E Street p31), `PREFIX "E" INDICATES EXISTING`, `EX = EXISTING`. Each text is one page's words joined.
 */
export function existingPrefixes(texts: readonly string[]): string[] {
  const out = new Set<string>();
  const Q = `["\u201c\u201d']?`;
  const patterns = [
    new RegExp(`\\b(?:DOORS?|MARKS?|TAGS?|NUMBERS?|OPENINGS?)\\s+(?:WITH|HAVING|W/)\\s+(?:AN?\\s+|THE\\s+)?PREFIX\\s+${Q}([A-Z]{1,2})-?${Q}\\s+(?:ARE|IS|INDICATES?|DENOTES?|MEANS|=)\\s+(?:AN?\\s+)?EXIST`, "g"),
    new RegExp(`\\bPREFIX\\s+${Q}([A-Z]{1,2})-?${Q}\\s+(?:INDICATES?|DENOTES?|MEANS|=)\\s+(?:AN?\\s+)?EXIST`, "g"),
    new RegExp(`(?:^|\\s)${Q}([A-Z]{1,2})-?${Q}\\s*[=:]\\s*EXIST(?:ING|\\.)?\\b`, "g"),
  ];
  for (const text of texts) {
    const t = text.toUpperCase().replace(/\s+/g, " ");
    for (const re of patterns) for (const m of t.matchAll(re)) out.add(m[1]!);
  }
  return [...out].sort();
}

/** A door mark with a prefix (`E-9`, `E-14.1`) or a plain number (`6`, `12.1`); never a keynote (`E23.04`) or a room name. */
const PREFIXED_MARK = /^([A-Z]{1,2})-(\d{1,3}(?:\.\d)?[A-Z]?)$/;
const PLAIN_MARK = /^\d{1,3}(?:\.\d)?[A-Z]?$/;

type DashedLine = { at: number; a: number; b: number };

/** Horizontal and vertical dashed lines: at least `DASHED_LINE_PIECES` short pieces on one line, joined across short gaps. */
export function dashedLines(segments: readonly StrokeSegment[], feetPerUnit: number): { across: DashedLine[]; down: DashedLine[] } {
  const lo = DASH_SHORTEST_FEET / feetPerUnit, hi = DASH_LONGEST_FEET / feetPerUnit, gap = DASH_GAP_FEET / feetPerUnit, same = 0.15 / feetPerUnit;
  const pieces: { across: DashedLine[]; down: DashedLine[] } = { across: [], down: [] };
  for (const s of segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
    if (len < lo || len > hi) continue;
    if (Math.abs(dy) <= 0.035 * len) pieces.across.push({ at: (s.y1 + s.y2) / 2, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2) });
    else if (Math.abs(dx) <= 0.035 * len) pieces.down.push({ at: (s.x1 + s.x2) / 2, a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2) });
  }
  const join = (list: DashedLine[]): DashedLine[] => {
    list.sort((p, q) => p.at - q.at || p.a - q.a);
    const out: DashedLine[] = [];
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j + 1 < list.length && list[j + 1]!.at - list[i]!.at <= same) j += 1;
      const band = list.slice(i, j + 1).sort((p, q) => p.a - q.a);
      let run = [band[0]!];
      const close = () => {
        // A dashed line has gaps between its pieces; a solid line broken into touching pieces does not.
        const gaps = run.slice(1).filter((p, k) => p.a - run[k]!.b > 0.05 / feetPerUnit).length;
        if (run.length >= DASHED_LINE_PIECES && gaps >= 0.6 * (run.length - 1)) out.push({ at: run.reduce((n, p) => n + p.at, 0) / run.length, a: run[0]!.a, b: Math.max(...run.map((p) => p.b)) });
      };
      for (const p of band.slice(1)) {
        const end = Math.max(...run.map((q) => q.b));
        if (p.a - end <= gap) run.push(p);
        else { close(); run = [p]; }
      }
      close();
      i = j + 1;
    }
    return out;
  };
  return { across: join(pieces.across), down: join(pieces.down) };
}

/** The closed dashed box round a point, or null: the nearest dashed line on each side, whose ends meet at the corners. */
export function dashedBoxAround(p: { x: number; y: number }, lines: ReturnType<typeof dashedLines>, feetPerUnit: number): { x1: number; y1: number; x2: number; y2: number } | null {
  const corner = BOX_CORNER_FEET / feetPerUnit, largest = BOX_LARGEST_FEET / feetPerUnit;
  const pick = (list: DashedLine[], along: number, cross: number, below: boolean) =>
    list
      .filter((l) => l.a <= along && along <= l.b && (below ? l.at < cross : l.at > cross) && Math.abs(l.at - cross) <= largest)
      .sort((l, m) => Math.abs(l.at - cross) - Math.abs(m.at - cross))[0];
  const top = pick(lines.across, p.x, p.y, true), bottom = pick(lines.across, p.x, p.y, false);
  const left = pick(lines.down, p.y, p.x, true), right = pick(lines.down, p.y, p.x, false);
  if (!top || !bottom || !left || !right) return null;
  const meets = (l: DashedLine, from: number, to: number) => Math.abs(l.a - from) <= corner && Math.abs(l.b - to) <= corner;
  if (!meets(top, left.at, right.at) || !meets(bottom, left.at, right.at) || !meets(left, top.at, bottom.at) || !meets(right, top.at, bottom.at)) return null;
  return { x1: left.at, y1: top.at, x2: right.at, y2: bottom.at };
}

export function existingDoors(input: {
  doors: readonly DoorSymbol[];
  /** The page's strokes in page-width units. */
  segments: readonly StrokeSegment[];
  /** The page's words, page points, `y` at the baseline. */
  textPt: readonly TextItem[];
  widthPt: number;
  feetPerUnit: number;
  evidence?: ExistingDoorEvidence;
}): ExistingDoor[] {
  const { doors, segments, widthPt: W, feetPerUnit: fpu } = input;
  if (doors.length === 0 || !(W > 0) || !(fpu > 0) || input.evidence?.counted === true) return [];
  const rows = textRows(input.textPt).filter((r) => r.str.length <= 40);
  const centre = (r: TextItem) => ({ x: (r.x + r.width / 2) / W, y: (r.y - r.height / 2) / W });
  const out = new Map<DoorSymbol, ExistingDoor>();
  const set = (door: DoorSymbol, route: ExistingDoor["route"], why: string) => { if (!out.has(door)) out.set(door, { door, route, why }); };

  // 1. On a wall already set aside as existing.
  for (const w of input.evidence?.asideWalls ?? []) {
    const reach = ((w.thicknessFeet ?? 0.5) / 2 + ON_WALL_FEET) / fpu;
    for (const d of doors) {
      const { d: off, t } = toSegment(mid(d), w);
      if (off <= reach && t >= -0.02 && t <= 1.02) set(d, "wall", "on a wall set aside as existing");
    }
  }
  // 3. Its tag carries (E).
  for (const r of rows.filter((r) => DOOR_TAG.test(r.str))) {
    const at = centre(r);
    for (const d of doors) {
      if (Math.hypot(at.x - mid(d).x, at.y - mid(d).y) * fpu <= d.widthFeet + 1) set(d, "tag", `tagged "${r.str}"`);
    }
  }
  const bare = rows.filter((r) => BARE_E.test(r.str)).map(centre);
  if (bare.length > 0) {
    for (const d of doors) {
      if (out.has(d)) continue;
      const r = d.widthFeet / d.leaves / fpu, lx = d.strike.x - d.hinge.x, ly = d.strike.y - d.hinge.y, L = Math.hypot(lx, ly);
      const near = bare.filter((p) => Math.hypot(p.x - d.hinge.x, p.y - d.hinge.y) <= r || Math.hypot(p.x - d.strike.x, p.y - d.strike.y) <= r);
      if (near.length === 0 || L === 0) continue;
      const side = swingSide(d);
      if (side === 0) continue;
      // In the swing: on the arc's side of the closed leaf.
      if (near.some((p) => Math.sign((p.x - d.hinge.x) * (-ly / L) + (p.y - d.hinge.y) * (lx / L)) === side)) set(d, "tag", `"(E)" printed inside its swing`);
    }
  }
  // 4. The paired demolition plan draws it and keeps it.
  const same = SAME_DOOR_FEET / fpu;
  for (const p of input.evidence?.priorDoors ?? []) {
    for (const d of doors) {
      if (Math.hypot(mid(p).x - mid(d).x, mid(p).y - mid(d).y) <= same) set(d, "demo", `drawn on ${input.evidence?.priorSheet ?? "the demolition plan"} and not removed — existing to remain`);
    }
  }
  // 5. Its mark is in a series the set calls existing.
  const marks = textRows(input.textPt).filter((r) => PREFIXED_MARK.test(r.str) || PLAIN_MARK.test(r.str)).map((r) => ({ str: r.str, at: centre(r) }));
  if (marks.some((m) => PREFIXED_MARK.test(m.str))) {
    const reach = DOOR_TAG_REACH_FEET / fpu;
    const series = new Map<string, { door: DoorSymbol; mark: string }[]>();
    for (const d of doors) {
      const own = marks.map((m) => ({ ...m, d: Math.hypot(m.at.x - mid(d).x, m.at.y - mid(d).y) })).filter((m) => m.d <= reach).sort((a, b) => a.d - b.d)[0];
      const prefix = own === undefined ? null : PREFIXED_MARK.exec(own.str)?.[1] ?? null;
      if (prefix !== null) (series.get(prefix) ?? series.set(prefix, []).get(prefix)!).push({ door: d, mark: own!.str });
    }
    const defined = new Set([...existingPrefixes([input.textPt.map((t) => t.str).join(" ")]), ...(input.evidence?.existingPrefixes ?? [])]);
    const prior = input.evidence?.priorDoors ?? [];
    for (const [prefix, list] of series) {
      const kept = list.filter((e) => prior.some((p) => Math.hypot(mid(p).x - mid(e.door).x, mid(p).y - mid(e.door).y) <= same)).length;
      const byPlan = prior.length > 0 && kept >= SERIES_KEPT_MIN && kept >= list.length / 2;
      if (!defined.has(prefix) && !byPlan) continue;
      const source = defined.has(prefix) ? `the set calls prefix "${prefix}" existing` : `${input.evidence?.priorSheet ?? "the demolition plan"} keeps ${kept} of the ${list.length} "${prefix}-" doors`;
      for (const e of list) set(e.door, "series", `tagged "${e.mark}": ${source}`);
    }
  }
  // 6. Drawn in the existing pen, where the sheet draws its doors dark.
  const pens = new Map(doors.map((d) => [d, doorPen(d, segments, fpu)] as const));
  const read = [...pens.values()].filter((p): p is { grey: number; dark: number } => p !== null);
  if (read.length > 0) {
    const darkDoors = read.filter((p) => p.dark >= 0.5).length / read.length;
    const words = showsExistingWork(renovationMarks(input.textPt.map((t) => t.str).join(" ")));
    for (const d of doors) {
      const p = pens.get(d);
      if (p === null || p === undefined) continue;
      const grey = words ? darkDoors > 0.5 && p.grey >= GREY_DOOR_SHARE && p.dark <= DARK_DOOR_SHARE : darkDoors >= NO_WORDS_DARK_DOORS && p.grey >= NO_WORDS_GREY_DOOR_SHARE;
      if (grey) set(d, "grey", words ? "drawn grey where the sheet draws its doors dark, on a sheet that shows existing work" : "drawn grey where the sheet draws nearly all its doors dark");
    }
  }
  // 2. Inside a hatched or dashed area labelled existing or not in contract.
  const labels = rows.filter((r) => AREA_LABEL.test(r.str));
  if (labels.length > 0 && doors.some((d) => !out.has(d))) {
    const hatch = nicHatch(segments, labels.map(centre), fpu);
    if (hatch !== null) for (const d of doors) if (hatch(mid(d).x, mid(d).y)) set(d, "area", "inside a hatched area labelled existing or not in contract");
    const lines = dashedLines(segments, fpu);
    for (const r of labels) {
      const box = dashedBoxAround(centre(r), lines, fpu);
      if (box === null) continue;
      for (const d of doors) {
        const m = mid(d);
        if (m.x >= box.x1 && m.x <= box.x2 && m.y >= box.y1 && m.y <= box.y2) set(d, "area", `inside the dashed boundary round "${r.str}"`);
      }
    }
  }
  return doors.filter((d) => out.has(d)).map((d) => out.get(d)!);
}

/**
 * The walls `offeredCandidates` set aside as existing by the sheet's own marks, for route 1. Never the
 * `on-prior-plan` ones: a new door cut into a wall the demolition plan keeps is new work, and the
 * demolition plan says which doors stay (route 4).
 */
export function asideExistingWalls(lines: readonly { kind: string; x1: number; y1: number; x2: number; y2: number }[]): NonNullable<ExistingDoorEvidence["asideWalls"]> {
  return lines.filter((l) => l.kind === "existing").map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
}

/** One sentence for the panel. */
export function existingDoorsSentence(list: readonly ExistingDoor[]): string {
  const n = (route: ExistingDoor["route"]) => list.filter((e) => e.route === route).length;
  const parts = [
    n("wall") > 0 ? `${n("wall")} on a wall set aside as existing` : "",
    n("area") > 0 ? `${n("area")} inside an area marked existing or not in contract` : "",
    n("tag") > 0 ? `${n("tag")} tagged (E)` : "",
    n("demo") > 0 ? `${n("demo")} kept on the demolition plan` : "",
    n("series") > 0 ? `${n("series")} in a door series the set calls existing` : "",
    n("grey") > 0 ? `${n("grey")} drawn in the existing (grey) pen` : "",
  ].filter((s) => s !== "");
  return `${list.length} existing door${list.length === 1 ? "" : "s"} set aside: ${parts.join("; ")}`;
}

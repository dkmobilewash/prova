import type { DoorSymbol } from "./doorWindowSymbols";
import { nicHatch, textRows, type TextItem } from "./existingWalls";
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
 *   1. `wall`: it sits on a wall the product already set aside as existing (the `existing` and
 *      `on-prior-plan` set-asides of `offeredCandidates`);
 *   2. `area`: it is inside a HATCHED area labelled not in contract / existing (`nicHatch`, the
 *      wall rule's own reading), or inside a closed DASHED box with such a label in it;
 *   3. `tag`: its tag carries (E): a mark ending `(E)` (`N141 (E)`) or `EXISTING DOOR` within a
 *      leaf and a foot of it, or a bare `(E)` INSIDE its swing (UCCS's corridor doors). A bare `(E)`
 *      across the wall from the swing is a dimension's: E Street A2.1 prints `(E)` under the
 *      dimension of each new door's opening (E-9, E-10, E-11), and the first cut of this rule set
 *      those four real doors aside;
 *   4. `demo`: the paired demolition plan draws a door in the same place on a wall it does not
 *      remove (`priorPlanFor`'s `doors`): existing to remain.
 *
 * Pure. Positions in page-width units.
 */
export type ExistingDoor = { door: DoorSymbol; route: "wall" | "area" | "tag" | "demo"; why: string };

/** What a caller knows beyond the page itself. Both optional: without them routes 1 and 4 are silent. */
export type ExistingDoorEvidence = {
  /** Walls set aside as existing, page-width units. */
  asideWalls?: readonly { x1: number; y1: number; x2: number; y2: number; thicknessFeet?: number }[];
  /** Doors the paired demolition plan keeps, moved onto this sheet. */
  priorDoors?: readonly { hinge: { x: number; y: number }; strike: { x: number; y: number } }[];
  /** The demolition plan's sheet number, for the sentence. */
  priorSheet?: string;
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

/** The walls `offeredCandidates` set aside as existing work (its own rules and plan comparison), for route 1. */
export function asideExistingWalls(lines: readonly { kind: string; x1: number; y1: number; x2: number; y2: number }[]): NonNullable<ExistingDoorEvidence["asideWalls"]> {
  return lines.filter((l) => l.kind === "existing" || l.kind === "on-prior-plan").map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
}

/** One sentence for the panel. */
export function existingDoorsSentence(list: readonly ExistingDoor[]): string {
  const n = (route: ExistingDoor["route"]) => list.filter((e) => e.route === route).length;
  const parts = [
    n("wall") > 0 ? `${n("wall")} on a wall set aside as existing` : "",
    n("area") > 0 ? `${n("area")} inside an area marked existing or not in contract` : "",
    n("tag") > 0 ? `${n("tag")} tagged (E)` : "",
    n("demo") > 0 ? `${n("demo")} kept on the demolition plan` : "",
  ].filter((s) => s !== "");
  return `${list.length} existing door${list.length === 1 ? "" : "s"} set aside: ${parts.join("; ")}`;
}

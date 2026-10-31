import type { DoorSymbol, WindowSymbol } from "./doorWindowSymbols";
import type { FinishRow, FinishSchedule, TextItem } from "./finishSchedule";
import type { RoomFromWalls } from "./roomsFromWalls";

/** A door opening's height, feet, for the paint deduction. Doors are drawn in plan, so no sheet says. */
export const DOOR_HEIGHT_FEET = 7;
/** A window's height, feet. Assumed for the same reason, and the panel says so. */
export const WINDOW_HEIGHT_FEET = 4;
/** An opening counts on a wall when its centre lies this close to the room's edge. */
export const OPENING_REACH_FEET = 1.5;

/** Nothing to install: "EX CT" is the existing tile, so it is not new work. "EX ACT/PT-2" is kept, since the paint is new. */
const NO_FINISH = /^(EX(IST(ING)?)?(\s+[A-Z]+)?|EXPOSED|NONE|N\/?A|NOT USED)\.?$/i;
const finishOf = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === "" || NO_FINISH.test(v.trim()) ? null : v.trim());

export type FinishKind = "floor" | "base" | "wall" | "ceiling";

export type FinishLine = { kind: FinishKind; finish: string; quantity: number; unit: "sq ft" | "lin ft"; rooms: number };

export type FinishTakeoff = {
  lines: FinishLine[];
  joined: { room: RoomFromWalls; row: FinishRow }[];
  /** Regions holding several scheduled rooms, joined only for the finishes those rooms share. */
  shared: { room: RoomFromWalls; rows: FinishRow[]; differ: FinishKind[] }[];
  /** Found rooms the schedule says nothing about. */
  unjoinedRooms: RoomFromWalls[];
  /** Schedule rows with no found room, so their quantities are missing. */
  unjoinedRows: FinishRow[];
  /** Rooms with no height: their wall area is left out, never guessed. */
  noHeight: RoomFromWalls[];
  doorsDeducted: number;
  windowsDeducted: number;
};

/**
 * The finish-type tag standing inside each room, for a schedule of types. A room
 * holding two different types is two rooms the finder merged, so it joins to
 * neither: pricing it as one prices part of it wrong.
 */
export function typeTagsInRooms(rooms: readonly RoomFromWalls[], items: readonly TextItem[], widthPt: number, typeKeys: ReadonlySet<string>): Map<number, string> {
  const found = new Map<number, Set<string>>();
  for (const t of items) {
    const key = t.str.trim().toUpperCase().replace(/-/g, "");
    if (!typeKeys.has(key)) continue;
    const x = (t.x + t.width / 2) / widthPt, y = (t.y - t.height / 2) / widthPt;
    for (const room of rooms) if (inside(x, y, room.xs, room.ys)) found.set(room.id, (found.get(room.id) ?? new Set()).add(key));
  }
  return new Map([...found].filter(([, keys]) => keys.size === 1).map(([id, keys]) => [id, [...keys][0]]));
}

/**
 * What several rooms in one leaked region have in common. Their areas cannot be
 * told apart, so a finish counts only where every one of them has it: which
 * room a square foot belongs to then changes nothing. The rest is left out and named.
 */
function commonFinishes(rows: readonly FinishRow[]): { row: FinishRow; differ: FinishKind[] } {
  const differ: FinishKind[] = [];
  const same = (kind: FinishKind, value: (r: FinishRow) => string | null) => {
    const first = value(rows[0]);
    if (rows.every((r) => value(r) === first)) return first;
    if (!differ.includes(kind)) differ.push(kind);
    return null;
  };
  const side = (s: "N" | "E" | "S" | "W") => same("wall", (r) => r.sides?.[s] ?? r.wall);
  const sided = rows.every((r) => r.sides !== null);
  return {
    differ,
    row: {
      key: rows.map((r) => r.key).join("+"),
      name: rows.map((r) => r.name).join(" + "),
      floor: same("floor", (r) => r.floor),
      base: same("base", (r) => r.base),
      wall: sided ? null : side("N"),
      sides: sided ? { N: side("N"), E: side("E"), S: side("S"), W: side("W") } : null,
      ceiling: same("ceiling", (r) => r.ceiling),
    },
  };
}

/** A takeoff line's words on the estimate, with what kind of finish it is. */
export function finishLineLabel(line: Pick<FinishLine, "kind" | "finish">): string {
  return `${{ floor: "Floor", base: "Base", wall: "Wall finish", ceiling: "Ceiling" }[line.kind]} ${line.finish}`;
}

/** Regions closer than this share a wall. */
const NEIGHBOUR_FEET = 1.5;
/** Smaller than this is a chase, not a room to floor. */
const SMALLEST_FINISHED_SQFT = 20;
/** A type taken from anything smaller is an elevator's or a closet's, which says nothing about the room beside it. */
const SMALLEST_TYPE_SOURCE_SQFT = 100;

/**
 * A unit carries one type tag and finds as several regions, so its kitchen and
 * bath come back with no tag (glen-hazel A-102). A group of untagged regions
 * takes a type only when every typed region touching the group has that same
 * type and is room-sized, so it cannot matter which of them it really belongs to. The panel counts these.
 */
export function typesFromNeighbours(rooms: readonly RoomFromWalls[], typed: ReadonlyMap<number, string>, feetPerUnit: number): Map<number, string> {
  const reach = NEIGHBOUR_FEET / feetPerUnit;
  const edges = new Map(rooms.map((r) => [r.id, roomEdges(r, feetPerUnit)]));
  const touch = (a: RoomFromWalls, b: RoomFromWalls) => a.xs.some((x, i) => edges.get(b.id)!.some((e) => distanceToEdge(x, a.ys[i], e) <= reach)) || b.xs.some((x, i) => edges.get(a.id)!.some((e) => distanceToEdge(x, b.ys[i], e) <= reach));
  const open = rooms.filter((r) => !typed.has(r.id) && r.tag === null && !r.sharedTags && r.squareFeet >= SMALLEST_FINISHED_SQFT);
  const out = new Map<number, string>();
  const seen = new Set<number>();
  for (const start of open) {
    if (seen.has(start.id)) continue;
    const group = [start];
    seen.add(start.id);
    for (let i = 0; i < group.length; i += 1) {
      for (const next of open) {
        if (!seen.has(next.id) && touch(group[i], next)) {
          seen.add(next.id);
          group.push(next);
        }
      }
    }
    const sources = rooms.filter((r) => typed.has(r.id) && group.some((g) => touch(g, r)));
    const types = new Set(sources.map((r) => typed.get(r.id)!));
    if (types.size === 1 && sources.every((r) => r.squareFeet >= SMALLEST_TYPE_SOURCE_SQFT)) for (const g of group) out.set(g.id, [...types][0]);
  }
  return out;
}

function inside(x: number, y: number, xs: readonly number[], ys: readonly number[]): boolean {
  let hit = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) {
    if (ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) hit = !hit;
  }
  return hit;
}

type Edge = { x1: number; y1: number; x2: number; y2: number; feet: number; side: "N" | "E" | "S" | "W" };

/** A room's edges, each named by the side of the room it is on. North is page-up; the panel says that is assumed. */
export function roomEdges(room: Pick<RoomFromWalls, "xs" | "ys">, feetPerUnit: number): Edge[] {
  const n = room.xs.length;
  const cx = room.xs.reduce((a, b) => a + b, 0) / n, cy = room.ys.reduce((a, b) => a + b, 0) / n;
  const edges: Edge[] = [];
  for (let i = 0; i < n; i += 1) {
    const x1 = room.xs[i], y1 = room.ys[i], x2 = room.xs[(i + 1) % n], y2 = room.ys[(i + 1) % n];
    const feet = Math.hypot(x2 - x1, y2 - y1) * feetPerUnit;
    if (feet === 0) continue;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const flat = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    edges.push({ x1, y1, x2, y2, feet, side: flat ? (my < cy ? "N" : "S") : mx < cx ? "W" : "E" });
  }
  return edges;
}

function distanceToEdge(x: number, y: number, e: Edge): number {
  const dx = e.x2 - e.x1, dy = e.y2 - e.y1, q = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - e.x1) * dx + (y - e.y1) * dy) / q));
  return Math.hypot(x - e.x1 - t * dx, y - e.y1 - t * dy);
}

/**
 * Floor, base, paintable wall and ceiling, per finish, from the rooms a schedule
 * names. A door or window comes off the wall it sits in, in each room it
 * touches, because both faces of that wall are finished. Base loses door widths
 * only. A room with no height gets no wall area rather than a guessed one.
 */
export function finishTakeoff(input: {
  rooms: readonly RoomFromWalls[];
  schedule: FinishSchedule;
  /** For a schedule of types: room id to type key. */
  typeOfRoom?: ReadonlyMap<number, string>;
  doors: readonly DoorSymbol[];
  windows: readonly WindowSymbol[];
  feetPerUnit: number;
  heightOf: (room: RoomFromWalls) => number | null;
}): FinishTakeoff {
  const { rooms, schedule, doors, windows, feetPerUnit, heightOf } = input;
  const byKey = new Map(schedule.rows.map((r) => [r.key, r]));
  const keyOf = (number: string | null | undefined) => number?.toUpperCase().replace(/[\s-]+/g, "");
  const joined: FinishTakeoff["joined"] = [];
  const shared: FinishTakeoff["shared"] = [];
  const unjoinedRooms: RoomFromWalls[] = [];
  const used = new Set<string>();
  for (const room of rooms) {
    const keys = schedule.byType ? [input.typeOfRoom?.get(room.id)] : (room.sharedTags ?? [room.tag]).map((t) => keyOf(t?.number));
    // Only tags the schedule knows count, so a stray keynote cannot unseat a real room.
    const rows = [...new Set(keys)].flatMap((k) => (k !== undefined && byKey.has(k) ? [byKey.get(k)!] : []));
    for (const r of rows) used.add(r.key);
    if (rows.length === 0) unjoinedRooms.push(room);
    else if (rows.length === 1) joined.push({ room, row: rows[0] });
    else {
      const common = commonFinishes(rows);
      shared.push({ room, rows, differ: common.differ });
      joined.push({ room, row: common.row });
    }
  }
  const unjoinedRows = schedule.byType ? [] : schedule.rows.filter((r) => !used.has(r.key));
  const totals = new Map<string, FinishLine & { seen: Set<number> }>();
  const add = (kind: FinishKind, finish: string | null, quantity: number, unit: FinishLine["unit"], room: number) => {
    const name = finishOf(finish);
    if (name === null || !(quantity > 0)) return;
    const k = `${kind}|${name}`;
    const at = totals.get(k) ?? { kind, finish: name, quantity: 0, unit, rooms: 0, seen: new Set<number>() };
    at.quantity += quantity;
    at.seen.add(room);
    at.rooms = at.seen.size;
    totals.set(k, at);
  };
  const noHeight: RoomFromWalls[] = [];
  const reach = OPENING_REACH_FEET / feetPerUnit;
  const doorMid = doors.map((d) => ({ x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2, w: d.widthFeet }));
  const winMid = windows.map((w) => ({ x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2, w: w.widthFeet }));
  const nearest = (edges: readonly Edge[], x: number, y: number) => {
    let best: Edge | null = null, d = reach;
    for (const e of edges) { const q = distanceToEdge(x, y, e); if (q <= d) { d = q; best = e; } }
    return best;
  };
  let doorsDeducted = 0, windowsDeducted = 0;
  for (const { room, row } of joined) {
    add("floor", row.floor, room.squareFeet, "sq ft", room.id);
    add("ceiling", row.ceiling, room.squareFeet, "sq ft", room.id);
    const edges = roomEdges(room, feetPerUnit);
    const scale = room.perimeterFeet / (edges.reduce((n, e) => n + e.feet, 0) || 1);
    const off = new Map<Edge, { door: number; window: number; doorWidth: number }>();
    const take = (e: Edge | null, kind: "door" | "window", w: number) => {
      if (e === null) return false;
      const at = off.get(e) ?? { door: 0, window: 0, doorWidth: 0 };
      if (kind === "door") { at.door += w * DOOR_HEIGHT_FEET; at.doorWidth += w; } else at.window += w * WINDOW_HEIGHT_FEET;
      off.set(e, at);
      return true;
    };
    for (const d of doorMid) if (take(nearest(edges, d.x, d.y), "door", d.w)) doorsDeducted += 1;
    for (const w of winMid) if (take(nearest(edges, w.x, w.y), "window", w.w)) windowsDeducted += 1;
    const height = heightOf(room);
    if (height === null) noHeight.push(room);
    for (const e of edges) {
      const o = off.get(e) ?? { door: 0, window: 0, doorWidth: 0 };
      add("base", row.base, Math.max(0, e.feet * scale - o.doorWidth), "lin ft", room.id);
      if (height !== null) add("wall", row.sides ? row.sides[e.side] : row.wall, Math.max(0, e.feet * scale * height - o.door - o.window), "sq ft", room.id);
    }
  }
  const order: FinishKind[] = ["floor", "base", "wall", "ceiling"];
  const lines = [...totals.values()].map(({ seen: _s, ...l }) => ({ ...l, quantity: Math.round(l.quantity * 100) / 100 })).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.finish.localeCompare(b.finish));
  return { lines, joined, shared, unjoinedRooms, unjoinedRows, noHeight, doorsDeducted, windowsDeducted };
}

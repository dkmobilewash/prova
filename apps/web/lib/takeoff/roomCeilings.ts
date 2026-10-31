import { ceilingsFromScheduleRows, type ScheduleCeiling } from "./ceilingSchedule";
import { familyOfPattern, legendSwatches, patternRound, windowRound, type PatternKind } from "./ceilingPattern";
import {
  pairTagsToRoomTags,
  readCeilingDefaults,
  readCeilingLegend,
  readCeilingTags,
  readKeynoteCeilings,
  readSetLegendPage,
  roomTagsUnderCeilingCodes,
  type CeilingFamily,
  type CeilingLegendRow,
  type UnitStroke,
} from "./ceilingTags";
import { readRoomTags, type PositionedText } from "./roomTags";
import { pointInRing } from "./drawTools";
import type { RoomFromWalls } from "./roomsFromWalls";
import type { TableRow } from "../plan-ingest/scheduleTable";

/**
 * ── THE CEILING OVER EACH ROOM THE ROOM FINDER CLOSED, FOR THE PANEL ──
 *
 * The rooms are on the floor plan the estimator is looking at. What is said
 * about their ceilings is on the same sheet (Murray, Albany), on the plan's
 * reflected ceiling plan pages, on a finish schedule page, or drawn as a
 * pattern on the current sheet. This takes all of those as the app can
 * hand them — text items per page, strokes for the current page only — and
 * answers per room with WHERE the answer came from, so the panel can say
 * "from the ceiling plan's tag" or "a guess from a code" and the estimator
 * can overrule it.
 *
 * Precedence per room: a tag on any page that says existing / no ceiling
 * (the words win); a tag; the schedule; the drawn pattern; the sheet's
 * note. Nothing here is saved; the panel saves what the estimator accepts.
 */
export type CeilingSource = "tag" | "schedule" | "pattern" | "note" | "prefix";

export type RoomCeiling = {
  family: CeilingFamily | null;
  code: string | null;
  heightFeet: number | null;
  from: CeilingSource | null;
  /** A prefix guess: the code's letters, not a legend, named the family. */
  guess: boolean;
  /** The page the answer was read from. */
  page: number | null;
  /** What was read, for the row's tooltip. */
  phrase: string | null;
};

export type CeilingPageText = {
  pageNumber: number;
  /** Points, y from the top — `PlanTextItem`'s convention. */
  items: readonly PositionedText[];
  widthPt: number;
  /** Table rows, for a schedule page; the app computes them with `tableRowsFromPage`. */
  tableRows?: readonly TableRow[];
  /**
   * The page's strokes in page-width units, when the caller has them. On a
   * ceiling plan they carry the HATCH — Joplin's RCP names no family in words
   * at all; grid, stipple and diagonal are the legend — so without them an
   * aligned RCP can only give heights.
   */
  strokes?: readonly UnitStroke[];
};

/**
 * ── THE SAME FOOTPRINT ON ANOTHER SHEET ──
 *
 * A reflected ceiling plan is the floor plan drawn again, usually at the same
 * scale and often at the same place on the sheet; its room tags then land
 * INSIDE the floor plan's rooms, and a room the floor plan never tagged (or
 * tagged with a name the RCP spells differently) is still the same room.
 * The page is read as aligned when, after one shift tried from every
 * (RCP room tag, floor room centre) pair — zero first — at least half of its
 * room tags fall inside a floor room, three at the least. Joplin A-103 lands
 * 55 of 71 at zero shift; Baker's A111 redraws the new block elsewhere with
 * its tags on leaders outside the rooms, and is not aligned by this test —
 * which is the right answer, not a miss.
 */
export type AlignedPage = { page: CeilingPageText; dx: number; dy: number; roomTags: { name: string; number: string | null; x: number; y: number }[]; hits: number };

export function alignCeilingPage(page: CeilingPageText, rooms: readonly RoomFromWalls[]): AlignedPage | null {
  const roomTags = readRoomTags(page.items).map((t) => ({ name: t.name, number: t.number, x: t.x / page.widthPt, y: t.y / page.widthPt }));
  if (roomTags.length < 3 || rooms.length === 0) return null;
  const need = Math.max(3, Math.ceil(roomTags.length / 2));
  const inRoom = (x: number, y: number) => rooms.some((r) => pointInRing(x, y, r.xs, r.ys));
  const score = (dx: number, dy: number) => roomTags.filter((t) => inRoom(t.x - dx, t.y - dy)).length;
  let best = { dx: 0, dy: 0, hits: score(0, 0) };
  if (best.hits < roomTags.length) {
    const centres = rooms.slice(0, 80).map((r) => ({ x: r.xs.reduce((a, b) => a + b, 0) / r.xs.length, y: r.ys.reduce((a, b) => a + b, 0) / r.ys.length }));
    const tried = new Set<string>();
    for (const t of roomTags.slice(0, 80)) {
      for (const c of centres) {
        const dx = Math.round((t.x - c.x) * 500) / 500, dy = Math.round((t.y - c.y) * 500) / 500;
        const key = `${dx}:${dy}`;
        if (tried.has(key)) continue;
        tried.add(key);
        const hits = score(dx, dy);
        if (hits > best.hits) best = { dx, dy, hits };
      }
    }
  }
  return best.hits >= need ? { page, ...best, roomTags } : null;
}

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9#]+/g, " ").trim();
/** A page that says it is a ceiling plan, or carries a ceiling legend: the only pages whose TAGS are ceiling tags. */
const CEILING_PAGE = /REFLECTED\s+CEILING|\bRCP\b|CEILING\s+PLAN|CEILING\s+(?:LEGEND|TYPES?|FINISH)|RCP\s+LEGEND/i;
const saysCeilingPlan = (p: CeilingPageText) => p.items.some((i) => CEILING_PAGE.test(i.str));
/** Baker's floor plan says CALL CENTER 111 where its ceiling plan says 911 CALL CENTER: one name inside the other, four letters or more. */
const sameName = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || (x.length >= 4 && y.length >= 4 && (x.endsWith(" " + y) || y.endsWith(" " + x) || x.startsWith(y + " ") || y.startsWith(x + " ")));
};

export function ceilingsForRooms(input: {
  rooms: readonly RoomFromWalls[];
  current: CeilingPageText;
  /** Strokes of the current page in page-width units, for the pattern. */
  strokes?: readonly UnitStroke[];
  feetPerUnit: number;
  /** The plan's other pages that look like a ceiling plan or a schedule. */
  others?: readonly CeilingPageText[];
}): Map<number, RoomCeiling> {
  const out = new Map<number, RoomCeiling>();
  const pages = [input.current, ...(input.others ?? [])];
  // The legend, from every page handed in; a page's own rows first.
  const legendByPage = new Map<number, CeilingLegendRow[]>();
  const setRows: CeilingLegendRow[] = [];
  for (const p of pages) for (const r of readSetLegendPage(p.items, p.widthPt, p.pageNumber)) if (!setRows.some((x) => x.code.toUpperCase() === r.code.toUpperCase())) setRows.push(r);
  for (const p of pages) {
    const own = readCeilingLegend(p.items, p.widthPt);
    const keynotes = readKeynoteCeilings(p.items, p.widthPt);
    legendByPage.set(p.pageNumber, [
      ...own,
      ...keynotes.filter((k) => !own.some((r) => r.code === k.code)),
      ...setRows.filter((r) => !own.some((x) => x.code.toUpperCase() === r.code.toUpperCase()) && !keynotes.some((k) => k.code === r.code)),
    ]);
  }
  // Schedule rows, from any page with a table that has a ceiling column.
  const schedule: ScheduleCeiling[] = pages.flatMap((p) => (p.tableRows ? ceilingsFromScheduleRows(p.tableRows) : []));
  const scheduled = (room: RoomFromWalls) =>
    room.tag === null
      ? null
      : (schedule.find((r) => (room.tag!.number && norm(r.number) === norm(room.tag!.number)) || (room.tag!.name && r.name && norm(r.name) === norm(room.tag!.name))) ?? null);
  // Per page: its ceiling tags paired to its printed room tags, then joined to our rooms by number or name.
  type Found = { family: CeilingFamily | null; code: string | null; heightFeet: number | null; from: CeilingSource; guess: boolean; page: number; phrase: string | null; existing: boolean };
  const byRoomKey = new Map<string, Found>();
  const keysOf = (tag: { number: string | null; name: string }) => [tag.number ? `#${norm(tag.number)}` : null, tag.name ? `@${norm(tag.name)}` : null].filter((k): k is string => k !== null);
  for (const p of pages) {
    // A floor plan's figures are dimensions, not ceiling heights: the sheet the rooms
    // were found on is a TAG source only when it says it is a ceiling plan too (Murray).
    if (p === input.current && !saysCeilingPlan(p)) continue;
    const legend = legendByPage.get(p.pageNumber) ?? [];
    const defaults = readCeilingDefaults(p.items, p.widthPt);
    const tags = readCeilingTags(p.items, p.widthPt, legend, p === input.current ? (input.strokes ?? []) : []);
    if (tags.length === 0) continue;
    const roomTags = roomTagsUnderCeilingCodes(
      readRoomTags(p.items).map((r) => ({ name: r.name, number: r.number, x: r.x, y: r.y })),
      p.items,
      p.widthPt,
      legend,
    );
    const paired = pairTagsToRoomTags(roomTags, tags, p.widthPt, input.feetPerUnit, defaults, 25, p === input.current ? input.rooms : []);
    for (const c of paired) {
      if (c.tags.length === 0) continue;
      const first = c.tags.find((t) => t.family !== null) ?? c.tags[0];
      const found: Found = {
        family: c.family,
        code: c.code,
        heightFeet: c.heightFeet,
        from: first.familyFrom === "prefix" ? "prefix" : "tag",
        guess: first.familyFrom === "prefix",
        page: p.pageNumber,
        phrase: c.tags.map((t) => t.phrase).join("; "),
        existing: c.existing,
      };
      for (const k of keysOf(c.room)) if (!byRoomKey.has(k) || (found.existing && !byRoomKey.get(k)!.existing)) byRoomKey.set(k, found);
    }
    // Baker's stacks name the room over the code and the page may print no room tag at all.
    for (const t of tags) {
      if (t.roomName === null) continue;
      const k = `@${norm(t.roomName)}`;
      if (byRoomKey.has(k)) continue;
      byRoomKey.set(k, { family: t.family, code: t.code, heightFeet: t.heightFeet, from: t.familyFrom === "prefix" ? "prefix" : "tag", guess: t.familyFrom === "prefix", page: p.pageNumber, phrase: t.phrase, existing: t.existing === true });
    }
  }
  const swatches = input.strokes ? legendSwatches(input.current.items, input.strokes, input.current.widthPt) : new Map();
  const defaults = readCeilingDefaults(input.current.items, input.current.widthPt);
  const roomTagsHere = input.rooms.filter((r) => r.tag).map((r) => ({ x: r.tag!.x, y: r.tag!.y }));
  // The ceiling plans drawn over the same footprint, with what each one's
  // own hatch legend says and the note it carries (Joplin: ALL CEILINGS 9'-0" AFF U.N.O.).
  const aligned = (input.others ?? [])
    .filter((p) => p !== input.current && saysCeilingPlan(p))
    .map((p) => alignCeilingPage(p, input.rooms))
    .filter((a): a is AlignedPage => a !== null)
    .map((a) => ({
      ...a,
      swatches: a.page.strokes ? legendSwatches(a.page.items, a.page.strokes, a.page.widthPt) : new Map<PatternKind, CeilingFamily>(),
      defaults: readCeilingDefaults(a.page.items, a.page.widthPt),
    }));
  const centre = (room: RoomFromWalls) => ({ x: room.xs.reduce((a, b) => a + b, 0) / room.xs.length, y: room.ys.reduce((a, b) => a + b, 0) / room.ys.length });
  for (const room of input.rooms) {
    const keys = room.tag ? keysOf(room.tag) : [];
    let tagged = keys.map((k) => byRoomKey.get(k)).find((f): f is Found => f !== undefined) ?? null;
    if (tagged === null && room.tag?.name) {
      const near = [...byRoomKey.entries()].find(([k]) => k.startsWith("@") && sameName(k.slice(1), room.tag!.name));
      tagged = near ? near[1] : null;
    }
    // ── BY POSITION: the RCP's room tag that sits inside this room ──
    // The join above needs the floor plan's own tag; a room it never tagged,
    // or tagged under another spelling, is found by where the RCP printed its.
    const onRcp: { a: (typeof aligned)[number]; at: { x: number; y: number } }[] = [];
    for (const a of aligned) {
      const inside = a.roomTags.filter((t) => pointInRing(t.x - a.dx, t.y - a.dy, room.xs, room.ys));
      if (inside.length === 1) {
        onRcp.push({ a, at: { x: inside[0]!.x, y: inside[0]!.y } });
        if (tagged === null) tagged = keysOf(inside[0]!).map((k) => byRoomKey.get(k)).find((f): f is Found => f !== undefined) ?? null;
      } else if (inside.length === 0) {
        const c = centre(room);
        onRcp.push({ a, at: { x: c.x + a.dx, y: c.y + a.dy } });
      }
      // Two tags inside: the room leaked into its neighbour; nothing is read for it here.
    }
    // ── BY HATCH, ON THE RCP: the family the legend draws over the room ──
    // A tag that named a family stands; a tag with only a height (Joplin's
    // 9'-0" hexagons) takes the family the hatch says.
    if ((tagged === null || tagged.family === null) && !tagged?.existing) {
      for (const { a, at } of onRcp) {
        if (!a.page.strokes) continue;
        // `windowRound` takes points; the aligned page's tags and this point are page-width units.
        const W = a.page.widthPt;
        const w = windowRound({ x: at.x * W, y: at.y * W }, a.roomTags.map((t) => ({ x: t.x * W, y: t.y * W })), W, input.feetPerUnit);
        const pattern = patternRound(a.page.strokes, w, input.feetPerUnit);
        const family = familyOfPattern(pattern.kind, a.swatches);
        if (family === null) continue;
        const spacing = pattern.kind === "grid" && pattern.spacingFeet.x && pattern.spacingFeet.y ? `${Math.round(pattern.spacingFeet.x)}x${Math.round(pattern.spacingFeet.y)} grid` : pattern.kind;
        const heightFeet = tagged?.heightFeet ?? a.defaults.heightFeet;
        out.set(room.id, { family, code: tagged?.code ?? null, heightFeet, from: "pattern", guess: false, page: a.page.pageNumber, phrase: tagged?.phrase ? `${tagged.phrase}; ${spacing}` : spacing });
        break;
      }
      if (out.has(room.id)) continue;
    }
    if (tagged !== null && (tagged.existing || tagged.family !== null || tagged.heightFeet !== null)) {
      out.set(room.id, { family: tagged.family, code: tagged.code, heightFeet: tagged.heightFeet, from: tagged.from, guess: tagged.guess, page: tagged.page, phrase: tagged.phrase });
      continue;
    }
    const sched = scheduled(room);
    if (sched !== null && (sched.family !== null || sched.heightFeet !== null)) {
      out.set(room.id, { family: sched.family, code: sched.finish, heightFeet: sched.heightFeet, from: "schedule", guess: false, page: null, phrase: `${sched.finish ?? ""}${sched.heightFeet ? ` ${sched.heightFeet} ft` : ""}`.trim() || null });
      continue;
    }
    if (input.strokes && room.tag) {
      const w = windowRound({ x: room.tag.x, y: room.tag.y }, roomTagsHere, input.current.widthPt, input.feetPerUnit);
      const pattern = patternRound(input.strokes, w, input.feetPerUnit);
      const family = familyOfPattern(pattern.kind, swatches);
      if (family !== null) {
        const spacing = pattern.kind === "grid" && pattern.spacingFeet.x && pattern.spacingFeet.y ? `${Math.round(pattern.spacingFeet.x)}x${Math.round(pattern.spacingFeet.y)} grid` : pattern.kind;
        out.set(room.id, { family, code: null, heightFeet: defaults.heightFeet, from: "pattern", guess: false, page: input.current.pageNumber, phrase: spacing });
        continue;
      }
    }
    if (defaults.family !== null || defaults.heightFeet !== null) {
      out.set(room.id, { family: defaults.family, code: null, heightFeet: defaults.heightFeet, from: "note", guess: false, page: input.current.pageNumber, phrase: defaults.phrase });
      continue;
    }
    // The aligned ceiling plan's own note, when the floor plan has none.
    const noted = onRcp.find(({ a }) => a.defaults.family !== null || a.defaults.heightFeet !== null);
    if (noted) {
      out.set(room.id, { family: noted.a.defaults.family, code: null, heightFeet: noted.a.defaults.heightFeet, from: "note", guess: false, page: noted.a.page.pageNumber, phrase: noted.a.defaults.phrase });
      continue;
    }
    out.set(room.id, { family: null, code: null, heightFeet: null, from: null, guess: false, page: null, phrase: null });
  }
  return out;
}

/** Square feet per family over rooms, for the sheet's and the job's summary line. */
export function ceilingSummary(rows: readonly { family: string | null; squareFeet: number; code?: string | null }[]): { label: string; family: string; squareFeet: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const key = r.family === null ? "unknown" : r.code && /grid|x/i.test(r.code) && r.family === "ACT" ? `${r.family} ${r.code}` : r.family;
    by.set(key, (by.get(key) ?? 0) + r.squareFeet);
  }
  const label = (k: string) => (k === "ACT" ? "acoustical tile" : k === "GYP" ? "gypsum board" : k === "OPEN" ? "open to structure" : k === "OTHER" ? "other" : k === "unknown" ? "no ceiling read" : k.replace(/^ACT /, "ACT "));
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([family, squareFeet]) => ({ label: label(family), family, squareFeet }));
}

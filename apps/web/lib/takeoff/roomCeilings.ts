import { ceilingsFromScheduleRows, type ScheduleCeiling } from "./ceilingSchedule";
import { familyOfPattern, legendSwatches, patternRound, windowRound } from "./ceilingPattern";
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
};

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
  for (const room of input.rooms) {
    const keys = room.tag ? keysOf(room.tag) : [];
    let tagged = keys.map((k) => byRoomKey.get(k)).find((f): f is Found => f !== undefined) ?? null;
    if (tagged === null && room.tag?.name) {
      const near = [...byRoomKey.entries()].find(([k]) => k.startsWith("@") && sameName(k.slice(1), room.tag!.name));
      tagged = near ? near[1] : null;
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

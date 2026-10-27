import { toCsv } from "@/lib/export";
import { polylineLength, ringPerimeter } from "@/lib/sheet-geometry";
import { studsRequired, trackRequired } from "@/lib/takeoff";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { cutoutsFromJson, netArea } from "./itemQuantities";

/**
 * ── THE TAKEOFF SUMMARY: what the ESTIMATOR accepted, by sheet, no prices ──
 *
 * One pure function from the takeoff's rows to the lines an estimator sends
 * or keeps. Only what somebody put on the takeoff is in it:
 *
 *   - walls: LINEAR measurements. "Add as S8B — priced" writes the group's
 *     runs as measurements with a `WallRun` naming the type and height, so a
 *     TYPED wall is a measurement with a wall run. Those add up by type with
 *     feet, height, board, studs and track. A LINEAR measurement with no wall
 *     run ("Add these", or a hand-traced line) is an UNTYPED wall: one block,
 *     by its label, FEET ONLY — no studs, track or board, because a quantity
 *     needs a type and guessing one is what this file refuses.
 *   - rooms: AREA measurements the room finder saved, or any area carrying a
 *     room name/number. Named rooms first; unnamed ones marked and last.
 *   - ceilings: the rooms again, added up by the ceiling type each room
 *     carries (code when the drawing printed one, else the family), with the
 *     rooms nobody read a ceiling for on their own line. A guessed ceiling
 *     the estimator never confirmed is counted and SAID to be a guess.
 *   - areas: every other AREA measurement, by the item it belongs to — the
 *     item IS the type; nothing on a measurement says "ceiling".
 *   - doors: the newest DOOR schedule read per sheet that nobody rejected.
 *
 * The finder's raw groups (`TakeoffWallProposal`) are NOT here. They are
 * what the viewer offers; a group somebody never pressed Add on is not a
 * takeoff.
 *
 * FLOOR PLANS ONLY. A sheet whose index says schedule, section, elevation or
 * cover is left out even when something was measured on it, and the summary
 * SAYS so (`leftOut`), so nothing disappears in silence.
 *
 * Board square feet is feet × height × sides with no opening deduction: the
 * wall run records opening widths, not heights. A measurement is read at its
 * OWN calibration, the way `itemQuantity` reads it.
 */

export type SummaryMeasurement = {
  kind: "LINEAR" | "AREA" | "COUNT";
  xs: number[];
  ys: number[];
  cutouts: { xs: number[]; ys: number[] }[];
  label: string | null;
  itemId: string | null;
  source: string;
  roomName: string | null;
  roomNumber: string | null;
  /** Set when "Add as <type> — priced" posted this run against a wall type. */
  wallRun: { wallTypeId: string; heightFt: number | null } | null;
  /** The ceiling over a room, when one was read or typed. */
  ceiling: { family: string | null; code: string | null; heightFeet: number | null; guess: boolean } | null;
  /** Feet per page-width unit at the measurement's OWN calibration; null when unreadable. */
  feetPerUnit: number | null;
};

export type SummarySheet = {
  pageNumber: number;
  /** `sheetLabelByPage` — "A101 — FIRST FLOOR PLAN" — or null when the set has no index. */
  label: string | null;
  /** Why the index says this is not a floor plan, or null when it is one (or unknown). */
  notFloorPlan: string | null;
  measurements: SummaryMeasurement[];
};

export type SummaryWallType = {
  id: string;
  code: string;
  defaultHeightFt: number | null;
  sides: number;
  studSpacingIn: number;
};

export type SummaryDoorSheet = {
  pageNumber: number;
  rows: { mark: string; description: string | null; size: string | null; quantity: number | null; notes: string | null }[];
};

export type SummaryInput = {
  sheets: SummarySheet[];
  wallTypes: SummaryWallType[];
  items: { id: string; name: string }[];
  /** The newest unrejected DOOR schedule read per sheet. */
  doors: SummaryDoorSheet[];
};

export type WallLine = {
  typeCode: string;
  linearFt: number;
  /** One height when every run shares it; null when they differ or none is known. */
  heightFt: number | null;
  boardSqFt: number | null;
  studs: number;
  trackFt: number;
  runs: number;
  sheets: string[];
};
export type UntypedWallLine = { name: string; linearFt: number; runs: number; sheets: string[] };
export type RoomLine = { name: string; number: string | null; named: boolean; squareFeet: number; perimeterFt: number; sheet: string };
export type AreaLine = { item: string; measurements: number; squareFeet: number; perimeterFt: number; sheets: string[] };
export type CeilingLine = {
  /** The drawing's code (`GB`, `C2`) or the family (`ACT`, `GYP`) when it printed none; `NO_CEILING_TYPE` for rooms nobody read. */
  type: string;
  rooms: number;
  squareFeet: number;
  /** One height when every room shares it, else null. */
  heightFeet: number | null;
  guessed: number;
  sheets: string[];
};
export type DoorLine = {
  mark: string;
  description: string | null;
  size: string | null;
  quantity: number;
  notes: string | null;
  sheet: string;
};
export type LeftOut = { sheet: string; why: string; measurements: number };
export type SheetMarkup = {
  pageNumber: number;
  label: string;
  runs: { xs: number[]; ys: number[]; name: string }[];
  polygons: { xs: number[]; ys: number[]; name: string; kind: "room" | "area" }[];
};

export type TakeoffSummary = {
  walls: WallLine[];
  untypedWalls: UntypedWallLine[];
  rooms: RoomLine[];
  ceilings: CeilingLine[];
  areas: AreaLine[];
  doors: DoorLine[];
  leftOut: LeftOut[];
  sheets: SheetMarkup[];
};

export const UNTYPED = "Untyped";
export const UNNAMED_ROOM = "(unnamed)";
export const NO_CEILING_TYPE = "(no ceiling type on the room)";

const round1 = (n: number) => Math.round(n * 10) / 10;
export const sheetName = (sheet: { pageNumber: number; label: string | null }) => sheet.label ?? `Sheet ${sheet.pageNumber}`;

const isRoom = (m: SummaryMeasurement) =>
  m.kind === "AREA" && (m.source === "ROOM_FINDER" || m.roomName !== null || m.roomNumber !== null);

export function takeoffSummary(input: SummaryInput): TakeoffSummary {
  const typeById = new Map(input.wallTypes.map((type) => [type.id, type]));
  const itemById = new Map(input.items.map((item) => [item.id, item.name]));
  type Acc<T> = T & { sheetSet: Set<string> };
  const walls = new Map<string, Acc<WallLine> & { heights: Set<number | null>; board: number }>();
  const untyped = new Map<string, Acc<UntypedWallLine>>();
  const areas = new Map<string, Acc<AreaLine>>();
  const ceilings = new Map<string, Acc<CeilingLine> & { heights: Set<number | null> }>();
  const rooms: RoomLine[] = [];
  const leftOut: LeftOut[] = [];
  const sheets: SheetMarkup[] = [];

  for (const sheet of input.sheets) {
    const label = sheetName(sheet);
    if (sheet.notFloorPlan !== null) {
      if (sheet.measurements.length > 0) leftOut.push({ sheet: label, why: sheet.notFloorPlan, measurements: sheet.measurements.length });
      continue;
    }
    const markup: SheetMarkup = { pageNumber: sheet.pageNumber, label, runs: [], polygons: [] };
    for (const m of sheet.measurements) {
      if (m.feetPerUnit === null) continue;
      if (m.kind === "LINEAR") {
        const feet = polylineLength(m.xs, m.ys) * m.feetPerUnit;
        const type = m.wallRun === null ? null : (typeById.get(m.wallRun.wallTypeId) ?? null);
        if (type === null) {
          const name = (m.itemId === null ? null : itemById.get(m.itemId)) ?? m.label ?? "Unlabelled";
          const line =
            untyped.get(name) ?? untyped.set(name, { name, linearFt: 0, runs: 0, sheets: [], sheetSet: new Set() }).get(name)!;
          line.linearFt += feet;
          line.runs += 1;
          line.sheetSet.add(label);
          markup.runs.push({ xs: m.xs, ys: m.ys, name: UNTYPED });
          continue;
        }
        const line =
          walls.get(type.code) ??
          walls
            .set(type.code, {
              typeCode: type.code,
              linearFt: 0,
              heightFt: null,
              boardSqFt: null,
              studs: 0,
              trackFt: 0,
              runs: 0,
              sheets: [],
              sheetSet: new Set(),
              heights: new Set(),
              board: 0,
            })
            .get(type.code)!;
        const height = m.wallRun?.heightFt ?? type.defaultHeightFt;
        line.linearFt += feet;
        line.runs += 1;
        line.heights.add(height);
        if (height !== null) line.board += feet * height * (type.sides === 1 ? 1 : 2);
        line.studs += studsRequired(feet, { spacingFt: type.studSpacingIn > 0 ? type.studSpacingIn / 12 : undefined });
        line.trackFt += trackRequired(feet);
        line.sheetSet.add(label);
        markup.runs.push({ xs: m.xs, ys: m.ys, name: type.code });
        continue;
      }
      if (m.kind !== "AREA") continue;
      const squareFeet = round1(netArea(m.xs, m.ys, m.cutouts) * m.feetPerUnit * m.feetPerUnit);
      const perimeterFt = round1((ringPerimeter(m.xs, m.ys) ?? 0) * m.feetPerUnit);
      if (isRoom(m)) {
        const name = m.roomName ?? m.label;
        rooms.push({ name: name ?? UNNAMED_ROOM, number: m.roomNumber, named: name !== null || m.roomNumber !== null, squareFeet, perimeterFt, sheet: label });
        const ceilingType = m.ceiling?.code ?? m.ceiling?.family ?? NO_CEILING_TYPE;
        const ceiling =
          ceilings.get(ceilingType) ??
          ceilings
            .set(ceilingType, { type: ceilingType, rooms: 0, squareFeet: 0, heightFeet: null, guessed: 0, sheets: [], sheetSet: new Set(), heights: new Set() })
            .get(ceilingType)!;
        ceiling.rooms += 1;
        ceiling.squareFeet += squareFeet;
        ceiling.heights.add(m.ceiling?.heightFeet ?? null);
        if (m.ceiling?.guess) ceiling.guessed += 1;
        ceiling.sheetSet.add(label);
        markup.polygons.push({ xs: m.xs, ys: m.ys, name: [m.roomNumber, name ?? UNNAMED_ROOM].filter(Boolean).join(" "), kind: "room" });
        continue;
      }
      const item = (m.itemId === null ? null : itemById.get(m.itemId)) ?? "Unassigned areas";
      const line =
        areas.get(item) ??
        areas.set(item, { item, measurements: 0, squareFeet: 0, perimeterFt: 0, sheets: [], sheetSet: new Set() }).get(item)!;
      line.measurements += 1;
      line.squareFeet += squareFeet;
      line.perimeterFt += perimeterFt;
      line.sheetSet.add(label);
      markup.polygons.push({ xs: m.xs, ys: m.ys, name: item, kind: "area" });
    }
    if (markup.runs.length > 0 || markup.polygons.length > 0) sheets.push(markup);
  }

  const labelOf = new Map(input.sheets.map((sheet) => [sheet.pageNumber, sheetName(sheet)]));
  const doors: DoorLine[] = input.doors.flatMap((sheet) =>
    sheet.rows.map((row) => ({
      mark: row.mark,
      description: row.description,
      size: row.size,
      quantity: row.quantity ?? 1,
      notes: row.notes,
      sheet: labelOf.get(sheet.pageNumber) ?? `Sheet ${sheet.pageNumber}`,
    })),
  );

  // Named rooms first, by number then name; unnamed last, in the order traced.
  const byRoom = (a: RoomLine, b: RoomLine) =>
    Number(b.named) - Number(a.named) || (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true }) || a.name.localeCompare(b.name);

  return {
    walls: [...walls.values()]
      .sort((a, b) => a.typeCode.localeCompare(b.typeCode, undefined, { numeric: true }))
      .map(({ sheetSet, heights, board, ...line }) => {
        const one = heights.size === 1 ? [...heights][0] : null;
        return {
          ...line,
          linearFt: round1(line.linearFt),
          trackFt: round1(line.trackFt),
          heightFt: one,
          boardSqFt: heights.has(null) ? null : round1(board),
          sheets: [...sheetSet],
        };
      }),
    untypedWalls: [...untyped.values()]
      .sort((a, b) => b.linearFt - a.linearFt)
      .map(({ sheetSet, ...line }) => ({ ...line, linearFt: round1(line.linearFt), sheets: [...sheetSet] })),
    rooms: rooms.sort(byRoom),
    ceilings: [...ceilings.values()]
      .sort((a, b) => Number(a.type === NO_CEILING_TYPE) - Number(b.type === NO_CEILING_TYPE) || b.squareFeet - a.squareFeet)
      .map(({ sheetSet, heights, ...line }) => ({
        ...line,
        squareFeet: round1(line.squareFeet),
        heightFeet: heights.size === 1 ? [...heights][0] : null,
        sheets: [...sheetSet],
      })),
    areas: [...areas.values()].map(({ sheetSet, ...line }) => ({
      ...line,
      squareFeet: round1(line.squareFeet),
      perimeterFt: round1(line.perimeterFt),
      sheets: [...sheetSet],
    })),
    doors,
    leftOut,
    sheets,
  };
}

export const SUMMARY_CSV_COLUMNS = [
  "section",
  "name",
  "description",
  "size",
  "quantity",
  "unit",
  "linear_ft",
  "height_ft",
  "board_sqft",
  "studs",
  "track_ft",
  "area_sqft",
  "perimeter_ft",
  "sheets",
  "notes",
] as const;

/** One table, opens in a spreadsheet; blank where a figure does not apply. */
export function takeoffSummaryCsv(summary: TakeoffSummary): string {
  const rows: Record<string, unknown>[] = [];
  const runs = (n: number) => `${n} run${n === 1 ? "" : "s"}`;
  for (const w of summary.walls) {
    rows.push({
      section: "Walls",
      name: w.typeCode,
      description: runs(w.runs),
      quantity: w.linearFt,
      unit: "ft",
      linear_ft: w.linearFt,
      height_ft: w.heightFt ?? "",
      board_sqft: w.boardSqFt ?? "",
      studs: w.studs,
      track_ft: w.trackFt,
      sheets: w.sheets.join("; "),
      notes: w.heightFt === null && w.boardSqFt !== null ? "heights vary by run" : "",
    });
  }
  for (const u of summary.untypedWalls) {
    rows.push({
      section: "Untyped walls",
      name: u.name,
      description: runs(u.runs),
      quantity: u.linearFt,
      unit: "ft",
      linear_ft: u.linearFt,
      sheets: u.sheets.join("; "),
      notes: "no type: feet only",
    });
  }
  for (const r of summary.rooms) {
    rows.push({
      section: "Rooms",
      name: r.name,
      description: r.number ?? "",
      quantity: r.squareFeet,
      unit: "sq ft",
      area_sqft: r.squareFeet,
      perimeter_ft: r.perimeterFt,
      sheets: r.sheet,
      notes: r.named ? "" : "unnamed on the drawing",
    });
  }
  for (const c of summary.ceilings) {
    rows.push({
      section: "Ceilings",
      name: c.type,
      description: `${c.rooms} room${c.rooms === 1 ? "" : "s"}`,
      quantity: c.squareFeet,
      unit: "sq ft",
      height_ft: c.heightFeet ?? "",
      area_sqft: c.squareFeet,
      sheets: c.sheets.join("; "),
      notes: c.guessed > 0 ? `${c.guessed} guessed, not confirmed` : "",
    });
  }
  for (const a of summary.areas) {
    rows.push({
      section: "Areas",
      name: a.item,
      description: `${a.measurements} measurement${a.measurements === 1 ? "" : "s"}`,
      quantity: a.squareFeet,
      unit: "sq ft",
      area_sqft: a.squareFeet,
      perimeter_ft: a.perimeterFt,
      sheets: a.sheets.join("; "),
    });
  }
  for (const d of summary.doors) {
    rows.push({
      section: "Doors",
      name: d.mark,
      description: d.description ?? "",
      size: d.size ?? "",
      quantity: d.quantity,
      unit: "ea",
      sheets: d.sheet,
      notes: d.notes ?? "",
    });
  }
  for (const l of summary.leftOut) {
    rows.push({
      section: "Left out",
      name: l.sheet,
      description: `${l.measurements} measurement${l.measurements === 1 ? "" : "s"} not exported`,
      sheets: l.sheet,
      notes: `not a floor plan: ${l.why}`,
    });
  }
  return toCsv([...SUMMARY_CSV_COLUMNS], rows.map((row) => Object.fromEntries(SUMMARY_CSV_COLUMNS.map((c) => [c, row[c] ?? ""]))));
}

/**
 * The adapter from what the takeoff page already loads (`loadTakeoffWorkspace`
 * plus the plan's schedule reads) to the pure input above. Typed structurally
 * so a test can hand it rows without a database.
 */
export function summaryInputFrom(data: {
  plan: {
    pages: {
      pageNumber: number;
      measurements: {
        kind: "LINEAR" | "AREA" | "COUNT";
        xs: number[];
        ys: number[];
        cutouts: unknown;
        label: string | null;
        itemId: string | null;
        source: string;
        roomName: string | null;
        roomNumber: string | null;
        ceilingFamily: string | null;
        ceilingCode: string | null;
        ceilingHeightFeet: number | null;
        ceilingGuess: boolean;
        wallRun: { wallTypeId: string; heightFt: { toNumber(): number } | null } | null;
        calibration: { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: { toNumber(): number } };
      }[];
    }[];
  };
  sheetLabelByPage: Record<number, string>;
  /** The index's caution per page that is not a floor plan (`sheetSuitability`). */
  duplicateWallsByPage: Record<number, string>;
  allWallTypes: {
    id: string;
    code: string;
    defaultHeightFt: { toNumber(): number } | null;
    sides: number;
    studSpacingIn: { toNumber(): number };
  }[];
  items: { id: string; name: string }[];
  /** Newest first. */
  schedules: { pageNumber: number; kind: string; status: string; rows: SummaryDoorSheet["rows"] }[];
}): SummaryInput {
  const seenDoorPage = new Set<number>();
  const doors: SummaryDoorSheet[] = [];
  for (const schedule of data.schedules) {
    if (schedule.kind !== "DOOR" || schedule.status === "REJECTED" || seenDoorPage.has(schedule.pageNumber)) continue;
    seenDoorPage.add(schedule.pageNumber);
    doors.push({ pageNumber: schedule.pageNumber, rows: schedule.rows });
  }
  return {
    sheets: data.plan.pages.map((page) => ({
      pageNumber: page.pageNumber,
      label: data.sheetLabelByPage[page.pageNumber] ?? null,
      notFloorPlan: data.duplicateWallsByPage[page.pageNumber] ?? null,
      measurements: page.measurements.map((m) => ({
        kind: m.kind,
        xs: m.xs,
        ys: m.ys,
        cutouts: cutoutsFromJson(m.cutouts),
        label: m.label,
        itemId: m.itemId,
        source: m.source,
        roomName: m.roomName,
        roomNumber: m.roomNumber,
        ceiling:
          m.ceilingFamily === null && m.ceilingCode === null
            ? null
            : { family: m.ceilingFamily, code: m.ceilingCode, heightFeet: m.ceilingHeightFeet, guess: m.ceilingGuess },
        wallRun:
          m.wallRun === null
            ? null
            : { wallTypeId: m.wallRun.wallTypeId, heightFt: m.wallRun.heightFt === null ? null : m.wallRun.heightFt.toNumber() },
        feetPerUnit: feetPerPageWidth({ ...m.calibration, declaredDistanceFeet: m.calibration.declaredDistanceFeet.toNumber() }),
      })),
    })),
    wallTypes: data.allWallTypes.map((type) => ({
      id: type.id,
      code: type.code,
      defaultHeightFt: type.defaultHeightFt === null ? null : type.defaultHeightFt.toNumber(),
      sides: type.sides,
      studSpacingIn: type.studSpacingIn.toNumber(),
    })),
    items: data.items.map((item) => ({ id: item.id, name: item.name })),
    doors: doors.sort((a, b) => a.pageNumber - b.pageNumber),
  };
}

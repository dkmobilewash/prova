import { toCsv } from "@/lib/export";
import { ringPerimeter } from "@/lib/sheet-geometry";
import { studsRequired, trackRequired } from "@/lib/takeoff";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { cutoutsFromJson, netArea } from "./itemQuantities";
import { verdictFor, type WallGroup } from "./wallGroups";

/**
 * ── THE TAKEOFF SUMMARY: what was measured, by sheet, with no prices ──
 *
 * One pure function from the takeoff's existing rows to the lines an estimator
 * sends or keeps: walls by type (feet, height, board, studs, track), rooms
 * (square feet, perimeter), other areas by item (ceilings, floors — the item
 * IS the type; nothing on a measurement says "ceiling"), and doors from the
 * schedule the model read. Every line names the sheet(s) it came from, and
 * `sheets` carries what to draw over each sheet so the PDF can show it.
 *
 * NOTHING NEW IS MEASURED HERE. Walls are the stored groups the viewer shows
 * (`storedWallsByPage`), named by the same `verdictFor` the viewer prices by;
 * rooms and areas are `TakeoffMeasurement` rows at their own calibration, the
 * way `itemQuantity` reads them; doors are the newest DOOR schedule read per
 * sheet. A quantity here is the quantity on screen.
 *
 * Board square feet is feet × height × sides with NO opening deduction: a
 * stored run carries opening widths but no heights, so a deduction would be
 * a guess. Height is the wall type's default; a group with no type, or a type
 * with no default height, has no board figure and says so with a blank.
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
  /** Feet per page-width unit at the measurement's OWN calibration; null when unreadable. */
  feetPerUnit: number | null;
};

export type SummarySheet = {
  pageNumber: number;
  /** `sheetLabelByPage` — "A101 — FIRST FLOOR PLAN" — or null when the set has no index. */
  label: string | null;
  walls: WallGroup[];
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
  /** The newest DOOR schedule read per sheet. */
  doors: SummaryDoorSheet[];
};

export type WallLine = {
  name: string;
  typeCode: string | null;
  linearFt: number;
  heightFt: number | null;
  boardSqFt: number | null;
  studs: number;
  trackFt: number;
  sheets: string[];
};
export type RoomLine = { name: string; number: string | null; squareFeet: number; perimeterFt: number; sheet: string };
export type AreaLine = { item: string; measurements: number; squareFeet: number; perimeterFt: number; sheets: string[] };
export type DoorLine = {
  mark: string;
  description: string | null;
  size: string | null;
  quantity: number;
  notes: string | null;
  sheet: string;
};
export type SheetMarkup = {
  pageNumber: number;
  label: string;
  runs: { x1: number; y1: number; x2: number; y2: number; name: string }[];
  polygons: { xs: number[]; ys: number[]; name: string; kind: "room" | "area" }[];
};

export type TakeoffSummary = {
  walls: WallLine[];
  rooms: RoomLine[];
  areas: AreaLine[];
  doors: DoorLine[];
  sheets: SheetMarkup[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;
export const sheetName = (sheet: { pageNumber: number; label: string | null }) => sheet.label ?? `Sheet ${sheet.pageNumber}`;

function inches(n: number): string {
  return `${Math.round(n * 8) / 8} in.`;
}

/** What a group is called on the summary — the viewer's verdict, in words. */
export function wallLineName(group: WallGroup): { name: string; typeId: string | null } {
  const verdict = verdictFor(group);
  switch (verdict.state) {
    case "NAMED":
    case "BY_GENERAL_NOTE":
    case "ONLY_ONE_THAT_THICK":
      return { name: verdict.type.code, typeId: verdict.type.id };
    case "TAG_DISAGREES":
      return { name: `${verdict.type.code} (drawn ${inches(group.inches)})`, typeId: verdict.type.id };
    case "ASK":
      return { name: `${inches(group.inches)} wall (${verdict.types.map((t) => t.code).join(" or ")}?)`, typeId: null };
    case "NO_SUCH_TYPE":
      return { name: `${verdict.tag} (not in your library, ${inches(group.inches)})`, typeId: null };
    case "UNKNOWN":
      return { name: `${inches(group.inches)} wall`, typeId: null };
  }
}

const isRoom = (m: SummaryMeasurement) =>
  m.kind === "AREA" && (m.source === "ROOM_FINDER" || m.roomName !== null || m.roomNumber !== null);

export function takeoffSummary(input: SummaryInput): TakeoffSummary {
  const typeById = new Map(input.wallTypes.map((type) => [type.id, type]));
  const itemById = new Map(input.items.map((item) => [item.id, item.name]));
  const walls = new Map<string, WallLine & { sheetSet: Set<string>; sides: number }>();
  const areas = new Map<string, AreaLine & { sheetSet: Set<string> }>();
  const rooms: RoomLine[] = [];
  const sheets: SheetMarkup[] = [];

  for (const sheet of input.sheets) {
    const label = sheetName(sheet);
    const markup: SheetMarkup = { pageNumber: sheet.pageNumber, label, runs: [], polygons: [] };
    for (const group of sheet.walls) {
      const { name, typeId } = wallLineName(group);
      const type = typeId === null ? null : (typeById.get(typeId) ?? null);
      const line =
        walls.get(name) ??
        walls
          .set(name, {
            name,
            typeCode: type?.code ?? null,
            linearFt: 0,
            heightFt: type?.defaultHeightFt ?? null,
            boardSqFt: null,
            studs: 0,
            trackFt: 0,
            sheets: [],
            sheetSet: new Set(),
            sides: type?.sides === 1 ? 1 : 2,
          })
          .get(name)!;
      const spacingFt = type && type.studSpacingIn > 0 ? type.studSpacingIn / 12 : undefined;
      line.linearFt += group.feet;
      line.trackFt += trackRequired(group.feet);
      for (const run of group.runs) {
        line.studs += studsRequired(run.lengthFeet, { spacingFt });
        markup.runs.push({ x1: run.x1, y1: run.y1, x2: run.x2, y2: run.y2, name });
      }
      line.sheetSet.add(label);
    }
    for (const m of sheet.measurements) {
      if (m.kind !== "AREA" || m.feetPerUnit === null) continue;
      const squareFeet = round1(netArea(m.xs, m.ys, m.cutouts) * m.feetPerUnit * m.feetPerUnit);
      const perimeterFt = round1((ringPerimeter(m.xs, m.ys) ?? 0) * m.feetPerUnit);
      if (isRoom(m)) {
        const name = m.roomName ?? m.label ?? "Unnamed room";
        rooms.push({ name, number: m.roomNumber, squareFeet, perimeterFt, sheet: label });
        markup.polygons.push({ xs: m.xs, ys: m.ys, name: [m.roomNumber, name].filter(Boolean).join(" "), kind: "room" });
        continue;
      }
      const item = (m.itemId === null ? null : itemById.get(m.itemId)) ?? "Unassigned";
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

  const finish = <T extends { sheetSet: Set<string>; sheets: string[] }>({ sheetSet, ...line }: T) => ({
    ...line,
    sheets: [...sheetSet],
  });
  return {
    walls: [...walls.values()].map(({ sides, ...line }) => ({
      ...finish(line),
      linearFt: round1(line.linearFt),
      trackFt: round1(line.trackFt),
      boardSqFt: line.heightFt === null ? null : round1(line.linearFt * line.heightFt * sides),
    })),
    rooms,
    areas: [...areas.values()].map(finish).map((line) => ({
      ...line,
      squareFeet: round1(line.squareFeet),
      perimeterFt: round1(line.perimeterFt),
    })),
    doors,
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
  for (const w of summary.walls) {
    rows.push({
      section: "Walls",
      name: w.name,
      quantity: w.linearFt,
      unit: "ft",
      linear_ft: w.linearFt,
      height_ft: w.heightFt ?? "",
      board_sqft: w.boardSqFt ?? "",
      studs: w.studs,
      track_ft: w.trackFt,
      sheets: w.sheets.join("; "),
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
  return toCsv([...SUMMARY_CSV_COLUMNS], rows.map((row) => Object.fromEntries(SUMMARY_CSV_COLUMNS.map((c) => [c, row[c] ?? ""]))));
}

/**
 * The adapter from what the takeoff page already loads (`loadTakeoffWorkspace`
 * plus `loadScheduleProposals`) to the pure input above. Typed structurally so
 * a test can hand it rows without a database.
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
        calibration: { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: { toNumber(): number } };
      }[];
    }[];
  };
  storedWallsByPage: Record<number, WallGroup[]>;
  sheetLabelByPage: Record<number, string>;
  allWallTypes: {
    id: string;
    code: string;
    defaultHeightFt: { toNumber(): number } | null;
    sides: number;
    studSpacingIn: { toNumber(): number };
  }[];
  items: { id: string; name: string }[];
  schedules: { pageNumber: number; kind: string; rows: SummaryDoorSheet["rows"] }[];
}): SummaryInput {
  const seenDoorPage = new Set<number>();
  const doors: SummaryDoorSheet[] = [];
  // Newest first already (`loadScheduleProposals` orders by createdAt desc).
  for (const schedule of data.schedules) {
    if (schedule.kind !== "DOOR" || seenDoorPage.has(schedule.pageNumber)) continue;
    seenDoorPage.add(schedule.pageNumber);
    doors.push({ pageNumber: schedule.pageNumber, rows: schedule.rows });
  }
  return {
    sheets: data.plan.pages.map((page) => ({
      pageNumber: page.pageNumber,
      label: data.sheetLabelByPage[page.pageNumber] ?? null,
      walls: data.storedWallsByPage[page.pageNumber] ?? [],
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

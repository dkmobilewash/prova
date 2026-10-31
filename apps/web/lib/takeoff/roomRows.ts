import type { Prisma } from "@prova/db";
import { ringSelfIntersects } from "@/lib/sheet-geometry";
import { verticesProblem } from "@/lib/takeoff-plan";
import { nextItemColor } from "@/lib/takeoff/itemColors";
import { CEILING_ITEM, ROOMS_ITEM } from "@/lib/takeoff/roomItems";

/**
 * ── ROOMS, AS MEASUREMENT ROWS ──
 *
 * The one way a found room becomes rows on a job: an AREA measurement on the
 * "Rooms" item carrying the tag, and — when the drawings said what the ceiling
 * is — a second AREA measurement on that ceiling family's item carrying the
 * ceiling columns, so the job summary counts each once and the ceiling recipe
 * can price it. Written here so the rooms panel's Save and the whole-set run
 * write the SAME rows; `lib/actions/roomFinder.ts` keeps the auth, the switch
 * and the form parsing around it.
 */
export type RoomToSave = {
  xs: number[];
  ys: number[];
  label: string;
  roomName: string | null;
  roomNumber: string | null;
  ceiling?: { family: string | null; code: string | null; heightFeet: number | null; from: string | null; guess: boolean } | null;
};

const CEILING_FAMILIES = new Set(["ACT", "GYP", "OPEN", "OTHER"]);
const CEILING_SOURCES = new Set(["tag", "schedule", "pattern", "note", "prefix", "estimator"]);

export type CeilingColumns = { ceilingFamily: string | null; ceilingCode: string | null; ceilingHeightFeet: number | null; ceilingFrom: string | null; ceilingGuess: boolean };

export function ceilingColumns(c: RoomToSave["ceiling"], i: number, label: string): { ok: true; cols: CeilingColumns } | { ok: false; error: string } {
  if (!c) return { ok: true, cols: { ceilingFamily: null, ceilingCode: null, ceilingHeightFeet: null, ceilingFrom: null, ceilingGuess: false } };
  const where = `Room ${i + 1}${label ? ` (${label})` : ""}`;
  const family = c.family === null || c.family === undefined || c.family === "" ? null : String(c.family).toUpperCase();
  if (family !== null && !CEILING_FAMILIES.has(family)) return { ok: false, error: `${where}: "${c.family}" is not a ceiling type this app knows.` };
  const height = c.heightFeet === null || c.heightFeet === undefined ? null : Number(c.heightFeet);
  if (height !== null && !(height > 0 && height < 100)) return { ok: false, error: `${where}: a ceiling height of ${c.heightFeet} ft is not one.` };
  const from = c.from === null || c.from === undefined || c.from === "" ? null : String(c.from);
  if (from !== null && !CEILING_SOURCES.has(from)) return { ok: false, error: `${where}: unknown ceiling source "${from}".` };
  return { ok: true, cols: { ceilingFamily: family, ceilingCode: c.code ? String(c.code).slice(0, 40) : null, ceilingHeightFeet: height, ceilingFrom: from, ceilingGuess: Boolean(c.guess) } };
}

export type RoomRow = Prisma.TakeoffMeasurementCreateManyInput & { ceilingItem: string | null };

/** The rows for a page's rooms, or the first sentence that refuses one. */
export function roomRows(input: { rooms: RoomToSave[]; pageId: string; calibrationId: string; userId: string | null }): { ok: true; rows: RoomRow[] } | { ok: false; error: string } {
  const rows: RoomRow[] = [];
  for (const [i, room] of input.rooms.entries()) {
    const xs = Array.isArray(room.xs) ? room.xs.map(Number) : [];
    const ys = Array.isArray(room.ys) ? room.ys.map(Number) : [];
    const problem = verticesProblem("AREA", xs, ys);
    if (problem) return { ok: false, error: `Room ${i + 1}${room.label ? ` (${room.label})` : ""}: ${problem}` };
    if (ringSelfIntersects(xs, ys)) return { ok: false, error: `Room ${i + 1}${room.label ? ` (${room.label})` : ""}: its outline crosses itself.` };
    const label = String(room.label ?? "").trim().slice(0, 120);
    const ceiling = ceilingColumns(room.ceiling, i, label);
    if (!ceiling.ok) return ceiling;
    rows.push({
      pageId: input.pageId,
      calibrationId: input.calibrationId,
      kind: "AREA" as const,
      xs,
      ys,
      label: label || null,
      roomName: room.roomName ? String(room.roomName).slice(0, 120) : null,
      roomNumber: room.roomNumber ? String(room.roomNumber).slice(0, 32) : null,
      ...ceiling.cols,
      source: "ROOM_FINDER" as const,
      createdByUserId: input.userId,
      ceilingItem: ceiling.cols.ceilingFamily !== null && CEILING_ITEM[ceiling.cols.ceilingFamily] ? ceiling.cols.ceilingFamily : null,
    });
  }
  return { ok: true, rows };
}

async function itemNamed(tx: Prisma.TransactionClient, companyId: string, jobId: string, name: string, starterCode: string | null): Promise<string> {
  const found = await tx.takeoffItem.findFirst({ where: { jobId, companyId, name }, select: { id: true } });
  if (found) return found.id;
  const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
  const starter = starterCode === null ? null : await tx.wallType.findFirst({ where: { companyId, code: starterCode }, select: { id: true } });
  const item = await tx.takeoffItem.create({
    data: { companyId, jobId, name, type: "AREA_WITH_PERIMETER", colorHex: nextItemColor(existing.map((i) => i.colorHex)), sortOrder: (existing[0]?.sortOrder ?? -1) + 1, wallTypeId: starter?.id ?? null },
    select: { id: true },
  });
  return item.id;
}

/** Writes the rows: the room on "Rooms", and its ceiling on the ceiling family's item. Returns how many measurements were written. */
export async function writeRoomRows(tx: Prisma.TransactionClient, companyId: string, jobId: string, rows: readonly RoomRow[]): Promise<number> {
  const roomsItem = await itemNamed(tx, companyId, jobId, ROOMS_ITEM, null);
  const ceilingItems = new Map<string, string>();
  for (const family of new Set(rows.map((r) => r.ceilingItem).filter((f): f is string => f !== null))) {
    ceilingItems.set(family, await itemNamed(tx, companyId, jobId, CEILING_ITEM[family].name, CEILING_ITEM[family].starter));
  }
  const data: Prisma.TakeoffMeasurementCreateManyInput[] = [];
  for (const { ceilingItem, ...row } of rows) {
    // The ROOM row carries the tag and goes to "Rooms"; the ceiling columns
    // ride on the CEILING row only, so the job summary counts each once.
    data.push({ ...row, itemId: roomsItem, ceilingFamily: null, ceilingCode: null, ceilingHeightFeet: null, ceilingFrom: null, ceilingGuess: false });
    if (ceilingItem !== null) data.push({ ...row, itemId: ceilingItems.get(ceilingItem) ?? null, label: `${row.label ?? "Room"} ceiling` });
  }
  await tx.takeoffMeasurement.createMany({ data });
  return data.length;
}

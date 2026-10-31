import { prisma } from "@prova/db";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { ceilingsForRooms, type CeilingPageText } from "@/lib/takeoff/roomCeilings";
import { roomBoundary } from "@/lib/takeoff/roomBoundary";
import { roomsFromWalls } from "@/lib/takeoff/roomsFromWalls";
import { roomRows, writeRoomRows, type RoomToSave } from "@/lib/takeoff/roomRows";
import { openPlanPdf, type PlanPdf } from "./planPdf";
import { readPlanBytes } from "./planBytes";
import { tableRowsFromPage } from "./scheduleTable";

/**
 * ── ROOMS AND CEILINGS FOR A SHEET THE WHOLE-SET RUN COUNTED ──
 *
 * The viewer's Find rooms does this on a click: the walls just found, the
 * page's words for the tags, the set's ceiling pages for the ceiling, and
 * Save writes each room as an AREA measurement with its ceiling. The
 * whole-set run now does the same for every floor plan it counts, so the
 * rooms and their ceiling areas are on the job — on the "Rooms" item and the
 * ceiling family's item, `source: ROOM_FINDER` — before anybody opens a
 * sheet, and `postTakeoffMeasurements` with the ceiling recipe can price them.
 *
 * Gated on `Company.roomFinderOn`, like the button. Never twice: a page that
 * already carries ROOM_FINDER measurements is left alone, so a re-run adds
 * nothing and a person's edits survive. Pure geometry; no model is called.
 */

/** The pages whose words a ceiling can be read from: the set's RCPs and finish schedules. */
export const CEILING_PAGE_TITLE = /REFLECTED\s+CEILING|\bRCP\b|CEILING\s+PLAN|FINISH\s+SCHEDULE|ROOM\s+FINISH/i;

export async function ceilingPagesOf(planId: string): Promise<number[]> {
  const rows = await prisma.planSheetText.findMany({ where: { planId }, select: { pageNumber: true, titleBlockText: true } });
  return rows.filter((r) => r.titleBlockText !== null && CEILING_PAGE_TITLE.test(r.titleBlockText)).map((r) => r.pageNumber).sort((a, b) => a - b);
}

async function ceilingPageText(doc: PlanPdf, pageNumber: number): Promise<CeilingPageText | null> {
  try {
    const page = await doc.pageText(pageNumber);
    // The strokes too: a ceiling plan's families are often its hatch alone.
    let strokes: CeilingPageText["strokes"];
    try {
      const read = await doc.pageStrokes(pageNumber);
      const W = read.widthPt;
      strokes = read.segments.map((s) => ({ x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W }));
    } catch {
      strokes = undefined;
    }
    return { pageNumber, items: page.items, widthPt: page.widthPt, tableRows: tableRowsFromPage(page), strokes };
  } catch {
    return null;
  }
}

export type RoomsOutcome = { kind: "written"; rooms: number; ceilingSqFt: number } | { kind: "skipped"; why: string } | { kind: "failed"; error: string };

export async function roomsForSheet(input: { planId: string; companyId: string; jobId: string; pageNumber: number; userId: string | null }): Promise<RoomsOutcome> {
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { roomFinderOn: true } });
  if (!company?.roomFinderOn) return { kind: "skipped", why: "room finding is off" };
  const page = await prisma.takeoffPlanPage.findUnique({
    where: { planId_pageNumber: { planId: input.planId, pageNumber: input.pageNumber } },
    select: {
      id: true,
      calibrations: { orderBy: { createdAt: "desc" }, take: 1 },
      wallProposals: { orderBy: { createdAt: "desc" }, select: { calibrationId: true, runs: true, createdAt: true } },
      measurements: { where: { source: "ROOM_FINDER" }, select: { id: true }, take: 1 },
    },
  });
  const calibration = page?.calibrations[0];
  if (!page || !calibration) return { kind: "skipped", why: "no scale" };
  if (page.measurements.length > 0) return { kind: "skipped", why: "rooms already on the sheet" };
  const feetPerUnit = feetPerPageWidth({ x1: calibration.x1, y1: calibration.y1, x2: calibration.x2, y2: calibration.y2, declaredDistanceFeet: Number(calibration.declaredDistanceFeet) });
  if (feetPerUnit === null) return { kind: "skipped", why: "no scale" };
  const mine = page.wallProposals.filter((p) => p.calibrationId === calibration.id);
  if (mine.length === 0) return { kind: "skipped", why: "no walls found" };
  const newest = mine[0]!.createdAt.getTime();
  const runs = mine.filter((p) => p.createdAt.getTime() === newest).flatMap((p) => p.runs as { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number }[]);
  const read = await readPlanBytes(input.planId, input.companyId);
  if (!read.ok) return { kind: "failed", error: read.error };
  const doc = await openPlanPdf(read.bytes);
  try {
    const text = await doc.pageText(input.pageNumber);
    const walls = roomBoundary({ pairings: [], runs, drawn: [] });
    const found = roomsFromWalls({ walls, feetPerUnit, text: text.items, widthPt: text.widthPt });
    if (found.rooms.length === 0) return { kind: "skipped", why: "no rooms closed" };
    const current: CeilingPageText = { pageNumber: input.pageNumber, items: text.items, widthPt: text.widthPt, tableRows: tableRowsFromPage(text) };
    const others: CeilingPageText[] = [];
    for (const n of (await ceilingPagesOf(input.planId)).filter((n) => n !== input.pageNumber).slice(0, 40)) {
      const one = await ceilingPageText(doc, n);
      if (one) others.push(one);
    }
    const ceilings = ceilingsForRooms({ rooms: found.rooms, current, feetPerUnit, others });
    const rooms: RoomToSave[] = found.rooms.map((room) => {
      const c = ceilings.get(room.id) ?? null;
      const label = [room.tag?.name, room.tag?.number].filter(Boolean).join(" ").trim();
      return {
        xs: room.xs,
        ys: room.ys,
        label: label || `Room ${room.id + 1}`,
        roomName: room.tag?.name ?? null,
        roomNumber: room.tag?.number ?? null,
        ceiling: c && (c.family !== null || c.heightFeet !== null) ? { family: c.family, code: c.code, heightFeet: c.heightFeet, from: c.from, guess: c.guess } : null,
      };
    });
    const built = roomRows({ rooms, pageId: page.id, calibrationId: calibration.id, userId: input.userId });
    if (!built.ok) return { kind: "failed", error: built.error };
    await prisma.$transaction(async (tx) => {
      await writeRoomRows(tx, input.companyId, input.jobId, built.rows);
    });
    const ceilingSqFt = found.rooms.reduce((n, room) => n + ((ceilings.get(room.id)?.family ?? null) !== null ? room.squareFeet : 0), 0);
    return { kind: "written", rooms: found.rooms.length, ceilingSqFt: Math.round(ceilingSqFt) };
  } finally {
    await doc.close().catch(() => {});
  }
}

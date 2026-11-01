import { splitLinesFrom } from "@/lib/takeoff/userExclusions";
import { prisma } from "@prova/db";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { ceilingsForRooms, type CeilingPageText } from "@/lib/takeoff/roomCeilings";
import type { DetectedBoundary } from "@/lib/takeoff/detectWallsForCalibration";
import { doorsAndWindowsForSheet } from "@/lib/takeoff/doorsWindows";
import { DOOR_HEIGHT_FEET, finishLineLabel, finishTakeoff, typesFromNeighbours, typeTagsInRooms, WINDOW_HEIGHT_FEET } from "@/lib/takeoff/finishTakeoff";
import { readFinishSchedule, type FinishSchedule } from "@/lib/takeoff/finishSchedule";
import { sheetRooms } from "@/lib/takeoff/sheetRooms";
import type { WallCandidate } from "@/lib/takeoff/wallVectors";
import { roomRows, writeRoomRows, type RoomToSave } from "@/lib/takeoff/roomRows";
import { openPlanPdf, type PlanPdf } from "./planPdf";
import { readPlanBytes } from "./planBytes";
import { sheetNumberFrom } from "./sheetNumber";
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

/**
 * Doors and windows onto the wall they sit in, for Send to estimate.
 * ponytail: heights are the finish panel's stated defaults, because a plan has
 * none. A door schedule's height would be better when one has been read.
 */
async function writeWallOpenings(pageId: string, runs: readonly { x1: number; y1: number; x2: number; y2: number }[], doors: readonly { wall: number | null; widthFeet: number }[], windows: readonly { wall: number; widthFeet: number }[]) {
  const byRun = new Map<number, { widthFt: number; heightFt: number }[]>();
  const add = (at: number | null, widthFt: number, heightFt: number) => {
    if (at === null || at < 0) return;
    byRun.set(at, [...(byRun.get(at) ?? []), { widthFt, heightFt }]);
  };
  for (const d of doors) add(d.wall, d.widthFeet, DOOR_HEIGHT_FEET);
  for (const w of windows) add(w.wall, w.widthFeet, WINDOW_HEIGHT_FEET);
  if (byRun.size === 0) return;
  const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId, source: "DETECTED", kind: "LINEAR" }, select: { id: true, xs: true, ys: true } });
  const at = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
  const idOf = new Map(rows.map((r) => [at((r.xs as number[])[0]!, (r.ys as number[])[0]!) + at((r.xs as number[])[1]!, (r.ys as number[])[1]!), r.id]));
  for (const [index, openings] of byRun) {
    const run = runs[index]!;
    const id = idOf.get(at(run.x1, run.y1) + at(run.x2, run.y2));
    if (id) await prisma.takeoffMeasurement.update({ where: { id }, data: { openings } });
  }
}

/** The fullest finish schedule in the set. Read once per run: every counted sheet asks. */
const schedules = new Map<string, FinishSchedule | null>();
async function setFinishSchedule(doc: PlanPdf, planId: string, pageCount: number): Promise<FinishSchedule | null> {
  if (schedules.has(planId)) return schedules.get(planId)!;
  let best: FinishSchedule | null = null;
  for (let n = 1; n <= pageCount; n += 1) {
    const read = readFinishSchedule((await doc.pageText(n)).items as never);
    if (read !== null && (best === null || read.rows.length > best.rows.length)) best = read;
  }
  schedules.set(planId, best);
  return best;
}

export type RoomsOutcome = { kind: "written"; rooms: number; ceilingSqFt: number } | { kind: "skipped"; why: string } | { kind: "failed"; error: string };

export async function roomsForSheet(input: { planId: string; companyId: string; jobId: string; pageNumber: number; userId: string | null; boundary?: DetectedBoundary }): Promise<RoomsOutcome> {
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { roomFinderOn: true, doorsWindowsOn: true } });
  if (!company?.roomFinderOn) return { kind: "skipped", why: "room finding is off" };
  const page = await prisma.takeoffPlanPage.findUnique({
    where: { planId_pageNumber: { planId: input.planId, pageNumber: input.pageNumber } },
    select: {
      id: true,
      calibrations: { orderBy: { createdAt: "desc" }, take: 1 },
      wallProposals: { orderBy: { createdAt: "desc" }, select: { calibrationId: true, runs: true, createdAt: true } },
      measurements: { where: { source: "ROOM_FINDER" }, select: { id: true }, take: 1 },
      exclusions: { where: { kind: "ROOM_SPLIT" }, select: { kind: true, xs: true, ys: true } },
      plan: { select: { _count: { select: { sheetTexts: true } } } },
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
    // What this step's own detection read, so a whole-set room is the viewer's.
    // A retry has only the stored runs, and the page's strokes for its doors.
    const strokes = input.boundary ? null : await doc.pageStrokes(input.pageNumber);
    const W = text.widthPt;
    const inUnits = input.boundary?.segments ?? strokes!.segments.map((s) => ({ ...s, x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W }));
    const candidates = runs.map((r) => ({ ...r, lengthFeet: Math.hypot(r.x2 - r.x1, r.y2 - r.y1) * feetPerUnit })) as unknown as WallCandidate[];
    const inPoints = inUnits.map((s) => ({ ...s, x1: s.x1 * W, y1: s.y1 * W, x2: s.x2 * W, y2: s.y2 * W }));
    const openings = company.doorsWindowsOn
      ? doorsAndWindowsForSheet({ segments: inUnits as never, segmentsPt: inPoints as never, textPt: text.items as never, widthPt: W, walls: candidates, feetPerUnit, scheduleRows: [] })
      : { doors: [], windows: [] };
    await writeWallOpenings(page.id, runs, openings.doors, openings.windows);
    const found = sheetRooms({
      pairings: input.boundary?.pairings ?? [],
      runs,
      drawn: [],
      segments: inUnits,
      splits: splitLinesFrom(page.exclusions),
      doorLeaves: openings.doors.map((d) => ({ x1: d.hinge.x, y1: d.hinge.y, x2: d.strike.x, y2: d.strike.y })),
      feetPerUnit,
      text: text.items,
      widthPt: W,
    });
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
      const shared = room.sharedTags?.map((t) => [t.name, t.number].filter(Boolean).join(" ")).join(" + ");
      const label = shared ?? [room.tag?.name, room.tag?.number].filter(Boolean).join(" ").trim();
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
    // ── THE FINISH TAKEOFF, THE VIEWER'S SAME STEPS ──
    const schedule = await setFinishSchedule(doc, input.planId, page.plan._count.sheetTexts);
    if (schedule !== null) {
      const tagged = schedule.byType ? typeTagsInRooms(found.rooms, text.items as never, W, new Set(schedule.rows.map((r) => r.key))) : undefined;
      const typeOfRoom = tagged ? new Map([...tagged, ...typesFromNeighbours(found.rooms, tagged, feetPerUnit)]) : undefined;
      const result = finishTakeoff({ rooms: found.rooms, schedule, typeOfRoom, doors: openings.doors, windows: openings.windows, feetPerUnit, heightOf: (room) => ceilings.get(room.id)?.heightFeet ?? null });
      const sheet = sheetNumberFrom(text).sheetNumber ?? `Sheet ${input.pageNumber}`;
      await prisma.takeoffPlanPage.update({
        where: { id: page.id },
        data: {
          finishTakeoff: {
            lines: result.lines.map((l) => ({ description: `${sheet} — ${finishLineLabel(l)}`, quantity: l.quantity, unit: l.unit })),
            // By number, or by label for a merged region, which has no one number.
            ceilingRooms: result.joined.filter((j) => j.row.ceiling !== null).map((j) => j.room.tag?.number ?? rooms[found.rooms.indexOf(j.room)]!.label),
          },
        },
      });
    }
    const ceilingSqFt = found.rooms.reduce((n, room) => n + ((ceilings.get(room.id)?.family ?? null) !== null ? room.squareFeet : 0), 0);
    return { kind: "written", rooms: found.rooms.length, ceilingSqFt: Math.round(ceilingSqFt) };
  } finally {
    await doc.close().catch(() => {});
  }
}

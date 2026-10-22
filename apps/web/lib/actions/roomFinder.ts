"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ringSelfIntersects } from "@/lib/sheet-geometry";
import { verticesProblem } from "@/lib/takeoff-plan";
import { nextItemColor } from "@/lib/takeoff/itemColors";
import { CEILING_ITEM, ROOMS_ITEM } from "@/lib/takeoff/roomItems";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * ── "FIND THE ROOMS": THE SWITCH AND THE SAVE ──
 *
 * Two actions, both returning `ActionResult` (production redacts a thrown
 * message, CLAUDE.md's Errors rule), both scoped to the caller's company.
 *
 * The switch is OFF for every company until the owner turns it on — the same
 * posture as the plan-text opt-in, kept on `Company.roomFinderOn` rather than
 * in `CompanyAiSettings` because no model runs: rooms are flood-filled from
 * the walls the finder already found, in the browser, in code.
 *
 * The save lands every room of a sheet in ONE transaction, exactly as
 * `saveTakeoffMeasurements` does for found walls and for its reason: a
 * hundred round trips and a half-saved sheet are both worse than all or
 * nothing. Every guard the single save applies, applies: the page must be the
 * company's, calibrated, and each polygon goes through `verticesProblem` —
 * a room is a proposal from a flood fill, not a trusted input.
 */

/** The app's refusal wording — `action-capability-guards.test.ts` recognises a
 *  refusal by its sentence, so these match `takeoff.ts` and `company.ts`. */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function saveRoomFinderSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // The same capability the settings page asserts: an action is its own
  // endpoint and answers whoever posts to it (`action-capability-guards.test.ts`).
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn room finding on or off — it changes what every estimator sees on the takeoff.",
  );
  if (refusal) return refusal;
  const on = formData.get("roomFinderOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { roomFinderOn: on } });
  revalidatePath("/settings");
  return actionOk;
}

export type RoomToSave = {
  xs: number[];
  ys: number[];
  /** What the estimator sees as the measurement's label — the tag, or their rename. */
  label: string;
  roomName: string | null;
  roomNumber: string | null;
  /** The ceiling the estimator accepted or typed; null leaves the columns empty. */
  ceiling?: { family: string | null; code: string | null; heightFeet: number | null; from: string | null; guess: boolean } | null;
};
const CEILING_FAMILIES = new Set(["ACT", "GYP", "OPEN", "OTHER"]);
const CEILING_SOURCES = new Set(["tag", "schedule", "pattern", "note", "prefix", "estimator"]);

/** The five ceiling columns from what the panel sent; a malformed one is a readable refusal, not a guess. */
function ceilingColumns(
  c: RoomToSave["ceiling"],
  i: number,
  label: string,
): { ok: true; cols: { ceilingFamily: string | null; ceilingCode: string | null; ceilingHeightFeet: number | null; ceilingFrom: string | null; ceilingGuess: boolean } } | { ok: false; error: string } {
  if (!c) return { ok: true, cols: { ceilingFamily: null, ceilingCode: null, ceilingHeightFeet: null, ceilingFrom: null, ceilingGuess: false } };
  const where = `Room ${i + 1}${label ? ` (${label})` : ""}`;
  const family = c.family === null || c.family === undefined || c.family === "" ? null : String(c.family).toUpperCase();
  if (family !== null && !CEILING_FAMILIES.has(family)) return { ok: false, error: `${where}: "${c.family}" is not a ceiling type this app knows.` };
  const height = c.heightFeet === null || c.heightFeet === undefined ? null : Number(c.heightFeet);
  if (height !== null && !(height > 0 && height < 100)) return { ok: false, error: `${where}: a ceiling height of ${c.heightFeet} ft is not one.` };
  const from = c.from === null || c.from === undefined || c.from === "" ? null : String(c.from);
  if (from !== null && !CEILING_SOURCES.has(from)) return { ok: false, error: `${where}: unknown ceiling source "${from}".` };
  return { ok: true, cols: { ceilingFamily: family, ceilingCode: c.code ? String(c.code).slice(0, 40) : null, ceilingHeightFeet: height, ceilingFrom: from, ceilingGuess: c.guess === true } };
}

/**
 * ── THE ITEMS A SAVED ROOM LANDS IN, so its square feet reach the estimate ──
 *
 * A measurement reaches an estimate line only through a TAKEOFF ITEM with an
 * assembly on it (`syncTakeoffItemLines`). Rooms used to save with no item
 * and sat in "Unassigned" — 1,675 sf of floor and 872 sf of acoustic ceiling
 * on the panel and nowhere else (the audit of 2026-10-22). So every room row
 * goes into a "Rooms" item, and a room whose ceiling is known gets a SECOND
 * row, the same outline, in "Ceiling — ACT" / "Ceiling — GYP" / …, each an
 * AREA_WITH_PERIMETER item: the area prices tile and board, the perimeter
 * prices wall angle and base. Two rows because one row belongs to one item,
 * and a floor and a ceiling are two things an estimator prices.
 *
 * Found or created by NAME within the job, so a second sheet's rooms join
 * the same items rather than making "Rooms (2)". The assembly is left for
 * the estimator to pick — the library is theirs — except that a ceiling item
 * takes a starter it can recognise when the company has one (ACT2 / GYPC1),
 * so the common case prices itself and the uncommon one says it is unpriced.
 */

async function itemNamed(
  tx: Prisma.TransactionClient,
  companyId: string,
  jobId: string,
  name: string,
  starterCode: string | null,
): Promise<string> {
  const found = await tx.takeoffItem.findFirst({ where: { jobId, companyId, name }, select: { id: true } });
  if (found) return found.id;
  const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
  const starter = starterCode === null ? null : await tx.wallType.findFirst({ where: { companyId, code: starterCode }, select: { id: true } });
  const item = await tx.takeoffItem.create({
    data: {
      companyId,
      jobId,
      name,
      type: "AREA_WITH_PERIMETER",
      colorHex: nextItemColor(existing.map((i) => i.colorHex)),
      sortOrder: (existing[0]?.sortOrder ?? -1) + 1,
      wallTypeId: starter?.id ?? null,
    },
    select: { id: true },
  });
  return item.id;
}

export async function saveRoomMeasurements(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;
  const on = await prisma.company.findUnique({ where: { id: company.id }, select: { roomFinderOn: true } });
  if (!on?.roomFinderOn) return actionFail("Room finding is off for your company. The account owner can turn it on under Settings.");

  const pageId = String(formData.get("pageId") ?? "");
  const page = await prisma.takeoffPlanPage.findFirst({
    where: { id: pageId, plan: { jobId, companyId: company.id } },
    include: { calibrations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!page) return actionFail("That sheet is no longer on this job. Reload the page.");
  const calibration = page.calibrations[0];
  if (!calibration) return actionFail("Set the scale on this sheet before measuring it.");

  let rooms: RoomToSave[];
  try {
    rooms = JSON.parse(String(formData.get("rooms") ?? "[]")) as RoomToSave[];
  } catch {
    return actionFail("The rooms didn't come through. Find them again.");
  }
  if (!Array.isArray(rooms) || rooms.length === 0) return actionFail("No rooms to save.");
  const rows: (Prisma.TakeoffMeasurementCreateManyInput & { ceilingItem: string | null })[] = [];
  for (const [i, room] of rooms.entries()) {
    const xs = Array.isArray(room.xs) ? room.xs.map(Number) : [];
    const ys = Array.isArray(room.ys) ? room.ys.map(Number) : [];
    const problem = verticesProblem("AREA", xs, ys);
    if (problem) return actionFail(`Room ${i + 1}${room.label ? ` (${room.label})` : ""}: ${problem}`);
    if (ringSelfIntersects(xs, ys)) return actionFail(`Room ${i + 1}${room.label ? ` (${room.label})` : ""}: its outline crosses itself.`);
    const label = String(room.label ?? "").trim().slice(0, 120);
    const ceiling = ceilingColumns(room.ceiling, i, label);
    if (!ceiling.ok) return actionFail(ceiling.error);
    rows.push({
      pageId: page.id,
      calibrationId: calibration.id,
      kind: "AREA" as const,
      xs,
      ys,
      label: label || null,
      roomName: room.roomName ? String(room.roomName).slice(0, 120) : null,
      roomNumber: room.roomNumber ? String(room.roomNumber).slice(0, 32) : null,
      ...ceiling.cols,
      source: "ROOM_FINDER" as const,
      createdByUserId: userId,
      ceilingItem: ceiling.cols.ceilingFamily !== null && CEILING_ITEM[ceiling.cols.ceilingFamily] ? ceiling.cols.ceilingFamily : null,
    });
  }
  await prisma.$transaction(async (tx) => {
    const roomsItem = await itemNamed(tx, company.id, jobId, ROOMS_ITEM, null);
    const ceilingItems = new Map<string, string>();
    for (const family of new Set(rows.map((r) => r.ceilingItem).filter((f): f is string => f !== null))) {
      ceilingItems.set(family, await itemNamed(tx, company.id, jobId, CEILING_ITEM[family].name, CEILING_ITEM[family].starter));
    }
    const data: Prisma.TakeoffMeasurementCreateManyInput[] = [];
    for (const { ceilingItem, ...row } of rows) {
      // The ROOM row carries the tag and goes to "Rooms"; the ceiling columns
      // ride on the CEILING row only, so the job summary counts each once.
      data.push({ ...row, itemId: roomsItem, ceilingFamily: null, ceilingCode: null, ceilingHeightFeet: null, ceilingFrom: null, ceilingGuess: false });
      if (ceilingItem !== null) {
        data.push({ ...row, itemId: ceilingItems.get(ceilingItem) ?? null, label: `${row.label ?? "Room"} ceiling` });
      }
    }
    await tx.takeoffMeasurement.createMany({ data });
  });
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ringSelfIntersects } from "@/lib/sheet-geometry";
import { verticesProblem } from "@/lib/takeoff-plan";
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

const JOB_COSTS_ONLY = "Only people who can see job costs can take off a plan.";

export async function saveRoomFinderSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
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
};

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
  const rows: Prisma.TakeoffMeasurementCreateManyInput[] = [];
  for (const [i, room] of rooms.entries()) {
    const xs = Array.isArray(room.xs) ? room.xs.map(Number) : [];
    const ys = Array.isArray(room.ys) ? room.ys.map(Number) : [];
    const problem = verticesProblem("AREA", xs, ys);
    if (problem) return actionFail(`Room ${i + 1}${room.label ? ` (${room.label})` : ""}: ${problem}`);
    if (ringSelfIntersects(xs, ys)) return actionFail(`Room ${i + 1}${room.label ? ` (${room.label})` : ""}: its outline crosses itself.`);
    const label = String(room.label ?? "").trim().slice(0, 120);
    rows.push({
      pageId: page.id,
      calibrationId: calibration.id,
      kind: "AREA" as const,
      xs,
      ys,
      label: label || null,
      roomName: room.roomName ? String(room.roomName).slice(0, 120) : null,
      roomNumber: room.roomNumber ? String(room.roomNumber).slice(0, 32) : null,
      source: "ROOM_FINDER" as const,
      createdByUserId: userId,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.takeoffMeasurement.createMany({ data: rows });
  });
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

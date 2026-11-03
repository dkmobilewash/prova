"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { roomRows, writeRoomRows, type RoomToSave } from "@/lib/takeoff/roomRows";

export type { RoomToSave } from "@/lib/takeoff/roomRows";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
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
  const built = roomRows({ rooms, pageId: page.id, calibrationId: calibration.id, userId });
  if (!built.ok) return actionFail(built.error);
  await prisma.$transaction(async (tx) => {
    // The sheet's rooms as they now stand: a split saved on top of the old rows
    // would count the room and its parts. A room already posted stays.
    await tx.takeoffMeasurement.deleteMany({ where: { pageId: page.id, source: "ROOM_FINDER", postedAt: null } });
    await writeRoomRows(tx, company.id, jobId, built.rows);
  });
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { nextItemColor } from "@/lib/takeoff/itemColors";
import { actionFail, type ActionResultWith } from "./shared";

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

export type DemoTakeoffInput = {
  walls: { x1: number; y1: number; x2: number; y2: number; tag?: string | null }[];
  doors: { x: number; y: number }[];
};

const MAX_RUNS = 2000;
const finite = (values: number[]) => values.every((v) => Number.isFinite(v) && v >= -0.5 && v <= 3);

/**
 * What a demolition sheet reads, saved as its own two items: "Demo walls",
 * with one LINEAR measurement per run named by its wall type where tagged, and
 * "Demo doors", one COUNT. They post through the Demolition recipe. A sheet
 * already saved is refused, because no create action here is idempotent.
 */
export async function saveDemoTakeoff(jobId: string, pageId: string, input: DemoTakeoffInput): Promise<ActionResultWith<{ walls: number; doors: number }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;
  const page = await prisma.takeoffPlanPage.findFirst({
    where: { id: pageId, plan: { jobId, companyId: company.id } },
    include: { calibrations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!page) return actionFail("That sheet is no longer on this job. Reload the page.");
  const calibration = page.calibrations[0];
  if (!calibration) return actionFail("Set the scale on this sheet before measuring it.");
  const { walls, doors } = input;
  if (walls.length === 0 && doors.length === 0) return actionFail("Nothing to save: no demolition was kept on this sheet.");
  if (walls.length > MAX_RUNS || doors.length > MAX_RUNS) return actionFail(`That is more than ${MAX_RUNS} items on one sheet.`);
  if (!finite([...walls.flatMap((w) => [w.x1, w.y1, w.x2, w.y2]), ...doors.flatMap((d) => [d.x, d.y])])) return actionFail("The demolition did not come through. Find it again.");

  const already = await prisma.takeoffMeasurement.count({ where: { pageId: page.id, item: { jobId, name: { in: ["Demo walls", "Demo doors"] } } } });
  if (already > 0) return actionFail("This sheet's demolition is already saved. Remove it from the list first to save it again.");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { id: true, name: true, colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
    const colours = existing.map((i) => i.colorHex);
    let order = (existing[0]?.sortOrder ?? -1) + 1;
    const itemFor = async (name: string, type: "LINEAR" | "COUNT") => {
      const found = existing.find((i) => i.name === name);
      if (found) return found.id;
      const colorHex = nextItemColor(colours);
      colours.push(colorHex);
      const made = await tx.takeoffItem.create({ data: { companyId: company.id, jobId, name, type, colorHex, sortOrder: order }, select: { id: true } });
      order += 1;
      return made.id;
    };
    if (walls.length > 0) {
      const itemId = await itemFor("Demo walls", "LINEAR");
      await tx.takeoffMeasurement.createMany({
        data: walls.map((w) => ({ itemId, pageId: page.id, calibrationId: calibration.id, kind: "LINEAR" as const, xs: [w.x1, w.x2], ys: [w.y1, w.y2], label: w.tag ? `Demo wall ${w.tag}` : "Demo wall", createdByUserId: userId })),
      });
    }
    if (doors.length > 0) {
      const itemId = await itemFor("Demo doors", "COUNT");
      await tx.takeoffMeasurement.create({
        data: { itemId, pageId: page.id, calibrationId: calibration.id, kind: "COUNT", xs: doors.map((d) => d.x), ys: doors.map((d) => d.y), label: "Remove door and frame", createdByUserId: userId },
      });
    }
  });
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { walls: walls.length, doors: doors.length } };
}

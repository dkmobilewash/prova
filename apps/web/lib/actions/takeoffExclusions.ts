"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, type ActionResultWith } from "./shared";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { refreshSheetWalls } from "@/lib/takeoff/refreshSheetWalls";

/**
 * What the user said about one sheet's walls — `lib/takeoff/userExclusions.ts`.
 * Each change detects the sheet again after the response, so the stored
 * proposals and any unposted walls on the job follow it.
 */
type Kind = "EXCLUDE_LIKE" | "WORK_AREA";
type Result = ActionResultWith<{ ids: string[] }>;

const JOB_COSTS_ONLY = "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

async function pageFor(jobId: string, pageId: string, context: Awaited<ReturnType<typeof requireCompanyContext>>) {
  const page = await prisma.takeoffPlanPage.findFirst({
    where: { id: pageId, plan: { jobId, companyId: context.company.id } },
    select: { id: true, pageNumber: true, planId: true, calibrations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (page === null) return { kind: "refused", error: "That sheet is no longer on this job. Reload the page." } as const;
  return { kind: "found", page, companyId: context.company.id, userId: context.id } as const;
}

function refreshAfter(jobId: string, found: Extract<Awaited<ReturnType<typeof pageFor>>, { kind: "found" }>) {
  const calibration = found.page.calibrations[0];
  if (calibration === undefined) return;
  const feetPerUnit = feetPerPageWidth({ x1: calibration.x1, y1: calibration.y1, x2: calibration.x2, y2: calibration.y2, declaredDistanceFeet: Number(calibration.declaredDistanceFeet) });
  if (feetPerUnit === null) return;
  after(async () => {
    try {
      const types = await prisma.wallType.findMany({
        where: { companyId: found.companyId },
        select: { id: true, code: true, name: true, thicknessIn: true, _count: { select: { components: true } } },
        orderBy: { sortOrder: "asc" },
      });
      await refreshSheetWalls({
        pageId: found.page.id,
        calibrationId: calibration.id,
        planId: found.page.planId,
        companyId: found.companyId,
        pageNumber: found.page.pageNumber,
        feetPerUnit,
        wallTypes: types.map((t) => ({ id: t.id, code: t.code, name: t.name, hasParts: t._count.components > 0, thicknessIn: t.thicknessIn === null ? null : Number(t.thicknessIn) })),
        jobId,
        userId: found.userId,
      });
    } catch (error) {
      console.error("[takeoff] refresh after an exclusion failed", { pageId: found.page.id }, error);
    }
  });
}

const finite = (xs: readonly number[]) => xs.every((n) => Number.isFinite(n) && n >= -0.01 && n <= 2);

export async function addSheetExclusion(jobId: string, pageId: string, kind: Kind, xs: number[], ys: number[]): Promise<Result> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const found = await pageFor(jobId, pageId, context);
  if (found.kind === "refused") return actionFail(found.error);
  if (kind !== "EXCLUDE_LIKE" && kind !== "WORK_AREA") return actionFail("That is not something a sheet can exclude.");
  const enough = kind === "EXCLUDE_LIKE" ? xs.length === 2 : xs.length >= 3;
  if (!enough || xs.length !== ys.length || !finite(xs) || !finite(ys)) return actionFail("That shape did not come through. Draw it again.");
  const row = await prisma.takeoffSheetExclusion.create({ data: { pageId, kind, xs, ys, createdByUserId: found.userId }, select: { id: true } });
  refreshAfter(jobId, found);
  revalidatePath(`/jobs/${jobId}/takeoff`);
  return { ok: true, value: { ids: [row.id] } };
}

/** One-click undo: every exclusion of this kind on this sheet. */
export async function clearSheetExclusions(jobId: string, pageId: string, kind: Kind): Promise<Result> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const found = await pageFor(jobId, pageId, context);
  if (found.kind === "refused") return actionFail(found.error);
  await prisma.takeoffSheetExclusion.deleteMany({ where: { pageId, kind } });
  refreshAfter(jobId, found);
  revalidatePath(`/jobs/${jobId}/takeoff`);
  return { ok: true, value: { ids: [] } };
}

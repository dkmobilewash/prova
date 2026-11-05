"use server";

import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { finishTakeoffFrom } from "@/lib/estimating/takeoff-item-lines";
import { wallsSheetsFor, wholeSetSummary } from "@/lib/plan-ingest/walls";
import { MAX_ATTEMPTS } from "@/lib/plan-ingest/runner";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { takeoffExport, wallGroupRows, type ExportRow, type ExportSheetRow, type ExportWallGroupRow } from "@/lib/takeoff/takeoffExport";
import { loadTakeoffWorkspace } from "@/lib/takeoff/workspaceLoad";
import { actionFail, type ActionResultWith } from "./shared";

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * The job's takeoff as rows, for the browser to write out as CSV or Excel.
 * Reads only; nothing is stored. The newest plan set, the one the takeoff
 * tab shows, and every item on the job.
 */
export async function loadTakeoffExport(jobId: string): Promise<ActionResultWith<{ rows: ExportRow[]; sheets: ExportSheetRow[]; wallGroups: ExportWallGroupRow[]; jobName: string }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { name: true, status: true } });
  if (!job) return actionFail("That job is no longer here. Reload the page.");
  const plan = await prisma.takeoffPlan.findFirst({ where: { jobId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const [items, sheets, pages, fallback, summary] = await Promise.all([
    prisma.takeoffItem.findMany({
      where: { jobId, companyId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        name: true,
        type: true,
        heightFt: true,
        sides: true,
        depthIn: true,
        measurements: {
          select: {
            id: true, kind: true, source: true, label: true, xs: true, ys: true, cutouts: true, openings: true,
            page: { select: { pageNumber: true, planId: true } },
            calibration: { select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } },
          },
        },
      },
    }),
    plan ? wallsSheetsFor(plan.id, companyId) : Promise.resolve([]),
    plan ? prisma.takeoffPlanPage.findMany({ where: { planId: plan.id }, select: { pageNumber: true, finishTakeoff: true } }) : Promise.resolve([]),
    prisma.wallType.findFirst({ where: { companyId, isDefaultPartition: true }, select: { code: true } }),
    plan ? wholeSetSummary(plan.id, companyId, MAX_ATTEMPTS) : Promise.resolve([]),
  ]);
  const sheetOf = new Map(sheets.map((s) => [s.pageNumber, [s.sheetNumber, s.title].filter(Boolean).join(" — ") || `Sheet ${s.pageNumber}`]));
  const num = (v: { toString(): string } | null) => (v === null ? null : Number(v));
  const result = takeoffExport({
    items: items.map((item) => ({
      name: item.name,
      properties: { type: item.type, heightFt: num(item.heightFt), sides: item.sides, depthIn: num(item.depthIn) },
      measurements: item.measurements
        .filter((m) => plan === null || m.page.planId === plan.id)
        .map((m) => ({
          id: m.id,
          pageNumber: m.page.pageNumber,
          kind: m.kind,
          xs: m.xs,
          ys: m.ys,
          cutouts: Array.isArray(m.cutouts) ? (m.cutouts as { xs: number[]; ys: number[] }[]) : [],
          feetPerPageWidth: m.calibration === null ? null : feetPerPageWidth({ ...m.calibration, declaredDistanceFeet: Number(m.calibration.declaredDistanceFeet) }),
          source: m.source,
          label: m.label,
          openingsJson: m.openings,
        })),
    })),
    sheetOf,
    finish: pages.filter((p) => p.finishTakeoff !== null).map((p) => ({ pageNumber: p.pageNumber, lines: finishTakeoffFrom(p.finishTakeoff).lines })),
    defaultPartition: fallback?.code ?? null,
    summary,
  });
  // The groups exactly as the workspace loads them, so the tab lists what the
  // layer panel lists, under the same keys the team's names were saved by.
  const workspace = plan ? await loadTakeoffWorkspace({ id: companyId }, { id: jobId, status: job.status }) : null;
  const wallGroups =
    workspace === null
      ? []
      : wallGroupRows({
          groupsByPage: workspace.storedWallsByPage,
          sheetOf,
          names: workspace.layerNames,
          itemNames: new Map(workspace.matchableItems.map((item) => [item.id, item.name])),
        });
  return { ok: true, value: { ...result, wallGroups, jobName: job.name } };
}

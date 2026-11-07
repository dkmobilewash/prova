"use server";

import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

import { openSharedPlanPdf } from "@/lib/plan-ingest/sharedPlanPdf";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { compareSheets, measurementsNearChanges, type Seg } from "@/lib/takeoff/sheetCompare";
import { earlierVersionsFor } from "@/lib/takeoff/sheetRevisions";
import { actionFail, type ActionResultWith } from "./shared";

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** More than this many pieces is a re-drawn sheet, and the overlay says so rather than drawing them all. */
const MAX_PIECES = 4000;

export type RevisionCompare = {
  earlier: string;
  added: Seg[];
  removed: Seg[];
  truncated: boolean;
  /** Of the new sheet's lines, the share the earlier version also has. */
  agreement: number;
  /** Takeoff items with measurements on the earlier version that run through a change. */
  changedItems: { name: string; changed: number; total: number }[];
};

async function strokesOf(planId: string, companyId: string, pageNumber: number) {
  const read = await openSharedPlanPdf(planId, companyId);
  if (!read.ok) return read;
  const doc = read.pdf;
  try {
    const s = await doc.pageStrokes(pageNumber);
    const W = s.widthPt;
    return { ok: true as const, aspect: s.heightPt / W, segs: s.segments.map((g) => ({ x1: g.x1 / W, y1: g.y1 / W, x2: g.x2 / W, y2: g.y2 / W })) };
  } finally {
    await doc.close();
  }
}

/**
 * This sheet laid over the version it replaced: added and removed line work,
 * placed on THIS sheet, and the items measured on the old one that a change
 * runs through. Reads only.
 */
export async function compareSheetRevision(jobId: string, planId: string, pageNumber: number): Promise<ActionResultWith<RevisionCompare>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, jobId, companyId }, select: { id: true } });
  if (!plan) return actionFail("That drawing is no longer on this job. Reload the page.");
  const earlier = (await earlierVersionsFor(jobId, companyId, planId))[pageNumber];
  if (!earlier) return actionFail("No earlier version of this sheet is on the job.");
  const [before, after] = await Promise.all([strokesOf(earlier.planId, companyId, earlier.pageNumber), strokesOf(planId, companyId, pageNumber)]);
  if (!before.ok) return actionFail(before.error);
  if (!after.ok) return actionFail(after.error);
  const c = compareSheets(before.segs, after.segs, Math.max(before.aspect, after.aspect));

  const oldPage = await prisma.takeoffPlanPage.findFirst({
    where: { planId: earlier.planId, pageNumber: earlier.pageNumber },
    select: {
      calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } },
      measurements: { where: { itemId: { not: null } }, select: { id: true, kind: true, xs: true, ys: true, item: { select: { name: true } } } },
    },
  });
  const changedItems: RevisionCompare["changedItems"] = [];
  if (oldPage && oldPage.measurements.length > 0) {
    const cal = oldPage.calibrations[0];
    const fpu = cal ? feetPerPageWidth({ ...cal, declaredDistanceFeet: Number(cal.declaredDistanceFeet) }) : null;
    // A foot either side, on the old sheet's own scale; a pen width where it has none.
    const near = fpu ? 1 / fpu : 0.002;
    const back = (s: Seg) => ({ x1: s.x1 + c.offset.dx, y1: s.y1 + c.offset.dy, x2: s.x2 + c.offset.dx, y2: s.y2 + c.offset.dy });
    const hit = measurementsNearChanges(
      oldPage.measurements.map((m) => ({ id: m.id, xs: m.xs, ys: m.ys, closed: m.kind === "AREA" })),
      [...c.added, ...c.removed].map(back),
      before.aspect,
      near,
    );
    const byItem = new Map<string, { changed: number; total: number }>();
    for (const m of oldPage.measurements) {
      const row = byItem.get(m.item!.name) ?? { changed: 0, total: 0 };
      row.total += 1;
      if (hit.has(m.id)) row.changed += 1;
      byItem.set(m.item!.name, row);
    }
    for (const [name, row] of byItem) if (row.changed > 0) changedItems.push({ name, ...row });
    changedItems.sort((a, b) => b.changed - a.changed || a.name.localeCompare(b.name));
  }
  const truncated = c.added.length + c.removed.length > MAX_PIECES;
  return {
    ok: true,
    value: {
      earlier: earlier.label,
      added: truncated ? [] : c.added,
      removed: truncated ? [] : c.removed,
      truncated,
      agreement: c.agreement,
      changedItems,
    },
  };
}

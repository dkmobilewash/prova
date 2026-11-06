"use server";

import { prisma } from "@prova/db";
import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { itemForType, untypedItem, UNTYPED_ITEM } from "@/lib/plan-ingest/wallItems";
import { sameCode } from "@/lib/takeoff/legendMerge";
import { storedLegendTypesFromJson } from "@/lib/takeoff/legendProposal";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "./shared";
import { addWallTypeFromLegend } from "./wallLegend";
import { syncDecidedItems } from "@/lib/estimating/takeoff-item-lines";

/**
 * ── "SET TYPE": THE ESTIMATOR NAMES WHAT THE DRAWING DID NOT ──
 *
 * One press on an untyped group's row, from the codes the set's legend read
 * defines. Every run of the group goes onto that type's takeoff item: the
 * measurements the WALLS stage already posted to "Walls — untyped" move, and
 * runs nothing posted yet are written. So the choice is saved with the job
 * and "Send to estimate" prices it with the type's assembly.
 *
 * A code the company's library does not have yet is added from the legend
 * read exactly as read (`addWallTypeFromLegend`, the review screen's own
 * action), with its "check against the drawing" note.
 *
 * Remembered for the job: the item takes the group's thickness, so later
 * sheets' groups at that thickness match it (`matchGroupToItem`) and the
 * WALLS stage posts them as this type (`wallItems.ts`).
 */
const JOB_COSTS_ONLY = "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const RUNS_MAX = 2000;

export type WallGroupTypeInput = {
  planId: string;
  pageNumber: number;
  code: string;
  inches: number;
  runs: { x1: number; y1: number; x2: number; y2: number }[];
};

export async function setWallGroupType(jobId: string, input: WallGroupTypeInput): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // The takeoff tab's capability, as its other writes. Adding a NEW type to
  // the library is still estimating's, and `addWallTypeFromLegend` says so.
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  return typeGroup(context, jobId, input, null);
}

/**
 * ── THE REVIEW QUEUE'S ENTER: A GROUP'S TYPE AND HEIGHT IN ONE PRESS ──
 *
 * Set type, then the height on that type's item for the whole job (as
 * `setWallGroupHeight` does), in one transaction and one round trip, so a
 * person confirming suggestions waits on neither. A height equal to the
 * item's own changes nothing. The estimate lines of the items the runs left
 * and joined are written or updated at once (`syncDecidedItems`), so a
 * reviewed takeoff is an estimate with no further press.
 */
export async function confirmWallGroup(jobId: string, input: WallGroupTypeInput & { heightFt: number | null; level?: string | null }): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const heightFt = input.heightFt;
  if (heightFt !== null && (!Number.isFinite(heightFt) || heightFt <= 0 || heightFt >= 100)) return actionFail("A wall height is a number of feet between 0 and 100.");
  // A level's walls are their own item, so floors with different floor-to-floors can each have theirs.
  const level = typeof input.level === "string" && /^levels? \d{1,2}(–\d{1,2})?$/.test(input.level) ? input.level : null;
  return typeGroup(context, jobId, input, heightFt, level);
}

/** Both actions' work, after each has checked the capability itself. */
async function typeGroup(context: Awaited<ReturnType<typeof requireCompanyContext>>, jobId: string, input: WallGroupTypeInput, heightFt: number | null, level: string | null = null): Promise<ActionResult> {
  const companyId = context.company.id;
  const code = String(input.code ?? "").trim().toUpperCase();
  const runs = Array.isArray(input.runs) ? input.runs.filter((r) => [r.x1, r.y1, r.x2, r.y2].every(Number.isFinite)) : [];
  if (code === "") return actionFail("Pick a type.");
  if (runs.length === 0 || runs.length > RUNS_MAX) return actionFail("That group has no walls to type. Reload the page.");
  if (!Number.isFinite(input.inches) || input.inches <= 0) return actionFail("That group has no thickness. Reload the page.");

  const page = await prisma.takeoffPlanPage.findFirst({
    where: { planId: input.planId, pageNumber: input.pageNumber, plan: { job: { id: jobId, companyId } } },
    select: { id: true, calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  if (page === null) return actionFail("That sheet is no longer on this job. Reload the page.");

  let type = await prisma.wallType.findFirst({ where: { companyId, code: { equals: code, mode: "insensitive" } }, select: { id: true, code: true, name: true, thicknessIn: true, defaultHeightFt: true, sides: true, _count: { select: { components: true } } } });
  if (type === null) {
    const proposals = await prisma.planLegendProposal.findMany({ where: { planId: input.planId }, orderBy: { createdAt: "desc" }, select: { id: true, merged: true } });
    const found = proposals.map((p) => ({ id: p.id, type: storedLegendTypesFromJson(p.merged).find((t) => sameCode(t.code, code)) })).find((p) => p.type !== undefined);
    if (found === undefined || found.type === undefined) return actionFail(`${code} isn't a type this set's legend defines.`);
    const read = found.type.assembly.read;
    const added = await addWallTypeFromLegend(jobId, found.id, {
      code,
      name: found.type.name ?? `Wall type ${code}`,
      studWidthIn: read.studWidthIn,
      studSpacingIn: read.studSpacingIn,
      boardThicknessIn: read.boardThicknessIn,
      layersPerSide: read.layersPerSide,
      insulation: read.insulation,
      hourlyRating: read.hourlyRating,
      thicknessIn: null,
    });
    if (!added.ok) return actionFail(added.error);
    type = await prisma.wallType.findFirst({ where: { companyId, code: { equals: code, mode: "insensitive" } }, select: { id: true, code: true, name: true, thicknessIn: true, defaultHeightFt: true, sides: true, _count: { select: { components: true } } } });
    if (type === null) return actionFail(`${code} could not be added to your library. Try it again.`);
  }
  const wallType = type;

  await prisma.$transaction(async (tx) => {
    const itemId = await itemForType(
      tx,
      companyId,
      jobId,
      { id: wallType.id, code: wallType.code, name: wallType.name, hasParts: wallType._count.components > 0, thicknessIn: wallType.thicknessIn === null ? null : Number(wallType.thicknessIn) },
      { defaultHeightFt: wallType.defaultHeightFt, sides: wallType.sides },
      level,
    );
    await tx.takeoffItem.updateMany({ where: { id: itemId, thicknessIn: null }, data: { thicknessIn: input.inches.toFixed(2) } });
    const untyped = await tx.takeoffItem.findFirst({ where: { jobId, companyId, name: UNTYPED_ITEM }, select: { id: true } });
    const posted = await tx.takeoffMeasurement.findMany({ where: { pageId: page.id, kind: "LINEAR", source: "DETECTED" }, select: { id: true, xs: true, ys: true, itemId: true } });
    const label = `${wallType.code} wall (set by hand)`;
    const data = [];
    for (const run of runs) {
      const at = posted.filter((m) => m.xs.length === 2 && m.xs[0] === run.x1 && m.xs[1] === run.x2 && m.ys[0] === run.y1 && m.ys[1] === run.y2);
      if (at.length === 0) {
        data.push({ pageId: page.id, calibrationId: page.calibrations[0]?.id ?? null, kind: "LINEAR" as const, xs: [run.x1, run.x2], ys: [run.y1, run.y2], label, source: "DETECTED" as const, itemId, createdByUserId: context.id });
        continue;
      }
      // Only what sits on "Walls — untyped" moves: a run already typed, or held
      // off the estimate to confirm, keeps the decision it carries.
      const ids = at.filter((m) => untyped !== null && m.itemId === untyped.id).map((m) => m.id);
      if (ids.length > 0) await tx.takeoffMeasurement.updateMany({ where: { id: { in: ids } }, data: { itemId, label } });
    }
    if (data.length > 0) await tx.takeoffMeasurement.createMany({ data });
    if (heightFt !== null) {
      await tx.takeoffItem.update({ where: { id: itemId }, data: { heightFt: heightFt.toFixed(2) } });
      await tx.takeoffItem.updateMany({ where: { id: itemId, sides: null }, data: { sides: 2 } });
    }
    // The type's line, and the untyped line the runs left, written now.
    await syncDecidedItems(tx, companyId, jobId, [itemId, untyped?.id ?? null]);
  });
  revalidatePath(`/jobs/${jobId}`, "layout");
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

/**
 * ── "CLEAR TYPE": A TYPE SET BY MISTAKE, TAKEN OFF ──
 *
 * Chrome's re-test on Baker: a group typed by mistake could not be undone or
 * cleared. Every run of the group that sits on a typed item goes back onto
 * "Walls — untyped" with the label the walls stage gives it, and both items'
 * estimate lines follow. A run held to confirm, dropped, or already untyped is
 * left as it is. Returns what moved and from where, which is what Undo needs
 * to put it back.
 */
export async function clearWallGroupType(
  jobId: string,
  input: { planId: string; pageNumber: number; runs: { x1: number; y1: number; x2: number; y2: number }[] },
): Promise<ActionResultWith<{ moved: { id: string; itemId: string | null; label: string | null }[] }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  const runs = Array.isArray(input.runs) ? input.runs.filter((r) => [r.x1, r.y1, r.x2, r.y2].every(Number.isFinite)) : [];
  if (runs.length === 0 || runs.length > RUNS_MAX) return actionFail("That group has no walls to clear. Reload the page.");
  const page = await prisma.takeoffPlanPage.findFirst({ where: { planId: input.planId, pageNumber: input.pageNumber, plan: { job: { id: jobId, companyId } } }, select: { id: true } });
  if (page === null) return actionFail("That sheet is no longer on this job. Reload the page.");
  const moved = await prisma.$transaction(async (tx) => {
    const posted = await tx.takeoffMeasurement.findMany({
      where: { pageId: page.id, kind: "LINEAR", source: "DETECTED", itemId: { not: null }, item: { name: { not: UNTYPED_ITEM } } },
      select: { id: true, xs: true, ys: true, itemId: true, label: true },
    });
    const ours = posted.filter((m) => m.xs.length === 2 && runs.some((r) => m.xs[0] === r.x1 && m.xs[1] === r.x2 && m.ys[0] === r.y1 && m.ys[1] === r.y2));
    if (ours.length === 0) return [];
    const untyped = await untypedItem(tx, companyId, jobId);
    await tx.takeoffMeasurement.updateMany({ where: { id: { in: ours.map((m) => m.id) } }, data: { itemId: untyped, label: "wall, untyped" } });
    await syncDecidedItems(tx, companyId, jobId, [untyped, ...new Set(ours.map((m) => m.itemId))]);
    return ours.map((m) => ({ id: m.id, itemId: m.itemId, label: m.label }));
  });
  if (moved.length === 0) return actionFail("Nothing on this group is typed now. Reload the page.");
  revalidatePath(`/jobs/${jobId}`, "layout");
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { moved } };
}

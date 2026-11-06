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
import { sameRunAs } from "@/lib/takeoff/runMatch";

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
 * ── ONLY THE RUNS OF THE GROUP IT WAS PRESSED ON ──
 * It used to write the group's thickness onto the type's item, "remembered for
 * the job", and the thickness then matched EVERY group that thick to the item
 * (`matchGroupToItem`): Chrome on Baker set S6B on the 114 ft 7-3/8" group and
 * the 17 ft S6A-tagged and 20 ft S8B-tagged groups read S6B too, and still did
 * after Undo. Set type moves its own runs and nothing else learns from them.
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
 * ── A GROUP'S TYPE AND HEIGHT IN ONE PRESS ──
 *
 * Set type, then the height on that type's item for the whole job (as
 * `setWallGroupHeight` does), in one transaction and one round trip. A height
 * equal to the item's own changes nothing. The estimate lines of the items the
 * runs left and joined are written or updated at once (`syncDecidedItems`).
 * The review queue's Enter and "Accept all suggestions on this sheet" both go
 * through `confirmSheetSuggestions` below — one group or many — for the token
 * Undo puts it back with.
 */
export type ConfirmGroupInput = WallGroupTypeInput & { heightFt: number | null; level?: string | null };

/** The height and level a group may be confirmed with, or why not. */
function checkedHeight(input: ConfirmGroupInput): { heightFt: number | null; level: string | null } | string {
  const heightFt = input.heightFt;
  if (heightFt !== null && (!Number.isFinite(heightFt) || heightFt <= 0 || heightFt >= 100)) return "A wall height is a number of feet between 0 and 100.";
  // A level's walls are their own item, so floors with different floor-to-floors can each have theirs.
  const level = typeof input.level === "string" && /^levels? \d{1,2}(–\d{1,2})?$/.test(input.level) ? input.level : null;
  return { heightFt, level };
}

/**
 * ── "ACCEPT ALL SUGGESTIONS ON THIS SHEET": EVERY DRAWN SUGGESTION IN ONE PRESS ──
 *
 * The queue's Enter, for each group on one sheet whose type the drawing gave
 * (a printed tag or the legend, `Guess.drawn`) — the client sends only those,
 * with the height each would have pre-filled. Each group is its own
 * `typeGroup`, so its lines are written as Enter writes them; one that fails
 * is named and the rest still go in. The walk v4's queue was most of its
 * 15–18 minutes, one key per group.
 *
 * WHAT UNDO NEEDS IS TAKEN HERE, before and after: the sheet's found runs
 * (which item and label each had) and the job's items' heights. Undo puts
 * each moved run back, removes the runs this wrote, and restores the heights
 * (`undoSheetSuggestions`).
 */
export type SheetSuggestionsUndo = {
  moved: { id: string; itemId: string | null; label: string | null }[];
  created: string[];
  items: { id: string; heightFt: string | null; sides: number | null }[];
};
const GROUPS_MAX = 200;

export async function confirmSheetSuggestions(jobId: string, groups: ConfirmGroupInput[]): Promise<ActionResultWith<{ accepted: number; failed: string[]; undo: SheetSuggestionsUndo }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > GROUPS_MAX) return actionFail("No suggestions to accept on this sheet. Reload the page.");
  const companyId = context.company.id;
  const pages = await prisma.takeoffPlanPage.findMany({
    where: { plan: { job: { id: jobId, companyId } }, OR: [...new Map(groups.map((g) => [`${g.planId}:${g.pageNumber}`, { planId: g.planId, pageNumber: g.pageNumber }])).values()] },
    select: { id: true },
  });
  if (pages.length === 0) return actionFail("That sheet is no longer on this job. Reload the page.");
  const snapshot = async () => ({
    runs: await prisma.takeoffMeasurement.findMany({ where: { pageId: { in: pages.map((p) => p.id) }, kind: "LINEAR", source: "DETECTED" }, select: { id: true, itemId: true, label: true } }),
    items: await prisma.takeoffItem.findMany({ where: { jobId, companyId }, select: { id: true, heightFt: true, sides: true } }),
  });
  const before = await snapshot();
  let accepted = 0;
  const failed: string[] = [];
  for (const group of groups) {
    const checked = checkedHeight(group);
    const result = typeof checked === "string" ? actionFail(checked) : await typeGroup(context, jobId, group, checked.heightFt, checked.level);
    if (result.ok) accepted += 1;
    else failed.push(`${String(group.code)}: ${result.error}`);
  }
  const after = await snapshot();
  const was = new Map(before.runs.map((m) => [m.id, m]));
  const height = new Map(before.items.map((i) => [i.id, i]));
  const undo: SheetSuggestionsUndo = {
    moved: after.runs.flatMap((m) => {
      const old = was.get(m.id);
      return old !== undefined && (old.itemId !== m.itemId || old.label !== m.label) ? [{ id: m.id, itemId: old.itemId, label: old.label }] : [];
    }),
    created: after.runs.filter((m) => !was.has(m.id)).map((m) => m.id),
    items: after.items.flatMap((i) => {
      const old = height.get(i.id);
      if (old === undefined) return [];
      const same = String(old.heightFt ?? "") === String(i.heightFt ?? "") && old.sides === i.sides;
      return same ? [] : [{ id: i.id, heightFt: old.heightFt === null ? null : String(old.heightFt), sides: old.sides }];
    }),
  };
  return { ok: true, value: { accepted, failed, undo } };
}

/** Undo for `confirmSheetSuggestions`: only rows of this job are touched, whatever the client sends. */
export async function undoSheetSuggestions(jobId: string, undo: SheetSuggestionsUndo): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  const moved = Array.isArray(undo?.moved) ? undo.moved.slice(0, RUNS_MAX * GROUPS_MAX) : [];
  const created = Array.isArray(undo?.created) ? undo.created.filter((id) => typeof id === "string") : [];
  const items = Array.isArray(undo?.items) ? undo.items : [];
  const onJob = { page: { plan: { job: { id: jobId, companyId } } } };
  await prisma.$transaction(async (tx) => {
    const ours = new Set((await tx.takeoffMeasurement.findMany({ where: { id: { in: [...moved.map((m) => m.id), ...created] }, ...onJob }, select: { id: true } })).map((m) => m.id));
    const jobItems = new Set((await tx.takeoffItem.findMany({ where: { jobId, companyId }, select: { id: true } })).map((i) => i.id));
    const touched = new Set<string>();
    const now = await tx.takeoffMeasurement.findMany({ where: { id: { in: [...ours] } }, select: { id: true, itemId: true } });
    for (const m of now) if (m.itemId !== null) touched.add(m.itemId);
    for (const m of moved) {
      if (!ours.has(m.id) || (m.itemId !== null && !jobItems.has(m.itemId))) continue;
      await tx.takeoffMeasurement.update({ where: { id: m.id }, data: { itemId: m.itemId, label: m.label } });
      if (m.itemId !== null) touched.add(m.itemId);
    }
    const gone = created.filter((id) => ours.has(id));
    if (gone.length > 0) await tx.takeoffMeasurement.deleteMany({ where: { id: { in: gone } } });
    for (const item of items) {
      if (!jobItems.has(item.id)) continue;
      const feet = item.heightFt === null ? null : Number(item.heightFt);
      if (feet !== null && !(feet > 0 && feet < 100)) continue;
      await tx.takeoffItem.update({ where: { id: item.id }, data: { heightFt: feet === null ? null : feet.toFixed(2), sides: Number.isInteger(item.sides) ? item.sides : null } });
      touched.add(item.id);
    }
    await syncDecidedItems(tx, companyId, jobId, [...touched]);
  });
  revalidatePath(`/jobs/${jobId}`, "layout");
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
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
    const untyped = await tx.takeoffItem.findFirst({ where: { jobId, companyId, name: UNTYPED_ITEM }, select: { id: true } });
    const posted = await tx.takeoffMeasurement.findMany({ where: { pageId: page.id, kind: "LINEAR", source: "DETECTED" }, select: { id: true, xs: true, ys: true, itemId: true } });
    const label = `${wallType.code} wall (set by hand)`;
    const data = [];
    for (const run of runs) {
      // The run already on the job, found again by a re-run a hair off (`sameRunAs`):
      // matched exactly, it was written a second time and the wall counted twice.
      const at = posted.filter((m) => sameRunAs(run, m.xs, m.ys));
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
    const ours = posted.filter((m) => runs.some((r) => sameRunAs(r, m.xs, m.ys)));
    if (ours.length === 0) return [];
    const untyped = await untypedItem(tx, companyId, jobId);
    await tx.takeoffMeasurement.updateMany({ where: { id: { in: ours.map((m) => m.id) } }, data: { itemId: untyped, label: "wall, untyped" } });
    // A typed item left with no walls keeps no thickness: an earlier build's Set
    // type wrote one, and it matched every group that thick to the empty item.
    const left = [...new Set(ours.map((m) => m.itemId).filter((id): id is string => id !== null))];
    await tx.takeoffItem.updateMany({ where: { id: { in: left }, wallTypeId: { not: null }, measurements: { none: {} } }, data: { thicknessIn: null } });
    await syncDecidedItems(tx, companyId, jobId, [untyped, ...left]);
    return ours.map((m) => ({ id: m.id, itemId: m.itemId, label: m.label }));
  });
  if (moved.length === 0) return actionFail("Nothing on this group is typed now. Reload the page.");
  revalidatePath(`/jobs/${jobId}`, "layout");
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { moved } };
}

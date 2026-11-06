"use server";

import { prisma } from "@prova/db";
import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { namedItem, untypedItem } from "@/lib/plan-ingest/wallItems";
import { syncDecidedItems } from "@/lib/estimating/takeoff-item-lines";
import { DROPPED_ITEM } from "@/lib/takeoff/estimateHold";
import { sameRunAs } from "@/lib/takeoff/runMatch";
import { loadAddendumChanges } from "@/lib/takeoff/addendumChanges";
import { actionFail, type ActionResultWith } from "./shared";
import type { SheetSuggestionsUndo } from "./wallGroupType";

/**
 * ── AN ADDENDUM'S SHEETS, APPLIED TO THE TAKEOFF, WITH UNDO ──
 *
 * What the addendum page shows (`loadAddendumChanges`), recomputed here rather
 * than taken from the browser. On each compared sheet:
 *   - each revised run goes onto the item its earlier twin was on, or "Walls —
 *     untyped" when it has none: a run already posted on the revised sheet is
 *     moved, any other is written;
 *   - each earlier run of that sheet goes onto "Walls — dropped", labelled with
 *     the drawing that replaced it: on its sheet, off the estimate.
 * The estimate lines of every item touched are rewritten at once. The token is
 * the queue's own (`undoSheetSuggestions` puts every row back and removes the
 * written ones), so Undo is the action the review queue already trusts.
 */
const ESTIMATING_ONLY = "Applying an addendum changes the estimate, which isn't part of your job function. The account owner sets who sees what, on the Team page.";

export async function applyRevisedSheets(jobId: string): Promise<ActionResultWith<{ moved: number; written: number; replaced: number; undo: SheetSuggestionsUndo }>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);
  const companyId = context.company.id;
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true } });
  if (job === null) return actionFail("That job is no longer here. Reload the page.");
  const changes = await loadAddendumChanges(companyId, jobId);
  const work = (changes?.sheets ?? []).flatMap((s) => (s.work === undefined ? [] : [s.work]));
  if (changes === null || work.length === 0) return actionFail("No compared sheet to apply. Set the revised sheets' scales and run their takeoff first.");
  const label = `replaced by ${changes.planLabel}`.slice(0, 120);

  const undo = await prisma.$transaction(async (tx) => {
    const moved: SheetSuggestionsUndo["moved"] = [];
    const created: string[] = [];
    const touched = new Set<string>();
    const untyped = await untypedItem(tx, companyId, jobId);
    const dropped = await namedItem(tx, companyId, jobId, DROPPED_ITEM);
    for (const sheet of work) {
      const posted = await tx.takeoffMeasurement.findMany({ where: { pageId: sheet.pageId, kind: "LINEAR" }, select: { id: true, xs: true, ys: true, itemId: true, label: true } });
      for (const run of sheet.news) {
        const to = run.itemId ?? untyped;
        const at = posted.find((m) => sameRunAs(run, m.xs, m.ys));
        if (at === undefined) {
          const row = await tx.takeoffMeasurement.create({ data: { pageId: sheet.pageId, calibrationId: sheet.calibrationId, kind: "LINEAR", source: "DETECTED", xs: [run.x1, run.x2], ys: [run.y1, run.y2], itemId: to, label: run.itemId === null ? "wall, untyped" : "wall (carried from the earlier sheet)", createdByUserId: context.id }, select: { id: true } });
          created.push(row.id);
          touched.add(to);
        } else if (at.itemId !== to && (at.itemId === null || at.itemId === untyped)) {
          // Only an untyped run takes the carried type; one somebody already decided keeps it.
          moved.push({ id: at.id, itemId: at.itemId, label: at.label });
          await tx.takeoffMeasurement.update({ where: { id: at.id }, data: { itemId: to, label: "wall (carried from the earlier sheet)" } });
          touched.add(to);
          if (at.itemId !== null) touched.add(at.itemId);
        }
      }
      const earlier = await tx.takeoffMeasurement.findMany({ where: { id: { in: sheet.oldIds } }, select: { id: true, itemId: true, label: true } });
      for (const m of earlier) {
        moved.push({ id: m.id, itemId: m.itemId, label: m.label });
        if (m.itemId !== null) touched.add(m.itemId);
      }
      if (earlier.length > 0) await tx.takeoffMeasurement.updateMany({ where: { id: { in: earlier.map((m) => m.id) } }, data: { itemId: dropped, label } });
    }
    await syncDecidedItems(tx, companyId, jobId, [...touched, dropped]);
    return { moved, created, items: [] };
  });
  revalidatePath(`/jobs/${jobId}`, "layout");
  revalidatePath(`/takeoff/${jobId}`);
  const replaced = work.reduce((n, s) => n + s.oldIds.length, 0);
  return { ok: true, value: { moved: undo.moved.length - replaced, written: undo.created.length, replaced, undo } };
}

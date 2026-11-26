import { prisma } from "@prova/db";
import { deleteEmptyItems } from "@/lib/estimating/takeoff-item-lines";
import { deleteDocument } from "@/lib/blob";
import { isSamplePlanUrl } from "@/lib/sample-job/samplePlan";
import { UNDO_WINDOW_MS, type PlanDeleteRecord } from "@/lib/takeoff/planDelete";

/**
 * ── THE PURGE: A DELETED PLAN GOES FOR GOOD AFTER ITS UNDO WINDOW (Diego, 2026-11-26; plan-delete-undo.md U6) ──
 *
 * Crons on this account run once a day, so this runs LAZILY: the takeoff pages call it for their company on every load,
 * and the daily plan-ingest cron sweeps every company as the backstop (Diego accepted that a deleted drawing's file can
 * stay at its unguessable URL up to about a day when nobody opens the job again). Each plan: the row (its pages, runs and
 * everything below cascade), then the items the delete emptied if they are still empty, then the file. Idempotent: a
 * plan already purged is simply not found, and two callers cannot both delete one (`deleteMany` counts).
 */
export async function purgeDeletedPlans(options: { companyId?: string; now?: Date } = {}): Promise<number> {
  const cutoff = new Date((options.now ?? new Date()).getTime() - UNDO_WINDOW_MS);
  const due = await prisma.takeoffPlan.findMany({
    where: { deletedAt: { lt: cutoff }, ...(options.companyId === undefined ? {} : { companyId: options.companyId }) },
    select: { id: true, companyId: true, fileUrl: true, deleteUndo: true },
  });
  let purged = 0;
  for (const plan of due) {
    const gone = await prisma.$transaction(async (tx) => {
      const { count } = await tx.takeoffPlan.deleteMany({ where: { id: plan.id, deletedAt: { lt: cutoff } } });
      if (count === 0) return false;
      const record = plan.deleteUndo as PlanDeleteRecord | null;
      await deleteEmptyItems(tx, record?.emptied ?? [], { companyId: plan.companyId });
      return true;
    });
    if (!gone) continue;
    purged += 1;
    // Only once the row is gone (the order `deleteTakeoffPlan` always kept). A sample set is shared, never deleted.
    if (plan.fileUrl && !isSamplePlanUrl(plan.fileUrl)) await deleteDocument(plan.fileUrl);
  }
  return purged;
}

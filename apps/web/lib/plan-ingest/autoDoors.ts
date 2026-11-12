import { prisma } from "@prova/db";
import { countItemFor } from "@/lib/takeoff/countItem";
import { AUTO_DOORS_ITEM, AUTO_DOORS_LABEL, doorAutoPosts } from "@/lib/takeoff/autoPost";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";

/**
 * ── MARKED DOORS POST THEMSELVES, AS A COUNT, WITH UNDO ──
 *
 * The one source past the bar (`autoPost.ts`, DOOR_EVIDENCE): a door the finder draws with a
 * printed mark beside it. On a company with "Auto-post proven items" on, the sheet's marked
 * doors are written as one COUNT on the job's "Doors" item, labelled "Doors (auto, from
 * printed mark)". A re-run replaces it. Undo (`undoAutoPost`) deletes it and leaves
 * DOORS_AUTO_UNDONE behind, so a re-run never puts back what a person took off.
 */
export const DOORS_AUTO_UNDONE = "doors-auto-undone";

export async function postAutoDoors(input: {
  planId: string;
  pageNumber: number;
  pageId: string;
  calibrationId: string | null;
  companyId: string;
  jobId: string;
  userId: string | null;
  /** The marked doors' leaf midpoints, page-width units. */
  points: readonly { x: number; y: number }[];
}): Promise<number> {
  if (!doorAutoPosts("door-marked")) return 0;
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { autoPostOn: true } });
  if (company?.autoPostOn !== true) return 0;
  const undone = await prisma.takeoffPlanTextRead.findUnique({ where: { planId_pageNumber_kind: { planId: input.planId, pageNumber: input.pageNumber, kind: DOORS_AUTO_UNDONE } }, select: { planId: true } });
  if (undone !== null) return 0;
  const cleared = await prisma.takeoffMeasurement.deleteMany({ where: { pageId: input.pageId, kind: "COUNT", label: AUTO_DOORS_LABEL } });
  if (input.points.length === 0 && cleared.count === 0) return 0;
  const itemId = await countItemFor(input.companyId, input.jobId, AUTO_DOORS_ITEM);
  if (itemId === null) return 0;
  if (input.points.length > 0) {
    await prisma.takeoffMeasurement.create({
      data: { itemId, pageId: input.pageId, calibrationId: input.calibrationId, kind: "COUNT", xs: input.points.map((p) => p.x), ys: input.points.map((p) => p.y), label: AUTO_DOORS_LABEL, createdByUserId: input.userId },
    });
  }
  // The doors reach the bid: no line while doors are by others, else the company's door lines
  // (`doorLines.ts`), and the labor follows. Only this item's lines move.
  await prisma.$transaction((tx) => syncTakeoffItemLines(tx, input.companyId, input.jobId, new Set([itemId])), { timeout: 60_000 });
  return input.points.length;
}

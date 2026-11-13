import { prisma } from "@prova/db";

/**
 * ── "COUNT THE EXISTING DOORS ON THIS SHEET": THE UNDO OF THE DOOR SET-ASIDE ──
 *
 * `existingDoors.ts` sets a found door aside as existing; a person who disagrees presses Undo and the
 * sheet's doors are found with nothing set aside, on the screen and in the whole-set run, until they
 * set them aside again. One `TakeoffPlanTextRead` row per page under this kind is that choice, the way
 * `PRIOR_PLAN_READ` keeps a comparison; no migration.
 */
export const EXISTING_DOORS_COUNTED = "existing-doors-counted";

/** The pages of a plan whose existing doors a person chose to count. */
export async function countedExistingDoorPages(planId: string): Promise<number[]> {
  const rows = await prisma.takeoffPlanTextRead.findMany({ where: { planId, kind: EXISTING_DOORS_COUNTED }, select: { pageNumber: true } });
  return rows.map((r) => r.pageNumber).sort((a, b) => a - b);
}

export async function existingDoorsCountedOn(planId: string, pageNumber: number): Promise<boolean> {
  return (await prisma.takeoffPlanTextRead.count({ where: { planId, pageNumber, kind: EXISTING_DOORS_COUNTED } })) > 0;
}

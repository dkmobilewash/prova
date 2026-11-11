import { prisma } from "@prova/db";

/**
 * ── WHICH PAGES ARE FLOOR PLANS BY THEIR OWN DRAWINGS, WITH NO MODEL ──
 *
 * With plan reading off (and plan comparison off) nothing names a sheet, so no row of the
 * plan set is a floor plan: the Scale step asked for none, "Confirm scales" saved the sheets
 * the reader was sure of (Baker: the ceiling plan A111 and three structural sheets) and the
 * step called itself done, with A100 and A101 unscaled (the new-customer walk, 2026-11-10).
 *
 * The page inventory, which reads every page's text anyway and calls no model, records per
 * page whether its own captions or title say FLOOR PLAN (`sureFloorPlan`, the same test the
 * viewer uses to leave a sheet where Run takeoff is off). It is a flag, not a name: nothing
 * customer-visible is stored, so it needs no switch.
 */
export const SURE_FLOOR_PLAN = "SURE_FLOOR_PLAN";

/** The plan's pages the inventory recorded as sure floor plans, in page order. */
export async function sureFloorPlanPages(planId: string): Promise<number[]> {
  const rows = await prisma.takeoffPlanTextRead.findMany({ where: { planId, kind: SURE_FLOOR_PLAN }, select: { pageNumber: true, value: true }, orderBy: { pageNumber: "asc" } });
  return rows.filter((row) => (row.value as { sure?: unknown } | null)?.sure === true).map((row) => row.pageNumber);
}

/** Each page the inventory read: whether it is a sure floor plan, the words that said so, and the sheet number it read. */
export async function sureFloorPlanReads(planId: string): Promise<Map<number, { sure: boolean; caption: string | null; sheetNumber: string | null }>> {
  const rows = await prisma.takeoffPlanTextRead.findMany({ where: { planId, kind: SURE_FLOOR_PLAN }, select: { pageNumber: true, value: true } });
  return new Map(
    rows.map((row) => {
      const v = (row.value ?? {}) as { sure?: unknown; caption?: unknown; sheetNumber?: unknown };
      return [row.pageNumber, { sure: v.sure === true, caption: typeof v.caption === "string" ? v.caption : null, sheetNumber: typeof v.sheetNumber === "string" ? v.sheetNumber : null }];
    }),
  );
}

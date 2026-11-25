import { prisma, type Prisma } from "@prova/db";

/**
 * ── A PRICED LINE WHOSE WALLS ARE GONE (Diego's order (e), A2-A4; coordination/silent-estimate-sync.md) ──
 *
 * A sync never retires a line a person priced by hand: it takes it to 0, linked, with its price (`syncTakeoffItemLines`).
 * Two readers follow from that, both derived on every render and never stored:
 *
 * - `zeroedPricedLines`: what the takeoff and estimate screens say, whichever of the ~20 syncing actions (or a background
 *   job with no screen at all) did it.
 * - `GC_LINE_WHERE`: what a GC is shown. A takeoff line at 0 is the sub's own bookkeeping, and "0 lin ft" on a signing
 *   page reads as a mistake. A line TYPED at 0 (an allowance) has no takeoff item and is still shown.
 */
export const GC_LINE_WHERE = { isDeleted: false, NOT: { takeoffItemId: { not: null }, quantity: 0 } } satisfies Prisma.JobLineItemWhereInput;

export function gcLines(jobId: string) {
  return prisma.jobLineItem.findMany({ where: { jobId, ...GC_LINE_WHERE }, orderBy: { createdAt: "asc" } });
}

export async function zeroedPricedLines(jobId: string): Promise<{ id: string; description: string; unitPrice: string | null }[]> {
  const rows = await prisma.jobLineItem.findMany({
    where: { jobId, isDeleted: false, takeoffItemId: { not: null }, quantity: 0, sourceCatalogEntry: { is: null }, OR: [{ unitPrice: { not: null } }, { budgetedUnitCost: { not: null } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, unitPrice: true },
  });
  return rows.map((r) => ({ id: r.id, description: r.description, unitPrice: r.unitPrice?.toString() ?? null }));
}

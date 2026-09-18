import { prisma } from "@prova/db";
import type { EmrRecord } from "@/lib/emr";

/** Every mod rate the company has recorded, as the page and the Ask tool both
 * read them — one loader, so the two cannot disagree about which rows exist.
 * Scoped by `companyId` in the `where`, so the scope cannot be dropped in a
 * later edit without deleting the predicate that finds the rows. */
export async function loadExperienceModRates(companyId: string): Promise<EmrRecord[]> {
  const rows = await prisma.experienceModRate.findMany({
    where: { companyId },
    orderBy: { effectiveDate: "desc" },
    select: {
      id: true,
      effectiveDate: true,
      rate: true,
      source: true,
      sourceUrl: true,
      note: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    rate: row.rate.toString(),
    source: row.source,
    sourceUrl: row.sourceUrl,
    note: row.note,
  }));
}

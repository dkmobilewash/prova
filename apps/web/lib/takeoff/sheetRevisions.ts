import { prisma } from "@prova/db";
import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { effectiveSheetNumber } from "@/lib/plan-ingest/sheetIndex";

/** A sheet number as two issues of it may print it: "A-101", "A101" and "a 101" are one sheet. */
export const sameSheetKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9.]/g, "");

/** Each page's sheet number: the sheet index's, else the label somebody typed. */
export async function sheetNumbersOf(planId: string, companyId: string): Promise<Map<number, string>> {
  const [rows, pages] = await Promise.all([
    sheetIndexFor(planId, companyId),
    prisma.takeoffPlanPage.findMany({ where: { planId }, select: { pageNumber: true, label: true } }),
  ]);
  const out = new Map<number, string>();
  for (const p of pages) if (p.label?.trim()) out.set(p.pageNumber, p.label.trim());
  for (const r of rows) {
    const n = effectiveSheetNumber(r);
    if (n) out.set(r.pageNumber, n);
  }
  return out;
}

export type EarlierVersion = { planId: string; pageNumber: number; sheetNumber: string; label: string };

/**
 * For each page of `planId`, the same sheet in the newest EARLIER plan file on
 * the job that has it — the version a revision or addendum replaced.
 */
export async function earlierVersionsFor(jobId: string, companyId: string, planId: string): Promise<Record<number, EarlierVersion>> {
  const plans = await prisma.takeoffPlan.findMany({
    where: { jobId, companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, fileName: true, revisionLabel: true },
  });
  const at = plans.findIndex((p) => p.id === planId);
  if (at < 0 || at === plans.length - 1) return {};
  const mine = await sheetNumbersOf(planId, companyId);
  const wanted = new Map([...mine].map(([page, n]) => [sameSheetKey(n), page]));
  const out: Record<number, EarlierVersion> = {};
  for (const older of plans.slice(at + 1)) {
    if (Object.keys(out).length === wanted.size) break;
    for (const [pageNumber, n] of await sheetNumbersOf(older.id, companyId)) {
      const page = wanted.get(sameSheetKey(n));
      if (page === undefined || out[page]) continue;
      out[page] = { planId: older.id, pageNumber, sheetNumber: n, label: older.revisionLabel ?? older.fileName ?? older.createdAt.toISOString().slice(0, 10) };
    }
  }
  return out;
}

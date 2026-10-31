import { prisma } from "@prova/db";
import { installedDayText, isInstallable, type InstallLine } from "@/lib/installed-quantities";

/** Each job's lines that can take a quantity, with what has been installed so
 * far. Tenant scoping is the caller's: it has already proved the jobs are its. */
export async function loadInstallLines(jobIds: readonly string[]): Promise<Map<string, InstallLine[]>> {
  const [lines, totals] = await Promise.all([
    prisma.jobLineItem.findMany({
      where: { jobId: { in: [...jobIds] }, isDeleted: false },
      orderBy: { sortOrder: "asc" },
      select: { id: true, jobId: true, description: true, unit: true, quantity: true, costCategory: true },
    }),
    prisma.dailyReportInstalledQuantity.groupBy({
      by: ["lineItemId"],
      where: { lineItem: { jobId: { in: [...jobIds] } } },
      _sum: { quantity: true },
    }),
  ]);
  const out = new Map<string, InstallLine[]>();
  for (const line of lines) {
    const quantity = Number(line.quantity);
    if (!isInstallable({ unit: line.unit, quantity, costCategory: line.costCategory })) continue;
    const installedToDate = Number(totals.find((row) => row.lineItemId === line.id)?._sum.quantity ?? 0);
    const row = { id: line.id, description: line.description ?? "", unit: line.unit ?? "", quantity, installedToDate };
    out.set(line.jobId, [...(out.get(line.jobId) ?? []), row]);
  }
  return out;
}

/** Goes in a report query's `include` or `select`. */
export const INSTALLED_ON_REPORT = {
  select: { lineItemId: true, quantity: true, lineItem: { select: { description: true, unit: true } } },
} as const;

/** A report's quantities as the row and the edit form want them. */
export function installedForRow(
  rows: readonly { lineItemId: string; quantity: unknown; lineItem: { description: string | null; unit: string | null } }[],
) {
  return {
    installed: Object.fromEntries(rows.map((row) => [row.lineItemId, Number(row.quantity)])),
    installedLine:
      rows.length > 0
        ? installedDayText(
            rows.map((row) => ({ quantity: Number(row.quantity), unit: row.lineItem.unit, description: row.lineItem.description ?? "" })),
          )
        : null,
  };
}

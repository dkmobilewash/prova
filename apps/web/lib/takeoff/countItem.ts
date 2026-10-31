import { prisma } from "@prova/db";
import { nextItemColor } from "./itemColors";

const MAX_ITEMS = 500;

/**
 * The COUNT item a named count belongs to: the one already called that on this
 * job, or a new one. This is what turns a name typed at a count into a row on
 * the Items list, and it is why two sheets of one name are one count. Null at
 * the job's item ceiling, where the count stays Unassigned rather than failing.
 */
export async function countItemFor(companyId: string, jobId: string, name: string): Promise<string | null> {
  const existing = await prisma.takeoffItem.findMany({
    where: { jobId },
    select: { id: true, name: true, type: true, colorHex: true, sortOrder: true },
    orderBy: { sortOrder: "desc" },
  });
  const same = existing.find((item) => item.type === "COUNT" && item.name === name);
  if (same) return same.id;
  if (existing.length >= MAX_ITEMS) return null;
  const item = await prisma.takeoffItem.create({
    data: { companyId, jobId, name, type: "COUNT", colorHex: nextItemColor(existing.map((i) => i.colorHex)), sortOrder: (existing[0]?.sortOrder ?? -1) + 1 },
    select: { id: true },
  });
  return item.id;
}

import { prisma } from "@prova/db";
import {
  daysFromToday,
  lienDeadlineState,
  servedAfterDueDate,
  sortLienDeadlines,
  type LienDeadlineState,
} from "@/lib/lien-deadlines";

/**
 * Lien deadlines, read once for both the page and the Ask tool, so the two
 * cannot disagree about what is overdue. Every state on a row is DERIVED
 * here against the `today` the caller passes; nothing is read from a
 * stored flag, because there is none.
 */

export type LoadedLienDeadline = {
  id: string;
  jobId: string;
  jobName: string;
  kind: string;
  otherLabel: string | null;
  dueOn: string;
  servedOn: string | null;
  recipient: string | null;
  note: string | null;
  state: LienDeadlineState;
  daysUntilDue: number | null;
  servedAfterDueDate: boolean;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);

export async function loadLienDeadlines(
  companyId: string,
  todayIso: string,
  jobIds?: string[],
): Promise<LoadedLienDeadline[]> {
  const rows = await prisma.lienDeadline.findMany({
    where: { companyId, ...(jobIds ? { jobId: { in: jobIds } } : {}) },
    orderBy: { dueOn: "asc" },
    select: {
      id: true,
      jobId: true,
      kind: true,
      otherLabel: true,
      dueOn: true,
      servedOn: true,
      recipient: true,
      note: true,
      job: { select: { name: true } },
    },
  });

  const shaped = rows.map((row) => {
    const plain = { dueOn: iso(row.dueOn), servedOn: row.servedOn ? iso(row.servedOn) : null };
    return {
      id: row.id,
      jobId: row.jobId,
      jobName: row.job.name,
      kind: row.kind as string,
      otherLabel: row.otherLabel,
      ...plain,
      recipient: row.recipient,
      note: row.note,
      state: lienDeadlineState(plain, todayIso),
      daysUntilDue: plain.servedOn ? null : daysFromToday(plain.dueOn, todayIso),
      servedAfterDueDate: servedAfterDueDate(plain),
    };
  });

  return sortLienDeadlines(shaped, todayIso);
}

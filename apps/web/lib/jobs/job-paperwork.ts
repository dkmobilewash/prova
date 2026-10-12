import { prisma } from "@prova/db";
import { canReach, type Principal } from "@/lib/permissions";
import { RFI_WAITING_DAYS } from "@/components/rfiLabels";
import { addDays } from "@/components/fieldReportWeeks";

/**
 * The job's own records that live on company-wide list pages — RFIs,
 * submittals, punch list, drawings, material orders — as links from the job
 * Overview, each pre-filtered to this job with `?job=`. Every one of those
 * pages already filters on it (checked 2026-10-10: each validates the id
 * against the company's jobs and narrows its query); nothing on the job
 * linked to them, so "answer the RFI on Oak Ave" meant leaving the job.
 *
 * Each count is what the linked list shows by default, so the number on
 * the link is the number of rows you land on: RFIs hide CLOSED and the
 * punch list hides VERIFIED unless asked.
 */
export type JobPaperworkCounts = {
  openRfis: number;
  /** Sent, no due date, unanswered a week or more (isWaitingAWeekPlus). */
  waitingRfis?: number;
  submittals: number;
  openPunchItems: number;
  drawingSets: number;
  materialOrders: number;
  /** Read by the layout's own lien-waiver row, which is gated on billing. */
  lienWaivers: number;
};

export type JobPaperworkLink = { href: string; label: string; detail: string };

export function jobPaperworkLinks(
  principal: Principal,
  jobId: string,
  counts: JobPaperworkCounts,
): JobPaperworkLink[] {
  const job = encodeURIComponent(jobId);
  const all: (JobPaperworkLink & { route: string })[] = [
    {
      route: "/rfis",
      label: "RFIs",
      detail: counts.waitingRfis ? `${counts.openRfis} open · ${counts.waitingRfis} waiting a week+` : `${counts.openRfis} open`,
    },
    { route: "/submittals", label: "Submittals", detail: String(counts.submittals) },
    { route: "/punch-lists", label: "Punch list", detail: `${counts.openPunchItems} open` },
    {
      route: "/drawings",
      label: "Drawings",
      detail: `${counts.drawingSets} ${counts.drawingSets === 1 ? "set" : "sets"}`,
    },
    { route: "/material-orders", label: "Material orders", detail: String(counts.materialOrders) },
  ].map((link) => ({ ...link, href: `${link.route}?job=${job}` }));
  // Only doors this viewer can open — the pages re-check for themselves.
  return all
    .filter((link) => canReach(principal, link.route))
    .map(({ href, label, detail }) => ({ href, label, detail }));
}

/** `todayIso`: the VIEWER'S calendar day (viewerToday()), what "a week" is counted back from. */
export async function loadJobPaperworkCounts(companyId: string, jobId: string, todayIso: string): Promise<JobPaperworkCounts> {
  const where = { companyId, jobId };
  const weekAgo = new Date(`${addDays(todayIso, -RFI_WAITING_DAYS)}T00:00:00.000Z`);
  const [openRfis, waitingRfis, submittals, openPunchItems, drawingSets, materialOrders, lienWaivers] = await Promise.all([
    prisma.rfi.count({ where: { ...where, status: { not: "CLOSED" } } }),
    prisma.rfi.count({ where: { ...where, status: "SENT", dueBy: null, sentOn: { lte: weekAgo } } }),
    prisma.submittal.count({ where }),
    prisma.punchListItem.count({ where: { ...where, status: { not: "VERIFIED" } } }),
    prisma.drawingSet.count({ where }),
    prisma.materialOrder.count({ where }),
    prisma.lienWaiver.count({ where }),
  ]);
  return { openRfis, waitingRfis, submittals, openPunchItems, drawingSets, materialOrders, lienWaivers };
}

import { prisma } from "@prova/db";
import { canReach, type Principal } from "@/lib/permissions";

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
  submittals: number;
  openPunchItems: number;
  drawingSets: number;
  materialOrders: number;
};

export type JobPaperworkLink = { href: string; label: string; detail: string };

export function jobPaperworkLinks(
  principal: Principal,
  jobId: string,
  counts: JobPaperworkCounts,
): JobPaperworkLink[] {
  const job = encodeURIComponent(jobId);
  const all: (JobPaperworkLink & { route: string })[] = [
    { route: "/rfis", label: "RFIs", detail: `${counts.openRfis} open` },
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

export async function loadJobPaperworkCounts(companyId: string, jobId: string): Promise<JobPaperworkCounts> {
  const where = { companyId, jobId };
  const [openRfis, submittals, openPunchItems, drawingSets, materialOrders] = await Promise.all([
    prisma.rfi.count({ where: { ...where, status: { not: "CLOSED" } } }),
    prisma.submittal.count({ where }),
    prisma.punchListItem.count({ where: { ...where, status: { not: "VERIFIED" } } }),
    prisma.drawingSet.count({ where }),
    prisma.materialOrder.count({ where }),
  ]);
  return { openRfis, submittals, openPunchItems, drawingSets, materialOrders };
}

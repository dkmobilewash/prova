import { prisma } from "@prova/db";
import type { JobMediaCardData } from "@/components/JobMediaCard";
import {
  formatByteSize,
  formatCapturedAt,
  formatCapturedAtInputValue,
  jobMediaClockWarning,
} from "@/lib/job-media";

/**
 * Reading site capture for a gallery, in the shape the card wants.
 *
 * The fetch half of the split lib/job-media.ts is the pure half of — the
 * same arrangement as compliance-expiry.ts/renewals.ts and
 * permissions.ts/authz.ts. Everything decided here is decided by a pure
 * function that a test can call without a database.
 *
 * Both galleries go through this so they cannot drift: the job page and
 * `/photos` render the same card from the same projection, differing only
 * in whether the job name is shown (on a job page it is the page).
 */

export type JobMediaScope = {
  companyId: string;
  jobId?: string;
  withJobName?: boolean;
  /** Caps the gallery. The job page shows a dozen and links to the rest;
   * `/photos` is the full read and passes nothing. */
  take?: number;
};

export async function loadJobMedia(
  scope: JobMediaScope,
  timeZone: string,
): Promise<JobMediaCardData[]> {
  const rows = await prisma.jobMedia.findMany({
    where: {
      companyId: scope.companyId,
      ...(scope.jobId ? { jobId: scope.jobId } : {}),
    },
    ...(scope.take ? { take: scope.take } : {}),
    // Newest first, by when the picture was TAKEN rather than when it
    // arrived — a crew uploading Friday's photos on Monday should see them
    // in the order they happened, which is the order they walked the site.
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    include: { capturedBy: true, job: scope.withJobName ? true : false },
  });

  return rows.map((row) => ({
    id: row.id,
    blobUrl: row.blobUrl,
    contentType: row.contentType,
    caption: row.caption,
    capturedAtLabel: formatCapturedAt(row.capturedAt, timeZone),
    capturedAtInputValue: formatCapturedAtInputValue(row.capturedAt, timeZone),
    sizeLabel: formatByteSize(row.byteSize),
    capturedByName: row.capturedBy?.name ?? null,
    clockWarning: jobMediaClockWarning(row.capturedAt, row.createdAt),
    ...(scope.withJobName && "job" in row && row.job ? { jobName: row.job.name } : {}),
  }));
}

/** How many this job has in total, for the "showing 12 of 47" line. A
 * separate count rather than `rows.length`, because the list is capped and
 * its length would then be the cap rather than the truth. */
export function countJobMedia(companyId: string, jobId: string): Promise<number> {
  return prisma.jobMedia.count({ where: { companyId, jobId } });
}

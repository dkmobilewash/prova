import { prisma } from "@prova/db";
import type { GettingStartedCounts } from "./getting-started";

/**
 * The counts behind the getting-started checklist, for ONE company.
 *
 * Every query is a `count` filtered by `companyId` — never a `findMany`,
 * because the checklist needs "is there any", not the rows, and never
 * unscoped, because a count of another company's jobs would tick a new
 * company's boxes. getting-started-counts.test.ts runs this against fakes
 * that honour the where clause across two companies to hold that line.
 *
 * Nine small counts on every dashboard render, in parallel. They run for
 * as long as the card is showing; the page skips this entirely once the
 * card has been hidden.
 */
export async function loadGettingStartedCounts(companyId: string): Promise<GettingStartedCounts> {
  const [
    jobs,
    users,
    pendingInvites,
    crewMembers,
    scheduleDays,
    fieldReports,
    jobMedia,
    quickBooksConnections,
  ] = await Promise.all([
    prisma.job.count({ where: { companyId } }),
    prisma.user.count({ where: { companyId } }),
    prisma.invite.count({ where: { companyId } }),
    prisma.crewMember.count({ where: { companyId, archivedAt: null } }),
    prisma.crewScheduleDay.count({ where: { companyId } }),
    prisma.dailyFieldReport.count({ where: { companyId } }),
    prisma.jobMedia.count({ where: { companyId } }),
    prisma.quickBooksConnection.count({ where: { companyId } }),
  ]);

  return {
    jobs,
    users,
    pendingInvites,
    crewMembers,
    scheduleDays,
    fieldReports,
    jobMedia,
    quickBooksConnections,
  };
}

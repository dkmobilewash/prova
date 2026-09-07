import { prisma } from "@prova/db";
import { certifiedPayrollWeekWindow } from "@/lib/certified-payroll-week";

/**
 * Fetching for the certified-payroll page.
 *
 * This module fetches; lib/certified-payroll.ts rolls up and
 * lib/certified-payroll-week.ts decides which days are in the week. Same
 * split as prevailing-wage-query.ts/prevailing-wage.ts, and for the same
 * reason: the deciding half is where the bugs live and it has to be
 * testable without a database. The one that lived here — an eight-day
 * window that certified every Sunday on two consecutive filings — was
 * only findable by reading, because a window inline in an async server
 * component cannot be imported by a test.
 */

/** One job-week's time entries, scoped to the company that owns the job.
 *
 * `companyId` is not optional and is not decoration. `reviewJobWeek` in
 * prevailing-wage-query.ts scopes the same way; an unscoped time-entry
 * query sitting in lib/ under a name that reads like a scoped one is how
 * a cross-tenant read gets written by the next caller who trusts the
 * name. Returns [] for a job that is not this company's.
 */
export async function loadCertifiedPayrollWeekEntries(
  companyId: string,
  jobId: string,
  weekStart: Date,
) {
  const { gte, lte } = certifiedPayrollWeekWindow(weekStart);
  return prisma.timeEntry.findMany({
    where: { jobId, job: { companyId }, date: { gte, lte } },
    include: { employeeUser: true, craftClassification: { include: { unionLocal: true } } },
    orderBy: { date: "asc" },
  });
}

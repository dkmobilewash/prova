import { prisma } from "@prova/db";

/**
 * ── THE PILOT DASHBOARD'S FIGURES: ONE ROW PER CUSTOMER COMPANY ──
 *
 * The second page in the app that reads ACROSS companies, after /internal/usage,
 * and gated the same way (`app/(app)/internal/pilots/page.tsx`). Read-only: every
 * figure is counted from rows the product already writes, on every load.
 *
 * WHAT EACH FIGURE IS, NAMED FOR WHAT IS STORED, NOT FOR WHAT WAS ASKED:
 *   - jobs, plan sets: rows, never the sample job (`Job.isSample`) or its plan.
 *   - sheets taken off: distinct sheets with walls the finder put on the job.
 *   - walls typed by a person: posted runs whose label a person's Set type or the
 *     review queue's Enter/Accept wrote ("… (set by hand)"). There is no log of
 *     queue presses, so this is runs typed, not presses.
 *   - auto-posted: runs the auto-post rule typed ("… (auto, from …)").
 *   - upload to sent bid: per job, the first plan set to the first signing link
 *     (`SignatureRequest`) made after it; the median over the jobs that have both.
 *   - problem reports: "Report a problem" mails (`OutboundMessage`, HELP_REQUEST,
 *     subject "Problem report — …"). Help questions are not counted.
 *   - errors, 7 days: what the database records failing for that company: a plan
 *     page whose reading stopped on an error, and an email that FAILED or BOUNCED.
 *     Browser errors reach us only inside problem reports.
 *   - last activity: the newest of its people's last sign-in, a job, a plan set.
 * Prova's own operating companies are left out.
 */
export type PilotRow = {
  companyId: string;
  name: string;
  createdAt: Date;
  jobs: number;
  planSets: number;
  sheetsTakenOff: number;
  wallsTypedByPerson: number;
  autoPosted: number;
  /** Median hours from first upload to first signing link, over `bidsSent` jobs; null when none. */
  uploadToBidHours: number | null;
  bidsSent: number;
  problemReports: number;
  problemReports7d: number;
  planReadErrors7d: number;
  emailErrors7d: number;
  lastActivity: Date | null;
};

export const WINDOW_DAYS = 7;
const SET_BY_HAND = "% (set by hand)";
const AUTO = "%(auto, from %";
const PROBLEM_SUBJECT = "Problem report — %";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** "3 h", "2.5 d", "—": the upload-to-bid time at a glance. */
export function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}

type CountRow = { companyId: string; n: bigint | number };
const counts = (rows: CountRow[]) => new Map(rows.map((r) => [r.companyId, Number(r.n)]));

export async function loadPilotMetrics(now: Date = new Date()): Promise<PilotRow[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const companies = await prisma.company.findMany({ where: { isProvaOperator: false }, select: { id: true, name: true, createdAt: true } });
  if (companies.length === 0) return [];

  const [jobs, plans, sheets, typed, auto, bids, reports, reports7d, planErrors, emailErrors, seen, lastJob, lastPlan] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`SELECT "companyId", COUNT(*) AS n FROM "Job" WHERE NOT "isSample" GROUP BY "companyId"`,
    prisma.$queryRaw<CountRow[]>`SELECT p."companyId", COUNT(*) AS n FROM "TakeoffPlan" p JOIN "Job" j ON j.id = p."jobId" WHERE NOT j."isSample" GROUP BY p."companyId"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT p."companyId", COUNT(DISTINCT m."pageId") AS n
      FROM "TakeoffMeasurement" m JOIN "TakeoffPlanPage" pg ON pg.id = m."pageId" JOIN "TakeoffPlan" p ON p.id = pg."planId" JOIN "Job" j ON j.id = p."jobId"
      WHERE m.source = 'DETECTED' AND m.kind = 'LINEAR' AND NOT j."isSample" GROUP BY p."companyId"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT p."companyId", COUNT(*) AS n
      FROM "TakeoffMeasurement" m JOIN "TakeoffPlanPage" pg ON pg.id = m."pageId" JOIN "TakeoffPlan" p ON p.id = pg."planId" JOIN "Job" j ON j.id = p."jobId"
      WHERE m.label LIKE ${SET_BY_HAND} AND NOT j."isSample" GROUP BY p."companyId"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT p."companyId", COUNT(*) AS n
      FROM "TakeoffMeasurement" m JOIN "TakeoffPlanPage" pg ON pg.id = m."pageId" JOIN "TakeoffPlan" p ON p.id = pg."planId" JOIN "Job" j ON j.id = p."jobId"
      WHERE m.label LIKE ${AUTO} AND NOT j."isSample" GROUP BY p."companyId"`,
    prisma.$queryRaw<{ companyId: string; hours: number }[]>`
      SELECT j."companyId", EXTRACT(EPOCH FROM (s.first_sent - u.first_upload)) / 3600.0 AS hours
      FROM "Job" j
      JOIN (SELECT "jobId", MIN("createdAt") AS first_upload FROM "TakeoffPlan" GROUP BY "jobId") u ON u."jobId" = j.id
      JOIN LATERAL (SELECT MIN(sr."createdAt") AS first_sent FROM "SignatureRequest" sr WHERE sr."jobId" = j.id AND sr."createdAt" >= u.first_upload) s ON s.first_sent IS NOT NULL
      WHERE NOT j."isSample"`,
    prisma.$queryRaw<CountRow[]>`SELECT "companyId", COUNT(*) AS n FROM "OutboundMessage" WHERE "relatedType" = 'HELP_REQUEST' AND subject LIKE ${PROBLEM_SUBJECT} GROUP BY "companyId"`,
    prisma.$queryRaw<CountRow[]>`SELECT "companyId", COUNT(*) AS n FROM "OutboundMessage" WHERE "relatedType" = 'HELP_REQUEST' AND subject LIKE ${PROBLEM_SUBJECT} AND "createdAt" >= ${since} GROUP BY "companyId"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT ij."companyId", COUNT(*) AS n FROM "PlanIngestTask" t JOIN "PlanIngestJob" ij ON ij.id = t."jobId"
      WHERE t.error IS NOT NULL AND t."updatedAt" >= ${since} GROUP BY ij."companyId"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT om."companyId", COUNT(DISTINCT om.id) AS n FROM "OutboundMessageEvent" e JOIN "OutboundMessage" om ON om.id = e."messageId"
      WHERE e.type IN ('FAILED', 'BOUNCED') AND e."occurredAt" >= ${since} GROUP BY om."companyId"`,
    prisma.user.groupBy({ by: ["companyId"], _max: { lastSeenAt: true } }),
    prisma.job.groupBy({ by: ["companyId"], where: { isSample: false }, _max: { createdAt: true } }),
    prisma.takeoffPlan.groupBy({ by: ["companyId"], where: { job: { isSample: false } }, _max: { createdAt: true } }),
  ]);

  const jobsBy = counts(jobs), plansBy = counts(plans), sheetsBy = counts(sheets), typedBy = counts(typed), autoBy = counts(auto);
  const reportsBy = counts(reports), reports7dBy = counts(reports7d), planErrorsBy = counts(planErrors), emailErrorsBy = counts(emailErrors);
  const hoursBy = new Map<string, number[]>();
  for (const b of bids) hoursBy.set(b.companyId, [...(hoursBy.get(b.companyId) ?? []), Number(b.hours)]);
  const newest = (...dates: (Date | null | undefined)[]) => dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
  const maxOf = <T extends { companyId: string; _max: Record<string, Date | null> }>(rows: T[], key: string) => new Map(rows.map((r) => [r.companyId, r._max[key] ?? null]));
  const seenBy = maxOf(seen, "lastSeenAt"), jobAt = maxOf(lastJob, "createdAt"), planAt = maxOf(lastPlan, "createdAt");

  return companies
    .map((c) => {
      const hours = hoursBy.get(c.id) ?? [];
      return {
        companyId: c.id,
        name: c.name,
        createdAt: c.createdAt,
        jobs: jobsBy.get(c.id) ?? 0,
        planSets: plansBy.get(c.id) ?? 0,
        sheetsTakenOff: sheetsBy.get(c.id) ?? 0,
        wallsTypedByPerson: typedBy.get(c.id) ?? 0,
        autoPosted: autoBy.get(c.id) ?? 0,
        uploadToBidHours: median(hours),
        bidsSent: hours.length,
        problemReports: reportsBy.get(c.id) ?? 0,
        problemReports7d: reports7dBy.get(c.id) ?? 0,
        planReadErrors7d: planErrorsBy.get(c.id) ?? 0,
        emailErrors7d: emailErrorsBy.get(c.id) ?? 0,
        lastActivity: newest(seenBy.get(c.id), jobAt.get(c.id), planAt.get(c.id)),
      };
    })
    .sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0) || a.name.localeCompare(b.name));
}

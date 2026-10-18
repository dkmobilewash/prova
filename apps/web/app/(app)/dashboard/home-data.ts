import { prisma } from "@prova/db";
import { scheduledWorkerName } from "@/lib/crew-schedule-query";

/**
 * The reads the home page needs on top of lib/today-dashboard.ts, every one
 * scoped to the company. Each is skipped (resolves empty) for a viewer who
 * would not be shown its answer, so nothing reaches the page that the page
 * then has to remember to hide.
 *
 * Nothing here is stored or invented: overdue RFIs are SENT with a dueBy
 * before today (components/rfiLabels.ts's rule), unapproved hours are signed
 * days with no approval and no reopen, crews are today's CrewScheduleDay rows
 * (the PLAN — the job roster is not today's crew; see crew-schedule.prisma),
 * and the month's money is a sum of Invoice and Payment rows.
 */
export async function loadHomeExtras(
  companyId: string,
  todayIso: string,
  wants: { rfis: boolean; signoffs: boolean; money: boolean },
) {
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const monthStart = new Date(`${todayIso.slice(0, 7)}-01T00:00:00.000Z`);
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  // Backcharges near their objection deadline: the same rows
  // lib/alerts-query.ts reads for BACKCHARGE_RESPONSE (RECEIVED, with a
  // deadline), bounded to 14 days out here; which ones show is decided by
  // components/home/home-logic.ts's backchargeNeeds via daysToRespond.
  const backchargeHorizon = new Date(today);
  backchargeHorizon.setUTCDate(backchargeHorizon.getUTCDate() + 14);

  const [rfis, signoffs, billed, collected, schedule, backcharges] = await Promise.all([
    wants.rfis
      ? prisma.rfi.findMany({
          where: { companyId, status: "SENT", dueBy: { lt: today } },
          select: { id: true, number: true, subject: true, dueBy: true, jobId: true, job: { select: { name: true } } },
          orderBy: { dueBy: "asc" },
          take: 20,
        })
      : [],
    wants.signoffs
      ? prisma.timesheetSignoff.findMany({
          where: { companyId, approvedAt: null, reopenedAt: null },
          select: { id: true, date: true, jobId: true, job: { select: { name: true } } },
          orderBy: { date: "desc" },
          take: 20,
        })
      : [],
    wants.money
      ? prisma.invoice.aggregate({
          where: { job: { companyId }, issuedAt: { gte: monthStart, lt: nextMonth } },
          _sum: { amount: true },
        })
      : null,
    wants.money
      ? prisma.payment.aggregate({
          where: { invoice: { job: { companyId } }, receivedAt: { gte: monthStart, lt: nextMonth } },
          _sum: { amount: true },
        })
      : null,
    prisma.crewScheduleDay.findMany({
      where: { companyId, workDate: today },
      select: {
        jobId: true,
        job: { select: { name: true } },
        scheduledUser: { select: { name: true, email: true } },
        crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
      },
      orderBy: { jobId: "asc" },
    }),
    // Billing-gated like the alert it mirrors (BACKCHARGE_RESPONSE ->
    // MANAGE_BILLING in lib/alerts.ts).
    wants.money
      ? prisma.backcharge.findMany({
          where: { companyId, status: "RECEIVED", respondByDate: { not: null, lte: backchargeHorizon } },
          select: { id: true, number: true, status: true, respondByDate: true, job: { select: { name: true } } },
          orderBy: { respondByDate: "asc" },
          take: 20,
        })
      : [],
  ]);

  // One row per job, the way a foreman says it: who is where.
  const crewByJob = new Map<string, { jobId: string; jobName: string; people: string[] }>();
  for (const day of Array.isArray(schedule) ? schedule : []) {
    const row = crewByJob.get(day.jobId) ?? { jobId: day.jobId, jobName: day.job.name, people: [] };
    row.people.push(scheduledWorkerName(day));
    crewByJob.set(day.jobId, row);
  }

  return {
    overdueRfis: (Array.isArray(rfis) ? rfis : []).map((rfi) => ({
      id: rfi.id,
      number: rfi.number,
      subject: rfi.subject,
      jobId: rfi.jobId,
      jobName: rfi.job.name,
      daysLate: rfi.dueBy ? Math.round((today.getTime() - rfi.dueBy.getTime()) / 86_400_000) : 0,
    })),
    unapprovedDays: (Array.isArray(signoffs) ? signoffs : []).map((s) => ({
      id: s.id,
      date: s.date.toISOString().slice(0, 10),
      jobId: s.jobId,
      jobName: s.job.name,
    })),
    billedThisMonth: Number(billed?._sum?.amount ?? 0),
    collectedThisMonth: Number(collected?._sum?.amount ?? 0),
    crewsToday: [...crewByJob.values()],
    backcharges: backcharges.map((bc) => ({
      id: bc.id,
      number: bc.number,
      jobName: bc.job.name,
      status: bc.status as string,
      respondByDate: bc.respondByDate ? bc.respondByDate.toISOString().slice(0, 10) : null,
    })),
  };
}

export type HomeExtras = Awaited<ReturnType<typeof loadHomeExtras>>;

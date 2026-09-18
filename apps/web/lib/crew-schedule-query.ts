import { prisma } from "@prova/db";
import { crewMemberName, payrollWorkerName } from "@/lib/worker-name";
import { plannedWithNoHours, type PlannedDay } from "@/lib/crew-schedule";

/**
 * Reads for the crew schedule, every one scoped to a company.
 *
 * Scoped the way `certified-payroll-query.ts` and `prevailing-wage-query.ts`
 * are, and for the reason that file states: an unscoped query sitting in
 * lib/ under a name that reads like a scoped one is how a cross-tenant read
 * gets written by the next caller who trusts the name.
 */

/** How far ahead the schedule shows. Two weeks is the horizon a foreman
 * actually plans to; beyond that it is a guess nobody will maintain. */
export const SCHEDULE_HORIZON_DAYS = 14;

/** How far back to look for planned days nobody logged hours against.
 * Matches the certified-payroll window, because that is the deadline the
 * answer is usually needed for. */
export const MISSING_HOURS_LOOKBACK_DAYS = 56;

function utcDay(iso: string, offsetDays = 0): Date {
  return new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + offsetDays * 86_400_000);
}

/** The worker's name, whichever kind of worker the row names. Built here so
 * the page and the Ask tool cannot label the same row differently. */
export function scheduledWorkerName(row: {
  scheduledUser: { name: string | null; email: string } | null;
  crewMember: { legalFirstName: string; legalMiddleName: string | null; legalLastName: string } | null;
}): string {
  if (row.scheduledUser) return payrollWorkerName(row.scheduledUser).label;
  if (row.crewMember) return crewMemberName(row.crewMember).label;
  return "Unnamed worker";
}

const dayShape = {
  id: true,
  workDate: true,
  note: true,
  jobId: true,
  scheduledUserId: true,
  crewMemberId: true,
  job: { select: { name: true } },
  scheduledUser: { select: { name: true, email: true } },
  crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
  craftClassification: { select: { name: true } },
} as const;

/** Planned days from `today` forward, for the whole company or one job. */
export async function loadUpcomingSchedule(companyId: string, today: string, jobId?: string) {
  return prisma.crewScheduleDay.findMany({
    where: {
      companyId,
      ...(jobId ? { jobId } : {}),
      workDate: { gte: utcDay(today), lte: utcDay(today, SCHEDULE_HORIZON_DAYS) },
    },
    select: dayShape,
    orderBy: [{ workDate: "asc" }, { jobId: "asc" }],
  });
}

/**
 * Planned days in the recent past that nobody logged an hour against.
 *
 * The hours are fetched for the SAME window and the SAME jobs and the set
 * difference is taken in `plannedWithNoHours`, in memory and with no
 * database in it, so the matching rule is unit-testable. Doing it as a SQL
 * NOT EXISTS would work and would put the one piece of logic worth testing
 * somewhere no test can reach it.
 *
 * `lte: yesterday` rather than `lt: today` for the same reason `isPastDay`
 * exists: hours for today are logged at the end of today, and flagging this
 * morning's plan would cry wolf every morning.
 */
export async function loadPlannedDaysMissingHours(companyId: string, today: string, jobId?: string) {
  const from = utcDay(today, -MISSING_HOURS_LOOKBACK_DAYS);
  const to = utcDay(today, -1);

  const planned = await prisma.crewScheduleDay.findMany({
    where: { companyId, ...(jobId ? { jobId } : {}), workDate: { gte: from, lte: to } },
    select: dayShape,
    orderBy: [{ workDate: "desc" }],
  });
  if (planned.length === 0) return [];

  // Scoped through the job to the same company, and bounded to the days and
  // jobs actually planned — not every hour in the window.
  const logged = await prisma.timeEntry.findMany({
    where: {
      job: { companyId },
      jobId: { in: [...new Set(planned.map((day) => day.jobId))] },
      date: { gte: from, lte: to },
    },
    select: { jobId: true, date: true, employeeUserId: true, crewMemberId: true },
  });

  return plannedWithNoHours(planned as (typeof planned[number] & PlannedDay)[], logged);
}

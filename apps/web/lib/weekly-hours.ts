import { weekDates, weekStart } from "@/components/fieldReportWeeks";
import { timeEntryWorkerId, timeEntryWorkerName } from "@/lib/worker-name";

/**
 * One week of logged hours, totalled by person, by day and by job.
 *
 * Pure and derived on every read — nothing here is stored. The week is
 * MONDAY to Sunday (`fieldReportWeeks.weekStart`), a planning week. It is
 * deliberately NOT the certified-payroll week (Sunday-start,
 * lib/certified-payroll-week.ts): this screen answers "did everyone get
 * their 40", not what was filed.
 */

export type HoursEntry = {
  /** "YYYY-MM-DD" — TimeEntry.date is stored at UTC midnight. */
  date: string;
  hours: number;
  personId: string;
  personName: string;
  jobId: string;
  jobName: string;
};

export type WeeklyHours = {
  /** Monday through Sunday, ISO. */
  days: string[];
  people: { id: string; name: string; dayHours: number[]; totalHours: number }[];
  jobs: { id: string; name: string; totalHours: number }[];
  dayHours: number[];
  totalHours: number;
};

/** A time entry row as Prisma returns it, in the shape the totals read. The
 * person label is the crew tab's: a login's name or email, else the crew
 * member's legal name. */
export function toHoursEntry(
  entry: {
    date: Date;
    hours: unknown;
    employeeUserId: string | null;
    crewMemberId: string | null;
    employeeUser: { name: string | null; email: string } | null;
    crewMember: { legalFirstName: string; legalMiddleName: string | null; legalLastName: string } | null;
  },
  job: { id: string; name: string },
): HoursEntry {
  return {
    date: entry.date.toISOString().slice(0, 10),
    hours: Number(entry.hours),
    personId: timeEntryWorkerId(entry),
    personName: entry.employeeUser
      ? entry.employeeUser.name ?? entry.employeeUser.email
      : timeEntryWorkerName(entry).label,
    jobId: job.id,
    jobName: job.name,
  };
}

/** The Monday a `?week=` value names, or the week containing today when it
 * is missing or not a real calendar date. Any day of a week names that week. */
export function hoursWeekStart(param: string | undefined, todayIso: string): string {
  const ms = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? Date.parse(`${param}T00:00:00.000Z`) : NaN;
  // The round trip refuses 2026-02-31, which Date would roll into March.
  const valid = !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === param;
  return weekStart(valid ? param! : todayIso);
}

export function weeklyHours(entries: HoursEntry[], weekStartIso: string): WeeklyHours {
  const days = weekDates(weekStartIso);
  const people = new Map<string, WeeklyHours["people"][number]>();
  const jobs = new Map<string, WeeklyHours["jobs"][number]>();
  const dayHours = days.map(() => 0);
  let totalHours = 0;
  for (const e of entries) {
    const i = days.indexOf(e.date);
    if (i < 0) continue;
    const person = people.get(e.personId) ?? { id: e.personId, name: e.personName, dayHours: days.map(() => 0), totalHours: 0 };
    person.dayHours[i] += e.hours;
    person.totalHours += e.hours;
    people.set(e.personId, person);
    const job = jobs.get(e.jobId) ?? { id: e.jobId, name: e.jobName, totalHours: 0 };
    job.totalHours += e.hours;
    jobs.set(e.jobId, job);
    dayHours[i] += e.hours;
    totalHours += e.hours;
  }
  return {
    days,
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    jobs: [...jobs.values()].sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name)),
    dayHours,
    totalHours,
  };
}

/** The crew tab's two time-entry lists: the entries IN the week the table
 * above them totals, and every other one (the history, capped by SeeAll).
 * An entry dated after that week — a typo'd future date — is history, not
 * "this week", so the list under the table always matches the table. */
export function splitThisWeek<T extends { date: Date }>(entries: T[], weekStartIso: string): { thisWeek: T[]; earlier: T[] } {
  const days = new Set(weekDates(weekStartIso));
  const thisWeek: T[] = [];
  const earlier: T[] = [];
  for (const e of entries) (days.has(e.date.toISOString().slice(0, 10)) ? thisWeek : earlier).push(e);
  return { thisWeek, earlier };
}

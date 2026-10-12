import { addDays, dayLabel, isWeekend, weekStart } from "@/components/fieldReportWeeks";

/**
 * The crew schedule's derived state — the part with no database in it.
 *
 * TWO QUESTIONS, ONE MODEL, and the second one is the reason this file
 * exists rather than everything living in a query:
 *
 *   - who is PLANNED on a job on a day. That is the table, read back.
 *   - whose hours have not been turned in. That is NOT a column — it is a
 *     planned day with no TimeEntry against it, derived every time it is
 *     asked. `CrewScheduleDay` deliberately has no `attended` flag, for the
 *     reason this schema applies everywhere: a stored flag can disagree
 *     with what it was derived from, and here the disagreement would BE
 *     the answer.
 *
 * WHAT A MISSING TIMECARD IS AND IS NOT. A planned day with no hours means
 * nobody logged hours for a day somebody planned. It does NOT mean the
 * person did not work, and it does not mean they did. The distinction
 * matters because the wrong version of this puts an accusation in
 * somebody's mouth: "Marco did not work Tuesday" is a claim about a man,
 * and "nobody logged Marco's Tuesday" is a claim about paperwork. Only the
 * second is true, and every label in here is written as the second.
 */

/** UTC midnight, so a day is a calendar day rather than an instant — the
 * same coercion `reportDateFromString` does, and for the same reason: the
 * unique key on (job, worker, date) has to mean "one plan per day". */
export class CrewScheduleInputError extends Error {}

export function workDateFromString(raw: unknown): Date {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new CrewScheduleInputError("A date is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CrewScheduleInputError("That date is not valid");
  const date = new Date(`${value}T00:00:00.000Z`);
  // THE ROUND TRIP IS THE CHECK, not the NaN test. `2026-02-30` parses
  // without complaint to 2 March, so a typo in the day planned somebody for
  // a day nobody chose. Formatting back and comparing catches every
  // rollover; `emrEffectiveDate` in lib/emr.ts does the same.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new CrewScheduleInputError("That date does not exist — check the day and month");
  }
  return date;
}

/**
 * Which worker a row names, as one comparable key.
 *
 * A scheduled day names a User OR a CrewMember, never both and never
 * neither — the CHECK in the migration enforces it. Everything downstream
 * wants one key, and building it in one place is what stops a join being
 * written as `userId === userId` somewhere and silently never matching a
 * crew member's row.
 */
export function workerKey(row: { scheduledUserId?: string | null; crewMemberId?: string | null }): string {
  if (row.scheduledUserId) return `user:${row.scheduledUserId}`;
  if (row.crewMemberId) return `crew:${row.crewMemberId}`;
  // Unreachable while the CHECK holds. Not thrown: a schedule page that
  // 500s because one row is malformed is worse than one row reading oddly,
  // and the key is only ever used for matching.
  return "unknown";
}

/** The same key, from a TimeEntry — which uses different column names for
 * the identical pair. Separate function rather than a shared shape, because
 * the two tables genuinely name these columns differently and pretending
 * otherwise is how a mapping goes wrong silently. */
export function timeEntryWorkerKey(entry: {
  employeeUserId?: string | null;
  crewMemberId?: string | null;
}): string {
  if (entry.employeeUserId) return `user:${entry.employeeUserId}`;
  if (entry.crewMemberId) return `crew:${entry.crewMemberId}`;
  return "unknown";
}

/** A day, as the string a plan and an hour are compared on. Both are stored
 * at UTC midnight, so this is exact rather than a tolerance. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type PlannedDay = {
  jobId: string;
  workDate: Date;
  scheduledUserId: string | null;
  crewMemberId: string | null;
};

export type LoggedHour = {
  jobId: string;
  date: Date;
  employeeUserId: string | null;
  crewMemberId: string | null;
};

/**
 * Planned days that nobody logged an hour against.
 *
 * THE MATCH IS ON JOB AND WORKER AND DAY, all three. Dropping the job would
 * let hours logged on a different job silently satisfy a plan, which is the
 * failure that matters most: a man moved to another site is exactly the
 * case somebody is looking for when they ask whose hours are missing, and
 * matching on worker and date alone would hide it.
 *
 * Returns the planned days, not names — the caller has the rows and the
 * labels. This stays a set operation so it can be tested with four objects
 * and no database.
 */
export function plannedWithNoHours<T extends PlannedDay>(planned: readonly T[], logged: readonly LoggedHour[]): T[] {
  const worked = new Set(
    logged.map((hour) => `${hour.jobId}::${timeEntryWorkerKey(hour)}::${dayKey(hour.date)}`),
  );
  return planned.filter(
    (day) => !worked.has(`${day.jobId}::${workerKey(day)}::${dayKey(day.workDate)}`),
  );
}

/**
 * Whether a planned day is far enough past that missing hours are worth
 * raising.
 *
 * TODAY IS NOT LATE, AND NEITHER IS TOMORROW. A schedule is a forward
 * statement; hours for today are logged at the end of today, and a page
 * that flags this morning's plan as a missing timecard would cry wolf every
 * morning until people stopped reading it. Only days strictly BEFORE today
 * can be missing anything.
 */
export function isPastDay(workDate: Date, today: string): boolean {
  return dayKey(workDate) < today;
}

/* ------------------------------------------------- the week board + bulk add */

/**
 * The Monday of the week `/schedule?week=` asks for, or of the week holding
 * `today` when it asks for nothing usable. Any day of a week names that week,
 * so a link with a Wednesday in it still opens on Monday.
 *
 * `today` is the VIEWER'S day (viewerToday), not the server's: on a Sunday
 * evening in Los Angeles the UTC date is already Monday, which is how a day
 * planned for today went missing from the old two-week list (ux medium-B #12).
 */
export function resolveWeekStart(raw: string | undefined | null, today: string): string {
  try {
    return weekStart(dayKey(workDateFromString(raw)));
  } catch {
    return weekStart(today);
  }
}

/** The longest range one bulk add will write. Two months is a long phase; a
 * year is a typo in the end date, and it would be 260 rows per person. */
export const MAX_RANGE_DAYS = 62;

/**
 * Every day a bulk add covers, as YYYY-MM-DD.
 *
 * `skipWeekends` only thins a RANGE. One day picked on its own is a day
 * somebody chose, Saturday or not — weekend work is normal in this trade.
 */
export function scheduleDays(start: string, end: string, skipWeekends: boolean): string[] {
  if (end < start) throw new CrewScheduleInputError("The end date is before the start date");
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (days.length >= MAX_RANGE_DAYS) {
      throw new CrewScheduleInputError(`Pick a range of ${MAX_RANGE_DAYS} days or less`);
    }
    days.push(day);
  }
  return days.length > 1 && skipWeekends ? days.filter((day) => !isWeekend(day)) : days;
}

/** Jobs the schedule form offers. A COMPLETE job has nobody left to send, and
 * the old picker defaulted to one (ux medium-B #10). An unknown status stays,
 * so a status the schema gains later is not silently unschedulable. */
export function schedulableJobs<T extends { status: string | null }>(jobs: readonly T[]): T[] {
  return jobs.filter((job) => job.status !== "COMPLETE");
}

/**
 * Enter in a form field submits the form — including from a `<select>` a
 * person has just picked from, which saved a whole default row twice in one
 * test session (ux medium-B #8). Only the submit button submits; a textarea
 * keeps its newline.
 */
export function blocksImplicitSubmit(key: string, tagName: string): boolean {
  return key === "Enter" && tagName !== "BUTTON" && tagName !== "TEXTAREA";
}

/**
 * The sentence a save hands back: who, where, when, how many rows were new,
 * and — a warning, not a refusal — anyone now on two jobs the same day.
 * Double-booking is allowed (half a day on each is real); not being told is
 * the defect (ux medium-B #9).
 */
export function scheduleSavedMessage(input: {
  workers: string[];
  jobName: string;
  days: string[];
  created: number;
  clashes: { worker: string; jobName: string; day: string }[];
}): string {
  const { workers, jobName, days, created, clashes } = input;
  const who = workers.length === 1 ? workers[0] : `${workers.length} people`;
  const when =
    days.length === 1 ? dayLabel(days[0]) : `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}`;
  const total = workers.length * days.length;
  const existing = total - created;

  let message =
    created === 0
      ? `${who} already on ${jobName}, ${when} — nothing new to save.`
      : `${who} on ${jobName}, ${when} — saved` +
        (total > 1 ? ` (${created} added${existing > 0 ? `, ${existing} already there` : ""})` : "") +
        ".";

  const shown = clashes.slice(0, 3).map((c) => `${c.worker} is also on ${c.jobName} ${dayLabel(c.day)}`);
  if (clashes.length > 3) shown.push(`${clashes.length - 3} more`);
  if (shown.length > 0) message += ` Double-booked: ${shown.join("; ")}.`;
  return message;
}

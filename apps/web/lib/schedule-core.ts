import { prisma } from "@prova/db";

/**
 * Who is planned on this job, and whether the hours ever arrived.
 *
 * `CrewScheduleDay` deliberately has no `attended` column — the schema
 * says so at length, and the reasoning is this module's whole job:
 * whether somebody worked a planned day is DERIVED by asking whether a
 * time entry exists for that job, that worker and that date. A planned
 * day with no hours against it IS the missing timecard, and a boolean
 * somebody forgot to tick would manufacture one.
 *
 * So the phone gets the plan and the gap in the same list: tomorrow's
 * crew, and yesterday's planned-but-never-logged.
 */

export type ScheduleRow = {
  id: string;
  workDate: string;
  /** The worker, however they are recorded — a user with a login or a
   * crew member without one. One name, because on site they are just a
   * person. */
  workerName: string;
  /** Which of the two this is, for anything that needs to tell them
   * apart later (a link to their timecard, say). */
  workerKind: "user" | "crew";
  workerId: string;
  craftLabel: string | null;
  /** Hours exist for this worker, this job, this day. Derived on read —
   * never stored.
   *
   * NULL FOR TODAY AS WELL AS FOR THE FUTURE, and the reason is the
   * whole point of the field: the question "was this day worked without
   * a timecard" can only be asked about a day that is OVER. At 18:03 a
   * foreman has not filed today's hours yet, and telling him "no hours
   * logged" is an accusation about a shift he is still working. Only
   * `date < today` is a fact. */
  hoursLogged: boolean | null;
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * @param from inclusive, `YYYY-MM-DD`
 * @param to   inclusive, `YYYY-MM-DD`
 * @param today the caller's day, so "is this in the future" is decided
 *        once rather than per row — and so a test can fix it.
 */
export async function listScheduleForJob(
  jobId: string,
  from: string,
  to: string,
  today: string,
): Promise<ScheduleRow[]> {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  const [days, entries] = await Promise.all([
    prisma.crewScheduleDay.findMany({
      where: { jobId, workDate: { gte: start, lte: end } },
      orderBy: [{ workDate: "asc" }],
      include: {
        scheduledUser: { select: { id: true, name: true, email: true } },
        crewMember: { select: { id: true, legalFirstName: true, legalLastName: true } },
        craftClassification: { select: { name: true } },
      },
    }),
    // One query for the whole window rather than one per row: a fortnight
    // of a ten-person crew is 140 rows, and 140 round trips on a phone
    // connection is the difference between a screen and a wait.
    prisma.timeEntry.findMany({
      where: { jobId, date: { gte: start, lte: end } },
      select: { date: true, employeeUserId: true, crewMemberId: true },
    }),
  ]);

  const logged = new Set(
    entries.map((entry) => `${dayKey(entry.date)}|${entry.employeeUserId ?? entry.crewMemberId ?? ""}`),
  );

  return days.map((day) => {
    const workerId = day.scheduledUserId ?? day.crewMemberId ?? "";
    const date = dayKey(day.workDate);
    const name = day.scheduledUser
      ? (day.scheduledUser.name ?? day.scheduledUser.email)
      : day.crewMember
        ? `${day.crewMember.legalFirstName} ${day.crewMember.legalLastName}`
        : "Unknown";

    return {
      id: day.id,
      workDate: date,
      workerName: name,
      workerKind: day.scheduledUserId ? "user" : "crew",
      workerId,
      craftLabel: day.craftClassification?.name ?? null,
      hoursLogged: date >= today ? null : logged.has(`${date}|${workerId}`),
    };
  });
}

/** The fortnight a phone shows by default: yesterday back a week for the
 * gaps, and a week forward for the plan. Past days are what make this
 * screen more than a calendar. */
export function defaultScheduleWindow(today: string): { from: string; to: string } {
  const day = new Date(`${today}T00:00:00.000Z`);
  const shift = (days: number) => {
    const moved = new Date(day);
    moved.setUTCDate(moved.getUTCDate() + days);
    return moved.toISOString().slice(0, 10);
  };
  return { from: shift(-7), to: shift(7) };
}

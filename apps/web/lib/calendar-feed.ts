import { prisma } from "@prova/db";
import { scheduledWorkerName } from "@/lib/crew-schedule-query";
import type { CrewCalendarEvent } from "@/lib/ics";

/**
 * What the calendar feed serves, and why its scope is what it is.
 *
 * THE SCOPE MIRRORS /schedule EXACTLY. That page (and its board) shows
 * every signed-in member of a company the WHOLE company's CrewScheduleDay
 * rows — there is no per-person filtering on it, deliberately: a foreman
 * plans against the whole week, and "who else is on that job Tuesday" is
 * the question the board exists to answer. So the feed a member's token
 * serves is the company schedule, the same rows with the same fields
 * (job, day, worker names, craft, note) plus the job's site address for
 * the calendar's location line. It never reaches into another company,
 * and everything is read through the token row's companyId.
 *
 * THE WINDOW is 14 days back to 14 days forward. Forward mirrors the
 * board's own SCHEDULE_HORIZON_DAYS. Backward exists because a
 * subscribed calendar DELETES events that leave the feed — without a
 * trailing window, yesterday's crew day would vanish from everyone's
 * phone at midnight. Those trailing rows are the same rows every member
 * saw on the page while they were upcoming (and the page itself still
 * surfaces recent past days in its missing-hours list), so the window
 * changes presentation, not access.
 */

export const CALENDAR_FEED_PAST_DAYS = 14;
export const CALENDAR_FEED_FUTURE_DAYS = 14;

function utcDay(iso: string, offsetDays = 0): Date {
  return new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + offsetDays * 86_400_000);
}

export type CalendarScheduleRow = {
  workDate: Date;
  note: string | null;
  jobId: string;
  job: { name: string; siteAddress: string | null };
  scheduledUser: { name: string | null; email: string } | null;
  crewMember: { legalFirstName: string; legalMiddleName: string | null; legalLastName: string } | null;
  craftClassification: { name: string } | null;
  updatedAt: Date;
};

/** The feed's rows: the company's planned days in the window, the same
 * model and scoping /schedule reads. */
export async function loadCalendarSchedule(companyId: string, today: string): Promise<CalendarScheduleRow[]> {
  return prisma.crewScheduleDay.findMany({
    where: {
      companyId,
      workDate: { gte: utcDay(today, -CALENDAR_FEED_PAST_DAYS), lte: utcDay(today, CALENDAR_FEED_FUTURE_DAYS) },
    },
    select: {
      workDate: true,
      note: true,
      jobId: true,
      job: { select: { name: true, siteAddress: true } },
      scheduledUser: { select: { name: true, email: true } },
      crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
      craftClassification: { select: { name: true } },
      updatedAt: true,
    },
    orderBy: [{ workDate: "asc" }, { jobId: "asc" }],
  });
}

/**
 * Rows -> events, one per (job, day) — a day with three people on a job
 * is ONE calendar entry naming three people, not three entries, because
 * that is how a person reads a day. Pure, so the grouping, the summary
 * wording and the UID stability are unit-tested without a database.
 */
export function crewScheduleEvents(rows: CalendarScheduleRow[]): CrewCalendarEvent[] {
  const byKey = new Map<string, CalendarScheduleRow[]>();
  for (const row of rows) {
    const day = row.workDate.toISOString().slice(0, 10);
    const key = `${row.jobId}|${day}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  const events: CrewCalendarEvent[] = [];
  for (const [key, bucket] of byKey) {
    const day = key.slice(key.indexOf("|") + 1);
    const jobId = key.slice(0, key.indexOf("|"));
    const workers = bucket.map((row) => {
      const name = scheduledWorkerName(row);
      const craft = row.craftClassification?.name;
      return craft ? `${name} (${craft})` : name;
    });
    const notes = bucket
      .map((row) => {
        if (!row.note) return null;
        return `${scheduledWorkerName(row)}: ${row.note}`;
      })
      .filter((line): line is string => line !== null);
    const newest = bucket.reduce((max, row) => (row.updatedAt > max ? row.updatedAt : max), bucket[0].updatedAt);

    events.push({
      // Job id + day: nothing that changes when the crew or a note does,
      // so an edit REPLACES the subscriber's event instead of duplicating
      // it. The domain suffix makes the UID globally unique per RFC 5545.
      uid: `crew-${jobId}-${day.replace(/-/g, "")}@cstream.ai`,
      date: day,
      summary: `${bucket[0].job.name} — ${workers.join(", ")}`,
      location: bucket[0].job.siteAddress,
      description: notes.length > 0 ? notes.join("\n") : null,
      updatedAt: newest,
    });
  }

  // Deterministic output order: by day, then job name — a stable body
  // means unchanged data produces byte-identical responses between polls.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.summary.localeCompare(b.summary)));
  return events;
}

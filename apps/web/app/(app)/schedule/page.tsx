import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { formatCalendarDate } from "@/lib/render-date";
import { can } from "@/lib/permissions";
import { serverToday } from "@/lib/serverToday";
import {
  loadPlannedDaysMissingHours,
  loadUpcomingSchedule,
  scheduledWorkerName,
} from "@/lib/crew-schedule-query";
import { CrewScheduleBoard, type ScheduleDay } from "@/components/CrewScheduleBoard";
import { CalendarSubscribe } from "@/components/CalendarSubscribe";
import { toJobOption } from "@/components/jobLabels";

function formatDate(date: Date) {
  return formatCalendarDate(date);
}

/** The two shapes the board renders, built here so the page and the Ask
 * tool cannot label the same row differently — `scheduledWorkerName` is the
 * one place a worker's name is decided. */
function toDay(row: Awaited<ReturnType<typeof loadUpcomingSchedule>>[number]): ScheduleDay {
  return {
    id: row.id,
    workDate: row.workDate.toISOString().slice(0, 10),
    jobId: row.jobId,
    jobName: row.job.name,
    worker: scheduledWorkerName(row),
    craft: row.craftClassification?.name ?? null,
    note: row.note,
  };
}

export default async function SchedulePage() {
  const { company, ...user } = await requireCompanyContext();
  const today = serverToday();
  const canWrite = can(user, "MANAGE_FIELD");

  const [scheduled, unscheduled, upcoming, missing, people, crew, crafts, feedToken] = await Promise.all([
    prisma.job.findMany({
      where: { companyId: company.id, startDate: { not: null } },
      orderBy: { startDate: "asc" },
      include: { contact: true, assignments: { include: { user: true } } },
    }),
    prisma.job.findMany({
      where: { companyId: company.id, startDate: null },
      orderBy: { createdAt: "desc" },
      include: { contact: true },
    }),
    loadUpcomingSchedule(company.id, today),
    loadPlannedDaysMissingHours(company.id, today),
    prisma.user.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    // Archived crew members are left out: somebody off the books should not
    // be offered for next Tuesday.
    prisma.crewMember.findMany({
      where: { companyId: company.id, archivedAt: null },
      select: { id: true, legalFirstName: true, legalLastName: true },
      orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
    }),
    prisma.craftClassification.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // This viewer's own calendar-feed token, if they've made one. The
    // token string going to this person's browser is by design — it is
    // THEIR credential, shown so they can paste it into a calendar app.
    prisma.calendarFeedToken.findUnique({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
      select: { token: true },
    }),
  ]);

  // One control, two kinds of worker. The prefix is what the action splits
  // on, and it re-reads the row through this company rather than trusting
  // which kind the browser said it was.
  const workers = [
    ...people.map((person) => ({ value: `user:${person.id}`, label: person.name ?? person.email })),
    ...crew.map((member) => ({
      value: `crew:${member.id}`,
      label: `${member.legalFirstName} ${member.legalLastName}`,
    })),
  ];

  // Nothing at all, rather than nothing scheduled. The page's only previous
  // empty state said "No jobs scheduled yet", which on a new account reads
  // as though the scheduling is the missing step when the job is.
  if (scheduled.length === 0 && unscheduled.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold text-ink">Schedule</h1>
        <EmptyState
          data-tour="schedule-no-jobs"
          title="No jobs yet, so there is nothing to lay out"
          purpose={
            <p>
              Who is where, and when. Every job goes on one list in start-date order, and each day
              shows which of your people are on which job — so you see the week two jobs want the
              same crew before it happens, not the morning of. Nothing is scheduled for you; a job
              starts here without a date and moves up once you give it one.
            </p>
          }
          actions={[{ label: "Create a job", href: "/jobs/new" }, { label: "Add your crew", href: "/team" }]}
          sources={
            <p>
              Jobs come from Jobs &amp; Estimates (or an import); the people you can put on a day
              come from Team.
            </p>
          }
          example={{
            rows: [
              { title: "Mon, Sep 15", detail: "Smith kitchen remodel — Mike, Luis · Oak Ave addition — Dan", meta: "3 on site" },
              { title: "Tue, Sep 16", detail: "Smith kitchen remodel — Mike, Luis, Dan", meta: "3 on site" },
              { title: "Oak Ave addition", tag: "Starts Sep 22", detail: "Framing, then drywall", meta: "6 weeks" },
            ],
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-ink">Schedule</h1>

      {/* The crew board goes FIRST. This page's own empty state has always
          promised "you can see the week a second job wants the same three
          hangers as the first" — and until there was a per-day schedule it
          could not, because JobAssignment carries no date. The job list
          below is the start-date view and stays exactly as it was. */}
      <CrewScheduleBoard
        upcoming={upcoming.map(toDay)}
        missingHours={missing.map(toDay)}
        jobs={[...scheduled, ...unscheduled].map(toJobOption)}
        workers={workers}
        crafts={crafts}
        canWrite={canWrite && workers.length > 0 && scheduled.length + unscheduled.length > 0}
      />

      {/* Below the board, above the start-date list: the feed serves what
          the board shows, so its control lives next to it. */}
      <CalendarSubscribe token={feedToken?.token ?? null} />

      <section className="mb-10" data-tour="schedule-start-dates">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Job start dates</h2>
        {scheduled.length === 0 ? (
          <p className="text-ink-body">
            Nothing has a start date yet. Open a job below and set one in its Schedule section — until
            then it stays under Unscheduled and appears on no week.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {scheduled.map((job) => (
              <li key={job.id} className="p-4">
                {/* Stacks below sm: a nowrap date range beside a name
                    column left ~140px for the name at 375px. Same
                    max-sm pattern as the field rows (#89). */}
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ink">{job.name}</p>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-sm text-ink-body">{job.contact.name}</p>
                    {job.assignments.length > 0 && (
                      <p className="mt-1 text-xs text-ink-muted">
                        Crew: {job.assignments.map((a) => a.user.name ?? a.user.email).join(", ")}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-ink-label sm:whitespace-nowrap">
                    {formatDate(job.startDate!)}
                    {job.endDate ? ` – ${formatDate(job.endDate)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ALWAYS RENDERED once there is a job, where it used to disappear
          when empty. "Every job has a start date" is the thing you came to
          check, and a section that vanishes when its answer is "none" is
          one you cannot use to confirm it. */}
      <section data-tour="schedule-unscheduled">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Unscheduled</h2>
        {unscheduled.length === 0 ? (
          <p className="text-ink-body">Every job has a start date.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-line-card bg-surface">
            {unscheduled.map((job) => (
              <li key={job.id} className="p-4">
                {/* Name + status pill + GC name forced onto one ~295px
                    line was the audit's phone finding; stack below sm. */}
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink">{job.name}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-sm text-ink-body">{job.contact.name}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

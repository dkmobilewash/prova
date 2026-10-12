import Link from "next/link";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCompanyContext } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
import { formatHours } from "@/lib/render-hours";
import { formatCalendarDay } from "@/lib/render-date";
import { addDays, weekStart } from "@/components/fieldReportWeeks";
import { hoursWeekStart, toHoursEntry, weeklyHours } from "@/lib/weekly-hours";
import { WeeklyHoursTable } from "@/components/WeeklyHoursTable";
import { EmptyState } from "@/components/EmptyState";

export const metadata = { title: "Hours" };

export const dynamic = "force-dynamic";

/**
 * Everyone's hours for one week, across every job — the Friday question
 * "did everyone get their 40". Read-only: hours are logged and corrected on
 * each job's Crew & time tab, which this links back to.
 */
export default async function HoursPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { company } = await requireCompanyContext();
  const today = await viewerToday();
  const start = hoursWeekStart((await searchParams).week, today);
  const end = addDays(start, 6);

  const entries = await prisma.timeEntry.findMany({
    where: {
      job: { companyId: company.id },
      date: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T00:00:00.000Z`) },
    },
    select: {
      date: true,
      hours: true,
      employeeUserId: true,
      crewMemberId: true,
      employeeUser: { select: { name: true, email: true } },
      crewMember: { select: { legalFirstName: true, legalMiddleName: true, legalLastName: true } },
      job: { select: { id: true, name: true } },
    },
  });
  const week = weeklyHours(entries.map((entry) => toHoursEntry(entry, entry.job)), start);
  const isThisWeek = start === weekStart(today);
  const range = `${formatCalendarDay(start, "dayMonth")} – ${formatCalendarDay(end)}`;

  const navClass =
    "inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-rail-hover hover:text-ink";

  return (
    <PageShell width="working">
      <h1 className="mb-2 text-xl font-semibold text-ink">Hours</h1>
      <p className="mb-4 text-sm text-ink-body">
        Everyone&rsquo;s hours for the week, across every job. Hours are logged and corrected on each job&rsquo;s
        Crew &amp; time tab.
      </p>

      <nav data-tour="hours-week" aria-label="Week" className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={`/hours?week=${addDays(start, -7)}`} className={navClass}>
          ← Previous week
        </Link>
        <span className="px-2 text-sm font-medium text-ink">
          {isThisWeek ? "This week" : "Week of"} · {range}
        </span>
        <Link href={`/hours?week=${addDays(start, 7)}`} className={navClass}>
          Next week →
        </Link>
        {!isThisWeek && (
          <Link href="/hours" className={navClass}>
            This week
          </Link>
        )}
      </nav>

      {week.people.length === 0 ? (
        <EmptyState
          data-tour="hours-empty"
          title="No hours logged this week"
          purpose="Hours appear here as the crew logs them on the phone, or as you add them on a job's Crew & time tab."
          actions={[{ label: "Open jobs", href: "/jobs" }]}
        />
      ) : (
        <>
          <div data-tour="hours-grid">
            <WeeklyHoursTable week={week} caption={`Hours by person and day, ${range}`} />
          </div>

          <h2 className="mb-2 mt-8 text-base font-semibold text-ink">By job</h2>
          <ul data-tour="hours-by-job" className="divide-y divide-line-row rounded-lg border border-line-card bg-surface text-sm">
            {week.jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <Link href={`/jobs/${job.id}/crew`} className="min-w-0 truncate text-link hover:underline">
                  {job.name}
                </Link>
                <span className="shrink-0 tabular-nums text-ink">
                  {formatHours(job.totalHours)} hrs
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}

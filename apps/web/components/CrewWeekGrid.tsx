import Link from "next/link";
import type { ScheduleDay } from "@/components/CrewScheduleBoard";
import { addDays, dayLabel, weekDates, weekLabel } from "@/components/fieldReportWeeks";

/**
 * Who is on which job, Monday to Sunday — the answer to "where's my week"
 * without reading a row per person per day (ux full-C C1, medium-B #2).
 *
 * Jobs down the side, days across, names in the cells: a sub asks "who is
 * on Lakeview this week" far more often than "where is Hector", and a job
 * row stays one row however many people are on it. Sunday is a column
 * because weekend work is normal in this trade and a plan nobody can see is
 * worse than a narrow column.
 *
 * No client code: the week comes from the URL, so prev/next are plain
 * links and the page is the same on a refresh or a shared link.
 */
export function CrewWeekGrid({
  days,
  week,
  today,
  basePath,
}: {
  days: ScheduleDay[];
  /** Monday, YYYY-MM-DD. */
  week: string;
  /** The viewer's day, YYYY-MM-DD — its column is highlighted. */
  today: string;
  /** Where the prev/next links point, e.g. "/schedule". */
  basePath: string;
}) {
  const dates = weekDates(week);
  const jobs = new Map<string, { name: string; byDate: Map<string, ScheduleDay[]> }>();
  for (const day of days) {
    const job = jobs.get(day.jobId) ?? { name: day.jobName, byDate: new Map() };
    jobs.set(day.jobId, job);
    const cell = job.byDate.get(day.workDate) ?? [];
    cell.push(day);
    job.byDate.set(day.workDate, cell);
  }
  const rows = [...jobs.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const link = "inline-flex min-h-11 items-center rounded-md px-2 text-sm text-link hover:underline";

  return (
    <section className="mb-6" aria-label="Week board" data-testid="crew-week-grid">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Week of {weekLabel(week)}</h3>
        <nav className="flex items-center gap-1" aria-label="Change week">
          <Link href={`${basePath}?week=${addDays(week, -7)}`} className={link}>
            ← Previous
          </Link>
          <Link href={basePath} className={link}>
            This week
          </Link>
          <Link href={`${basePath}?week=${addDays(week, 7)}`} className={link}>
            Next →
          </Link>
        </nav>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
          Nobody is on the schedule the week of {weekLabel(week)}.
        </p>
      ) : (
        // Scrolls inside its own box on a phone, so the page itself never
        // pans sideways (schedule.mobile.spec.ts).
        <div className="overflow-x-auto rounded-lg border border-line-card bg-surface">
          <table className="w-full min-w-[48rem] table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-row">
                <th scope="col" className="w-40 px-3 py-2 text-left font-semibold text-ink-label">
                  Job
                </th>
                {dates.map((date) => (
                  <th
                    key={date}
                    scope="col"
                    aria-current={date === today ? "date" : undefined}
                    className={`px-2 py-2 text-left font-semibold ${
                      date === today ? "bg-tag-brand-soft text-tag-brand-soft-ink" : "text-ink-label"
                    }`}
                  >
                    {dayLabel(date)}
                    {date === today && <span className="block text-xs font-normal">Today</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([jobId, job]) => (
                <tr key={jobId} className="border-b border-line-row last:border-b-0 align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    <Link href={`/jobs/${jobId}`} className="break-words hover:text-link hover:underline">
                      {job.name}
                    </Link>
                  </th>
                  {dates.map((date) => (
                    <td key={date} className={`px-2 py-2 ${date === today ? "bg-rail-hover" : ""}`}>
                      {(job.byDate.get(date) ?? []).map((day) => (
                        <p key={day.id} className="break-words text-ink" title={day.note ?? undefined}>
                          {day.worker}
                          {day.craft && <span className="block text-xs text-ink-muted">{day.craft}</span>}
                        </p>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

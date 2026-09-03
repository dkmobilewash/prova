import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { FieldReportComposer } from "@/components/FieldReportComposer";
import { FieldReportEntry } from "@/components/FieldReportEntry";
import { WeekSummary } from "@/components/WeekSummary";
import {
  type ReportData,
  addDays,
  dayLabel,
  groupIntoWeeks,
  weekLabel,
  weekSummaryText,
} from "@/components/fieldReportWeeks";

export const dynamic = "force-dynamic";

/** How many reports this page renders. The query asks for one more, so the
 * page can tell a full history from a cut-off one. */
const REPORT_LIMIT = 400;

/**
 * Every job's daily reports in one place, by week.
 *
 * The job page already carries a job's own reports, and it still does —
 * nothing moved. What it cannot do is the two things this page exists for:
 * file today's report without walking through a job page first, and see a
 * whole week across every job at once, which is the unit a schedule dispute
 * is actually argued in.
 */
export default async function FieldReportsPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  const [rows, jobs] = await Promise.all([
    prisma.dailyFieldReport.findMany({
      where: { companyId: company.id },
      include: {
        job: { select: { id: true, name: true } },
        filedBy: { select: { name: true, email: true } },
      },
      orderBy: { reportDate: "desc" },
      // One more than we render, purely so the page can TELL whether it
      // was truncated. Without that it grouped a cut-off set into weeks
      // and named real filed reports as days nobody filed — see knownFrom
      // below.
      take: REPORT_LIMIT + 1,
    }),
    prisma.job.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Dates are stored and rendered at UTC midnight, so "today" for deciding
  // which days are over is the UTC date. The USER'S calendar date is only
  // used for form defaults — see components/localToday.ts.
  const today = new Date().toISOString().slice(0, 10);

  const truncated = rows.length > REPORT_LIMIT;
  const shownRows = truncated ? rows.slice(0, REPORT_LIMIT) : rows;

  const reports: ReportData[] = shownRows.map((row) => ({
    id: row.id,
    jobId: row.job.id,
    jobName: row.job.name,
    reportDate: row.reportDate.toISOString().slice(0, 10),
    crewPresent: row.crewPresent,
    workPerformed: row.workPerformed,
    weather: row.weather,
    delays: row.delays,
    filedByName: row.filedBy?.name ?? row.filedBy?.email ?? null,
  }));

  // The earliest date this page's records are COMPLETE from.
  //
  // Ordered newest first, so everything after the oldest loaded date is
  // certainly here — but that date itself may have had more reports cut
  // off mid-day, so completeness starts the day AFTER it. Undefined when
  // nothing was truncated, which is the only case where an absent report
  // is evidence that none was filed.
  const oldestLoaded = reports[reports.length - 1]?.reportDate;
  const knownFrom = truncated && oldestLoaded ? addDays(oldestLoaded, 1) : undefined;

  const weeks = groupIntoWeeks(reports, today, knownFrom);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Field reports</h1>
      <p className="mb-6 text-sm text-slate-400">
        What happened on site, one entry per job per day. Grouped by week, because a week is
        what a schedule dispute gets argued over — and a week with a day missing from it is
        worth less than one that says which day is missing. Each job&apos;s own reports also
        stay on{" "}
        <Link href="/dashboard" className="text-blue-400 hover:text-blue-300">
          its job page
        </Link>
        .
      </p>

      <div className="mb-8">
        <FieldReportComposer jobs={jobs} />
      </div>

      {weeks.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-slate-300">Nothing filed yet.</p>
          <p className="mt-2 text-sm text-slate-400">
            One entry a day: who was on site, what got done, the weather, and anything that
            cost time. The weather and delay fields are the ones a claim is argued from
            months later, when nobody remembers whether it rained.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {weeks.map((week) => {
            // One summary per job in the week — a GC gets the week for
            // their project, not for every project we ran that week.
            const jobsInWeek = [...new Map(week.reports.map((r) => [r.jobId, r.jobName]))];

            return (
              <section key={week.start}>
                <header className="mb-3 border-b border-slate-800 pb-2">
                  <h2 className="font-semibold text-slate-100">{weekLabel(week.start)}</h2>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span>
                      {week.reports.length} {week.reports.length === 1 ? "report" : "reports"}
                    </span>
                    {week.coveragePercent !== null && (
                      <span>{week.coveragePercent}% of finished weekdays covered</span>
                    )}
                    {week.delayDays.length > 0 && (
                      <span className="text-amber-400">
                        {week.delayDays.length}{" "}
                        {week.delayDays.length === 1 ? "day" : "days"} with delays
                      </span>
                    )}
                  </p>

                  {week.missing.length > 0 && (
                    <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
                      Nothing filed on any job for {week.missing.map(dayLabel).join(" · ")}.
                      Days still to come aren&apos;t counted, and neither is today — only days
                      that are over and unrecorded.
                    </p>
                  )}

                  {/* The oldest week on a truncated page is cut off partway
                      through. Before this said so, its unloaded days were
                      grouped as days nobody filed — reports that exist, on
                      the page a schedule dispute gets argued from. */}
                  {week.partial && (
                    <p className="mt-2 rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-400">
                      Only part of this week is loaded — this page shows the most recent{" "}
                      {REPORT_LIMIT} reports. Nothing is claimed about the days before it, and no
                      coverage figure is shown for this week for the same reason.
                    </p>
                  )}
                </header>

                <ul className="flex flex-col gap-2">
                  {week.reports.map((report) => (
                    <FieldReportEntry
                      key={report.id}
                      report={report}
                      canDelete={currentUser.role === "OWNER"}
                    />
                  ))}
                </ul>

                {jobsInWeek.map(([jobId, jobName]) => {
                  // Recomputed for THIS job, not sliced out of the
                  // company-wide week. `week.missing` means "no job filed
                  // that day"; a summary for one GC has to mean "this job
                  // filed nothing that day", and the two differ the moment
                  // two jobs are running. Reusing groupIntoWeeks keeps the
                  // per-job figures on the same tested path.
                  const jobWeek = groupIntoWeeks(
                    week.reports.filter((r) => r.jobId === jobId),
                    today,
                    knownFrom,
                  )[0];
                  if (!jobWeek) return null;
                  return (
                    <WeekSummary
                      key={jobId}
                      label={jobsInWeek.length > 1 ? jobName : weekLabel(week.start)}
                      text={weekSummaryText(jobWeek, jobName)}
                    />
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

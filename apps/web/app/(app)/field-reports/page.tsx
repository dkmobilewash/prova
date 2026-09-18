import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { FieldReportComposer } from "@/components/FieldReportComposer";
import { EmptyState } from "@/components/EmptyState";
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
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";
import {
  fieldReportJobWhere,
  fieldReportsFilterHref,
  resolveFieldReportJobFilter,
} from "@/lib/field-report-jobs";

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
export default async function FieldReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter } = await searchParams;

  // Jobs first, rather than the Promise.all this used to be: the report
  // query's own `where` depends on whether `?job=` names a job this company
  // actually has. The same shape as /punch-lists, deliberately — an id that
  // is not in this list is treated as no filter at all, so a stale link
  // shows the whole log rather than an empty page that reads as a company
  // that has never filed anything.
  //
  // status + contact, not just the name: issue #65 — seven jobs sharing
  // one placeholder name made every picker seven identical rows.
  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    select: { id: true, name: true, status: true, contact: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const jobOptions = jobs.map(toJobOption);
  const activeJob = resolveFieldReportJobFilter(jobs, jobFilter);

  const rows = await prisma.dailyFieldReport.findMany({
    where: { companyId: company.id, ...fieldReportJobWhere(activeJob) },
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
  });

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

  // 44px tall, same as /punch-lists' — this is the first thing somebody on
  // site taps to get to their own job.
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Field reports</h1>
      <p className="mb-6 text-sm text-ink-body">
        What happened on site, one entry per job per day. Grouped by week, because a week is
        what a schedule dispute gets argued over — and a week with a day missing from it is
        worth less than one that says which day is missing. Each job&apos;s own reports also
        stay on{" "}
        <Link href="/dashboard" className="text-link hover:text-link-hover">
          its job page
        </Link>
        .
      </p>

      <div className="mb-8">
        {/* The filtered job is an explicit choice, so it is also the job the
            composer starts on — the same handover /punch-lists makes. With
            no filter the composer decides for itself, and only when there
            is exactly one active job to decide between. */}
        <FieldReportComposer jobs={jobOptions} defaultJobId={activeJob ?? undefined} />
      </div>

      {/* The job filter /punch-lists and /photos both have and this page did
          not, which mattered more here than on either of them: this is the
          log a GC asks for by job, and reading it meant scrolling a company-
          wide week and picking out the right rows by eye. */}
      {jobOptions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-tour="field-reports-job-filter">
          <Link href={fieldReportsFilterHref(null)} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobOptions.map((j) => (
            <Link
              key={j.id}
              href={fieldReportsFilterHref(j.id)}
              className={chip(activeJob === j.id)}
            >
              {jobPickerLabel(j)}
            </Link>
          ))}
        </div>
      )}

      {weeks.length === 0 ? (
        <EmptyState
          data-tour="field-reports-empty"
          title={activeJob ? "Nothing filed on this job yet" : "No field reports yet"}
          purpose={
            <p>
              A short daily log for each job: who was on site, what got done, the weather, and
              anything that held you up. Thirty seconds at the end of the day, and months later
              it answers &ldquo;when did the drywall go up?&rdquo; or &ldquo;why did it take an
              extra week?&rdquo; without anyone having to remember.
            </p>
          }
          actions={
            jobOptions.length === 0
              ? [{ label: "Create a job", href: "/jobs/new" }]
              : [{ label: "Log a day", opens: "field-reports-log-day" }]
          }
          ask={
            jobOptions.length === 0
              ? undefined
              : `Log today on ${jobOptions[0].name}: crew of 3, framed the back wall, rain in the afternoon`
          }
          example={{
            caption: "What a week of reports looks like. Not your data — nothing here is saved.",
            rows: [
              { title: "Mon, Sep 8 — Smith kitchen remodel", detail: "Crew of 3 · demo done, dumpster swapped · sunny", meta: "full day" },
              { title: "Tue, Sep 9 — Smith kitchen remodel", detail: "Crew of 2 · rough plumbing moved · rain after 2pm", tag: "Delay", meta: "lost 2 hrs" },
              { title: "Wed, Sep 10 — Smith kitchen remodel", detail: "Crew of 3 · inspection passed · framing patched", meta: "full day" },
            ],
          }}
        />
      ) : (
        <div className="flex flex-col gap-8" data-tour="field-reports-weeks">
          {weeks.map((week) => {
            // One summary per job in the week — a GC gets the week for
            // their project, not for every project we ran that week.
            const jobsInWeek = [...new Map(week.reports.map((r) => [r.jobId, r.jobName]))];

            return (
              <section key={week.start}>
                <header className="mb-3 border-b border-line-row pb-2">
                  <h2 className="font-semibold text-ink">{weekLabel(week.start)}</h2>
                  {/* ink-body — ink-muted is under the 4.5 floor on this ground,
                      under the 4.5 floor for text, and the coverage figure is
                      the point of grouping by week. */}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-body">
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
                    <p className="mt-2 rounded bg-tag-amber px-2 py-1.5 text-xs text-tag-amber-ink">
                      {/* "any job" is only true of the unfiltered page.
                          Filtered, these are days THIS job filed nothing —
                          a different and much stronger claim, and one a
                          schedule dispute gets argued from. */}
                      Nothing filed on {activeJob ? "this job" : "any job"} for{" "}
                      {week.missing.map(dayLabel).join(" · ")}.
                      Days still to come aren&apos;t counted, and neither is today — only days
                      that are over and unrecorded.
                    </p>
                  )}

                  {/* The oldest week on a truncated page is cut off partway
                      through. Before this said so, its unloaded days were
                      grouped as days nobody filed — reports that exist, on
                      the page a schedule dispute gets argued from. */}
                  {week.partial && (
                    <p className="mt-2 rounded bg-neutral-800 px-2 py-1.5 text-xs text-ink-body">
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

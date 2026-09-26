import { requireCapability } from "@/lib/authz";
import { EmptyState } from "@/components/EmptyState";
import { NoAccess } from "@/components/NoAccess";
import { loadWipSchedule } from "@/lib/wip-schedule-query";
import { WIP_SCHEDULE_COLUMNS } from "@/lib/wip-schedule";
import { wipScheduleCell, CANNOT_SAY, CANNOT_SAY_TITLE } from "@/lib/wip-schedule-cell";
import { viewerToday } from "@/lib/viewerToday";

/**
 * The work-in-progress schedule, on screen.
 *
 * WHAT WAS ACTUALLY MISSING. Every figure here already existed and was
 * already tested — `wipScheduleTable`, `wipScheduleTotals`,
 * `loadWipSchedule`, nineteen columns with three coverage ratios — and the
 * only thing that rendered any of it was a CSV download link on
 * `/cash-flow`. A contractor could HAND this schedule to a surety and
 * never look at it themselves. FEATURE-AUDIT called that "no
 * cross-job/company-wide roll-up view", which was right; the gap was a
 * screen, not arithmetic.
 *
 * So this page invents no numbers. It calls the same query the download
 * calls, renders the same rows in the same order, and the download stays
 * exactly where it was.
 *
 * VIEW_COMPANY_FINANCIALS, matching the CSV route rather than something
 * stricter, and its reasoning transfers word for word: gating a screen
 * harder than the file of the same figures would be theatre.
 *
 * WHY ONE WIDE TABLE AND NOT A PHONE LAYOUT. Nineteen financial columns do
 * not fit 375px, and the obvious answer — a card per job showing the
 * "important" six — invents a SECOND definition of this schedule that
 * nobody asked for and that would quietly disagree with the CSV a surety
 * is reading. A WIP schedule is wide because the document is wide. The
 * table scrolls sideways inside its own container, so the PAGE never
 * overflows (which is what the 375px checks measure), and the job column
 * is sticky so a row stays readable while it scrolls.
 */

export const dynamic = "force-dynamic";

export default async function WipSchedulePage() {
  const { context, allowed } = await requireCapability("VIEW_COMPANY_FINANCIALS");
  if (!allowed) return <NoAccess capability="VIEW_COMPANY_FINANCIALS" />;

  const rows = await loadWipSchedule(context.company.id);
  // The reader's calendar day, not the server's — an "as of" on a
  // financial document must match the day the person reading it is having.
  const today = await viewerToday();

  // `wipScheduleTable` appends the totals line, so the last row is TOTAL
  // and is not a job.
  const jobCount = Math.max(rows.length - 1, 0);

  return (
    <div className="p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-ink">Work in progress</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every contracted and in-progress job: what it is worth, what it has cost, what has been
          earned, and whether it is over- or under-billed. Percentage of completion, cost-to-cost.
          As of {today}.
        </p>
      </header>

      {jobCount === 0 ? (
        <EmptyState
          data-tour="wip-empty"
          title="No contracted jobs yet"
          purpose={
            <p>
              Every contracted job on one page: what it is worth, what it has cost, how much of it
              is earned, and whether you are ahead of or behind your billing. It is the document a
              surety or a bank asks for, and it fills in on its own from the jobs and costs you
              already record — nothing here is typed twice. A job appears once it is contracted; an
              estimate has no earned revenue to report.
            </p>
          }
          actions={[{ label: "See your jobs", href: "/jobs" }, { label: "Cash flow", href: "/cash-flow" }]}
        />
      ) : (
        <>
          {/* Said ON THE SCREEN, not only in the CSV's preamble. A blank
              that means "we cannot say" is worthless if the sentence
              explaining it only exists in the download. */}
          <p className="mb-3 text-xs text-ink-muted" data-tour="wip-coverage">
            <span className="font-medium text-ink-body">{CANNOT_SAY}</span> is not zero.{" "}
            {CANNOT_SAY_TITLE}
          </p>

          <div className="overflow-x-auto rounded-md border border-line-card" data-tour="wip-table">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface">
                  {WIP_SCHEDULE_COLUMNS.map((column, index) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={`whitespace-nowrap border-b border-line-card px-3 py-2 text-left align-bottom text-xs font-semibold text-ink-label ${
                        index === 0 ? "sticky left-0 z-10 bg-surface" : ""
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const isTotal = rowIndex === rows.length - 1;
                  return (
                    <tr
                      key={`${row.job}-${rowIndex}`}
                      className={isTotal ? "bg-surface font-semibold" : "odd:bg-canvas"}
                    >
                      {WIP_SCHEDULE_COLUMNS.map((column, index) => {
                        const cell = wipScheduleCell(column.key, row[column.key]);
                        return (
                          <td
                            key={column.key}
                            title={cell.title}
                            className={`whitespace-nowrap border-b border-line-card px-3 py-2 ${
                              cell.numeric ? "text-right tabular-nums" : "text-left"
                            } ${cell.title ? "text-ink-muted" : "text-ink-body"} ${
                              index === 0
                                ? `sticky left-0 z-10 font-medium text-ink ${isTotal ? "bg-surface" : "bg-canvas"}`
                                : ""
                            }`}
                          >
                            {cell.text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The two columns most often read backwards, said once under
              the table rather than left to a tooltip. Overbilled is a
              LIABILITY — money taken for work not yet done — and it looks
              like good news to anybody reading it as "we billed more". */}
          <dl className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-2" data-tour="wip-billing">
            <div>
              <dt className="inline font-medium text-ink-body">Overbilled: </dt>
              <dd className="inline">
                billed ahead of the work earned. That money is not yours yet — it is owed back in
                work.
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink-body">Underbilled: </dt>
              <dd className="inline">
                work earned that has not been billed. It is yours; nobody has been asked for it
                yet.
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-3" data-tour="wip-download">
            {/* A plain link, not a button: this is a GET returning a file,
                so the browser's own download is the whole mechanism. */}
            <a
              href="/api/wip-schedule"
              download
              className="inline-flex rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Download WIP schedule (CSV)
            </a>
            <span className="text-xs text-ink-muted">
              {jobCount} {jobCount === 1 ? "job" : "jobs"}. The file carries the same figures, with a
              title block stating the method — that is the copy to hand a surety.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

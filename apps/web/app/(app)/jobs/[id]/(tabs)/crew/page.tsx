import Link from "next/link";
import { prisma } from "@prova/db";
import { RowActions, ConfirmDelete } from "@/components/RowActions";
import { LogTimeEntryForm } from "@/components/LogTimeEntryForm";
import { TimeEntryRow } from "@/components/TimeEntryRow";
import { TimesheetSignoffs } from "@/components/TimesheetSignoffs";
import { SignatureImage } from "@/components/SignatureImage";
import { TmTicketActions } from "@/components/TmTicketActions";
import { DispatchSlipForm } from "@/components/DispatchSlipForm";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { can, canReach } from "@/lib/permissions";
import { viewerTimeZone, viewerToday } from "@/lib/viewerToday";
import { CrewWeekGrid } from "@/components/CrewWeekGrid";
import { resolveWeekStart } from "@/lib/crew-schedule";
import { loadScheduleBetween, scheduledWorkerName } from "@/lib/crew-schedule-query";
import { formatHours } from "@/lib/render-hours";
import { splitThisWeek, toHoursEntry, weeklyHours } from "@/lib/weekly-hours";
import { CollapsedForm } from "@/components/CollapsedForm";
import { Disclosure } from "@/components/Disclosure";
import { SeeAll, seeAllWindow } from "@/components/SeeAll";
import { weekStart } from "@/components/fieldReportWeeks";
import { WeeklyHoursTable } from "@/components/WeeklyHoursTable";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { money } from "@/lib/money";
import { calculateTimeEntryLaborCost, findEffectiveFringeRateSchedule } from "@/lib/labor-cost";
import { NAME_NOT_RECORDED, crewMemberName, timeEntryWorkerName } from "@/lib/worker-name";
import { workerOptions } from "@/lib/worker-select";
import { deleteDispatchSlip, deleteTimeEntry } from "@/lib/actions";

const rowDeleteClass = "text-xs text-danger hover:underline";
const rowCancelClass =
  "rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:border-line-card";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-danger hover:bg-red-500/10";

/**
 * Crew & time — field time entries, timesheet sign-off, T&M tickets and
 * union hiring-hall dispatch. Ungated as a route, exactly as it was in the
 * monolith (only T&M tickets withhold on MANAGE_FIELD; everything else
 * here was always open to anyone who could open the job).
 */
export default async function JobCrewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; all?: string; open?: string }>;
}) {
  const { id } = await params;
  const { week: weekParam, all, open } = await searchParams;
  const { principal, job: jobRef } = await requireJob(id);
  const { showsField } = jobCapabilities(principal);
  const canApproveTimesheet = can(principal, "MANAGE_COMPLIANCE");

  const job = await prisma.job.findUnique({
    where: { id: jobRef.id },
    include: {
      lineItems: { where: { isDeleted: false }, select: { id: true, description: true } },
      timeEntries: {
        orderBy: { date: "desc" },
        include: {
          employeeUser: true,
          crewMember: true,
          lineItem: true,
          craftClassification: { include: { unionLocal: true } },
          lastCorrectedByUser: true,
        },
      },
      timesheetSignoffs: {
        orderBy: [{ date: "desc" }, { signedAt: "desc" }],
        take: 60,
        include: { signedByUser: true, approvedByUser: true, reopenedByUser: true },
      },
      dispatchSlips: {
        orderBy: { dispatchDate: "desc" },
        include: { employeeUser: true, crewMember: true, craftClassification: { include: { unionLocal: true } } },
      },
    },
  });
  if (!job) throw new Error("job disappeared between checks");

  const [companyMembers, crewMembers, craftClassifications, tmTickets] = await Promise.all([
    prisma.user.findMany({ where: { companyId: jobRef.companyId }, orderBy: { createdAt: "asc" } }),
    // The other half of "who worked". TimeEntry names a User OR a
    // CrewMember, and this page only ever offered the first — so hours for
    // a worker with no login could be typed on the phone and not here.
    // Archived people are left out: their hours stay, but no NEW hours go
    // against them, which is the same rule the phone's API applies.
    prisma.crewMember.findMany({
      where: { companyId: jobRef.companyId, archivedAt: null },
      select: { id: true, legalFirstName: true, legalMiddleName: true, legalLastName: true },
      orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
    }),
    prisma.craftClassification.findMany({
      where: { companyId: jobRef.companyId },
      include: { unionLocal: true, fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } } },
      orderBy: { name: "asc" },
    }),
    // Only fetched for a reader who can see it — same MANAGE_FIELD gate
    // the monolith withheld this section behind, now also skipping the
    // query rather than just hiding the result.
    showsField
      ? prisma.tmTicket.findMany({
          where: { jobId: jobRef.id },
          orderBy: { workDate: "desc" },
          take: 20,
          include: {
            changeOrder: { select: { number: true, status: true } },
            _count: { select: { media: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // A job still at ESTIMATE has nothing to log yet (density audit #39: the
  // full tab, with its open forms, on a bid). One line instead, the way
  // Billing does it — but only while the tab is EMPTY, so no hour, sign-off,
  // slip or ticket already on the job is ever hidden, and `?open=1` opens
  // the whole tab anyway (pre-construction hours are real). jobTabs.ts is
  // untouched: the tab stays in the row.
  const nothingYet =
    job.timeEntries.length === 0 &&
    job.timesheetSignoffs.length === 0 &&
    job.dispatchSlips.length === 0 &&
    tmTickets.length === 0;
  if (jobRef.status === "ESTIMATE" && nothingYet && open !== "1") {
    return (
      <p className="text-sm text-ink-muted">
        This job is still an estimate — crew, hours and dispatch open up once it&rsquo;s contracted.{" "}
        <Link href={`/jobs/${jobRef.id}/crew?open=1#log-time`} className="text-link hover:text-link-hover">
          Log time anyway
        </Link>
      </p>
    );
  }
  /**
   * Everybody hours can be logged for, in one list — and everybody a hiring
   * hall can dispatch, which is the same people: the dispatch form takes this
   * list too, rather than the logins-only one it had.
   *
   * Teammates first, then crew, each alphabetical within its group, with a
   * suffix naming which kind they are. That suffix is not decoration: two
   * people in a small company genuinely share a first name, and the choice
   * decides which TABLE the hour is attributed to and therefore which name
   * prints on a WH-347.
   */
  const timeEntryWorkers = workerOptions(companyMembers, crewMembers);

  const timeEntryCraftOptions = craftClassifications.map((craft) => ({
    id: craft.id,
    label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
  }));

  const timeZone = await viewerTimeZone();
  const today = await viewerToday();
  const week = resolveWeekStart(weekParam, today);
  const weekDays = await loadScheduleBetween(jobRef.companyId, week, 6, job.id);
  // Hours totals are always THIS week; ?week= only moves the schedule grid.
  const thisWeek = weeklyHours(
    job.timeEntries.map((entry) => toHoursEntry(entry, job)),
    weekStart(today),
  );

  // Days with a live timesheet sign-off: their hours are locked. Uncapped,
  // unlike the sign-off history list above, so an old signed day never
  // shows an Edit that would fail.
  const lockedTimeDays = new Map(
    (
      await prisma.timesheetSignoff.findMany({
        where: { jobId: job.id, reopenedAt: null },
        select: { date: true, approvedAt: true },
      })
    ).map((s) => [s.date.toISOString().slice(0, 10), s.approvedAt ? "Approved" : "Signed"]),
  );

  const timeEntryLaborCosts = new Map(
    job.timeEntries.map((entry) => {
      const craft = craftClassifications.find((c) => c.id === entry.craftClassificationId);
      const schedule = craft
        ? findEffectiveFringeRateSchedule(
            craft.fringeRateSchedules.map((s) => ({
              baseWage: Number(s.baseWage),
              pensionRate: s.pensionRate != null ? Number(s.pensionRate) : null,
              vacationRate: s.vacationRate != null ? Number(s.vacationRate) : null,
              healthWelfareRate: s.healthWelfareRate != null ? Number(s.healthWelfareRate) : null,
              trainingRate: s.trainingRate != null ? Number(s.trainingRate) : null,
              effectiveFrom: s.effectiveFrom,
              effectiveTo: s.effectiveTo,
            })),
            entry.date,
          )
        : null;
      const cost = calculateTimeEntryLaborCost({ hours: Number(entry.hours), payType: entry.payType, date: entry.date }, schedule);
      return [entry.id, cost];
    }),
  );

  const deleteTimeEntryWithId = (timeEntryId: string) => deleteTimeEntry.bind(null, job.id, timeEntryId);
  const deleteDispatchSlipWithId = (dispatchSlipId: string) => deleteDispatchSlip.bind(null, job.id, dispatchSlipId);

  // Declutter (density audit #1, 9.94 screens): every entry ever used to
  // render under the weekly table. Now the table's own week is listed under
  // it and the rest is a capped history. Sliced in memory because the
  // weekly table and the labour-cost map above already need every entry.
  // ponytail: loads every entry; take/skip in the query when a job has thousands.
  const { thisWeek: thisWeekEntries, earlier: earlierEntries } = splitThisWeek(job.timeEntries, weekStart(today));
  const history = seeAllWindow(all);
  const shownHistory = history.take ? earlierEntries.slice(0, history.take) : earlierEntries;
  const weekQuery = weekParam ? `week=${encodeURIComponent(weekParam)}&` : "";
  const waitingSignoffs = job.timesheetSignoffs.filter((s) => !s.reopenedAt && !s.approvedAt).length;

  const timeEntryRow = (entry: (typeof job.timeEntries)[number]) => (
    <TimeEntryRow
      key={entry.id}
      entry={{
        id: entry.id,
        dateLabel: formatCalendarDate(entry.date),
        employeeLabel: entry.employeeUser
          ? entry.employeeUser.name ?? entry.employeeUser.email
          : timeEntryWorkerName(entry).label,
        hours: String(Number(entry.hours)),
        payType: entry.payType,
        note: entry.note,
        perDiemAmount: entry.perDiemAmount != null ? String(entry.perDiemAmount) : null,
        travelPayAmount: entry.travelPayAmount != null ? String(entry.travelPayAmount) : null,
        lineItemId: entry.lineItemId,
        lineItemLabel: entry.lineItem?.description ?? null,
        craftClassificationId: entry.craftClassificationId,
        craftLabel: entry.craftClassification?.name ?? null,
        estimatedCostLabel:
          timeEntryLaborCosts.get(entry.id) != null ? money(timeEntryLaborCosts.get(entry.id)!) : null,
        lastCorrectedLabel: entry.lastCorrectedAt
          ? `corrected ${formatInstant(entry.lastCorrectedAt, timeZone)}${
              entry.lastCorrectedByUser
                ? ` by ${entry.lastCorrectedByUser.name ?? entry.lastCorrectedByUser.email}`
                : ""
            }`
          : null,
        lockedLabel: lockedTimeDays.get(entry.date.toISOString().slice(0, 10)) ?? null,
      }}
      lineItems={job.lineItems.map((item) => ({ id: item.id, description: item.description }))}
      craftOptions={timeEntryCraftOptions}
      deleteAction={deleteTimeEntryWithId(entry.id)}
    />
  );
  const sectionTitle = "inline text-base font-semibold text-ink";
  const summaryFact = "ml-2 text-sm font-normal text-ink-muted";

  return (
    <div>
      {/* Scheduling lived only on /schedule, so the job's own Crew step had
          no way to put anyone on it (ux medium-B #11). The link opens the
          same form there with this job already picked. */}
      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Who is on this job</h2>
          {showsField && (
            <Link
              href={`/schedule?job=${job.id}&add=1`}
              className="inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-sm text-ink-label hover:border-link hover:text-link"
            >
              Schedule crew
            </Link>
          )}
        </div>
        <CrewWeekGrid
          days={weekDays.map((row) => ({
            id: row.id,
            workDate: row.workDate.toISOString().slice(0, 10),
            jobId: row.jobId,
            jobName: row.job.name,
            worker: scheduledWorkerName(row),
            craft: row.craftClassification?.name ?? null,
            note: row.note,
          }))}
          week={week}
          today={today}
          basePath={`/jobs/${job.id}/crew`}
        />
      </section>

      <section className="mb-8" data-tour="job-time">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Field time entries</h2>
          <Link href={`/jobs/${job.id}/certified-payroll`} className="text-sm text-link hover:underline">
            Certified payroll report →
          </Link>
        </div>

        {/* Behind a button now (declutter): the open form was 322px of the
            first screen on every visit. "Log hours" (Home, ⌘K) lands on
            #log-time: the closed button carries that id, and CollapsedForm
            opens itself when the hash names it, so the link still lands
            on the form. */}
        <div className="mb-4">
          <CollapsedForm label="Log time" openOnHash="log-time">
            <LogTimeEntryForm
              jobId={job.id}
              workers={timeEntryWorkers}
              lineItems={job.lineItems}
              craftOptions={timeEntryCraftOptions}
            />
          </CollapsedForm>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-ink">
              This week: {formatHours(thisWeek.totalHours)} hrs
            </h3>
            {canReach(principal, "/hours") && (
              <Link href="/hours" className="text-sm text-link hover:underline">
                Every job&rsquo;s hours →
              </Link>
            )}
          </div>
          {thisWeek.people.length > 0 ? (
            <WeeklyHoursTable week={thisWeek} caption="Hours on this job this week, by person and day" />
          ) : (
            <p className="text-sm text-ink-muted">No hours logged on this job yet this week.</p>
          )}
        </div>

        {thisWeekEntries.length > 0 && (
          <ul aria-label="This week's time entries" className="mb-4 flex flex-col gap-2">
            {thisWeekEntries.map(timeEntryRow)}
          </ul>
        )}

        <Disclosure variant="plain" summary="How time entries work">
          <p className="text-sm text-ink-muted">
            Hours worked by person, by day — teammates who sign in and field crew who don&rsquo;t, optionally tied to
            a cost code and craft classification. Tracks hours by pay type; wage cost is estimated from the applicable
            fringe rate schedule when one applies.
          </p>
        </Disclosure>
      </section>

      {/* The three jobs that used to stack under the full entry history,
          each one line until opened. Sign-off opens itself when a day is
          waiting on THIS viewer's approval — that is "what needs me". */}
      <div className="mb-8 flex flex-col gap-3">
        <Disclosure
          id="timesheet-signoff"
          open={canApproveTimesheet && waitingSignoffs > 0}
          summary={
            <>
              <h2 className={sectionTitle}>Timesheet sign-off</h2>
              <span className={summaryFact}>
                {waitingSignoffs > 0
                  ? `${waitingSignoffs} ${waitingSignoffs === 1 ? "day" : "days"} waiting for approval`
                  : job.timesheetSignoffs.length > 0
                    ? `${job.timesheetSignoffs.length} signed ${job.timesheetSignoffs.length === 1 ? "day" : "days"}`
                    : "none yet"}
              </span>
            </>
          }
        >
          <p className="mb-3 text-sm text-ink-muted">
            The foreman signs each day&rsquo;s hours on the phone. A signed day is locked; approving it makes it
            payroll. Reopen a day to fix it — the old signature and your reason stay on the record.
          </p>
          <TimesheetSignoffs
            canApprove={canApproveTimesheet}
            rows={job.timesheetSignoffs.map((signoff) => ({
              id: signoff.id,
              dateLabel: formatCalendarDate(signoff.date),
              state: signoff.reopenedAt ? "REOPENED" : signoff.approvedAt ? "APPROVED" : "SUBMITTED",
              signerName: signoff.signerName,
              signedLabel: `Signed ${formatInstant(signoff.signedAt, timeZone)}${
                signoff.signedByUser ? ` from ${signoff.signedByUser.name ?? signoff.signedByUser.email}'s phone` : ""
              }`,
              entryCount: signoff.entryCount,
              totalHours: String(Number(signoff.totalHours)),
              signaturePath: signoff.signaturePath,
              approvedLabel: signoff.approvedAt
                ? `${formatInstant(signoff.approvedAt, timeZone)}${
                    signoff.approvedByUser ? ` by ${signoff.approvedByUser.name ?? signoff.approvedByUser.email}` : ""
                  }`
                : null,
              reopenedLabel: signoff.reopenedAt
                ? `${formatInstant(signoff.reopenedAt, timeZone)}${
                    signoff.reopenedByUser ? ` by ${signoff.reopenedByUser.name ?? signoff.reopenedByUser.email}` : ""
                  }`
                : null,
              reopenReason: signoff.reopenReason,
            }))}
          />
        </Disclosure>

        {showsField && (
          <Disclosure
            id="tm-tickets"
            summary={
              <>
                <h2 className={sectionTitle}>T&amp;M tickets</h2>
                <span className={summaryFact}>
                  {tmTickets.length === 0 ? "none yet" : `${tmTickets.length} signed`}
                </span>
              </>
            }
          >
            <p className="mb-3 text-sm text-ink-muted">
              Extra work signed for on site from the phone, with what the day&rsquo;s labor and materials were when it
              was signed.
            </p>
            {tmTickets.length === 0 ? (
              <p className="text-sm text-ink-muted">No T&amp;M tickets on this job yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {tmTickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className="flex flex-wrap items-start gap-3 rounded-lg border border-line-row bg-surface p-3 text-sm"
                  >
                    {ticket.signaturePath ? (
                      <SignatureImage path={ticket.signaturePath} label={`Signature of ${ticket.signerName}`} />
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-ink">{formatCalendarDate(ticket.workDate)}</span>
                      <span className="text-ink-body">{ticket.workDescription}</span>
                      <span className="text-xs text-ink-muted">
                        Signed by {ticket.signerName}, {formatInstant(ticket.signedAt, timeZone)}
                        {ticket.signaturePath ? "" : " (typed name — signed before the phone took drawn signatures)"}
                        {ticket._count.media > 0
                          ? ` · ${ticket._count.media} photo${ticket._count.media === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </div>
                    <TmTicketActions
                      ticketId={ticket.id}
                      jobId={job.id}
                      changeOrder={
                        ticket.changeOrder ? { number: ticket.changeOrder.number, status: ticket.changeOrder.status } : null
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Disclosure>
        )}

        <Disclosure
          id="dispatch"
          summary={
            <>
              <h2 className={sectionTitle}>Union hiring-hall dispatch</h2>
              <span className={summaryFact}>
                {job.dispatchSlips.length === 0
                  ? "no slips yet"
                  : `${job.dispatchSlips.length} ${job.dispatchSlips.length === 1 ? "slip" : "slips"}`}
              </span>
            </>
          }
        >
          <p className="mb-3 text-sm text-ink-muted">
            The hiring hall&rsquo;s referral of a worker to this job — the authorization to work under that
            local&rsquo;s agreement, separate from hours actually logged in Field time entries above.
          </p>

          {job.dispatchSlips.length > 0 && (
            <ul className="mb-4 flex flex-col gap-2">
              {job.dispatchSlips.map((slip) => (
                <li
                  key={slip.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-card bg-surface p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-ink">{formatCalendarDate(slip.dispatchDate)}</span>
                    <span className="text-ink-label">{dispatchSlipWorkerLabel(slip)}</span>
                    {slip.craftClassification && <span className="text-xs text-ink-muted">{slip.craftClassification.name}</span>}
                    {slip.dispatchNumber && (
                      <span className="rounded bg-rail-hover px-1.5 py-0.5 text-xs text-ink-body">#{slip.dispatchNumber}</span>
                    )}
                    {slip.fileUrl && (
                      <a href={slip.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-link hover:underline">
                        {slip.fileName ?? "View slip"}
                      </a>
                    )}
                    {slip.note && <span className="text-xs text-ink-muted">— {slip.note}</span>}
                  </div>
                  <RowActions
                    className="flex shrink-0 flex-col items-end gap-1"
                    destructive={
                      <ConfirmDelete
                        pinned="end"
                        action={deleteDispatchSlipWithId(slip.id)}
                        describe="Removes the hall's referral record for this worker. Nothing is sent to the local, and hours already logged stay."
                        label="Remove"
                        confirmLabel="Confirm remove"
                        armedClassName="flex flex-wrap items-center justify-end gap-2"
                        deleteClassName={rowDeleteClass}
                        cancelClassName={rowCancelClass}
                        confirmClassName={rowConfirmClass}
                        hint={
                          slip.fileUrl ? (
                            <span className="max-w-[16rem] text-right text-ink-muted">
                              The hall&rsquo;s referral for this worker goes, and the uploaded slip stops being
                              reachable from this job.
                            </span>
                          ) : undefined
                        }
                      />
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          <CollapsedForm label="Log a dispatch slip" tone="secondary">
            <DispatchSlipForm
              jobId={job.id}
              workers={timeEntryWorkers}
              crafts={craftClassifications.map((craft) => ({
                id: craft.id,
                label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
              }))}
            />
          </CollapsedForm>
        </Disclosure>
      </div>

      {earlierEntries.length > 0 && (
        <section id="time-history" className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-ink">Earlier time entries</h2>
          <ul className="flex flex-col gap-2">{shownHistory.map(timeEntryRow)}</ul>
          <SeeAll
            total={earlierEntries.length}
            limit={history.limit}
            showingAll={history.showingAll}
            noun="earlier entries"
            href={`?${weekQuery}all=1#time-history`}
            fewerHref={`?${weekQuery}#time-history`}
          />
        </section>
      )}
    </div>
  );
}

/**
 * Who a dispatch slip names, for this screen. A slip names a User OR a crew
 * member (the XOR CHECK on DispatchSlip); a login keeps the name-or-email
 * this row always showed, and a crew member reads their legal name with the
 * same "(crew)" suffix the form's dropdown used to choose them.
 */
function dispatchSlipWorkerLabel(slip: {
  employeeUser: { name: string | null; email: string } | null;
  crewMember: { legalFirstName: string; legalMiddleName: string | null; legalLastName: string } | null;
}): string {
  if (slip.employeeUser) return slip.employeeUser.name ?? slip.employeeUser.email;
  if (slip.crewMember) return `${crewMemberName(slip.crewMember).label} (crew)`;
  return NAME_NOT_RECORDED;
}

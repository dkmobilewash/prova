import Link from "next/link";
import { prisma } from "@prova/db";
import { RowActions, ConfirmDelete } from "@/components/RowActions";
import { LogTimeEntryForm } from "@/components/LogTimeEntryForm";
import { TimeEntryRow } from "@/components/TimeEntryRow";
import { TimesheetSignoffs } from "@/components/TimesheetSignoffs";
import { SignatureImage } from "@/components/SignatureImage";
import { DispatchSlipForm } from "@/components/DispatchSlipForm";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { can } from "@/lib/permissions";
import { viewerTimeZone } from "@/lib/viewerToday";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { money } from "@/lib/money";
import { calculateTimeEntryLaborCost, findEffectiveFringeRateSchedule } from "@/lib/labor-cost";
import { crewMemberName, timeEntryWorkerName } from "@/lib/worker-name";
import { workerValue } from "@/lib/worker-select";
import { deleteDispatchSlip, deleteTimeEntry } from "@/lib/actions";

const rowDeleteClass = "text-xs text-red-400 hover:underline";
const rowCancelClass =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-ink-label hover:border-slate-500";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10";

/**
 * Crew & time — field time entries, timesheet sign-off, T&M tickets and
 * union hiring-hall dispatch. Ungated as a route, exactly as it was in the
 * monolith (only T&M tickets withhold on MANAGE_FIELD; everything else
 * here was always open to anyone who could open the job).
 */
export default async function JobCrewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
        include: { employeeUser: true, craftClassification: { include: { unionLocal: true } } },
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
    showsField ? prisma.tmTicket.findMany({ where: { jobId: jobRef.id }, orderBy: { workDate: "desc" }, take: 20 }) : Promise.resolve([]),
  ]);
  /**
   * Everybody hours can be logged for, in one list.
   *
   * Teammates first, then crew, each alphabetical within its group, with a
   * suffix naming which kind they are. That suffix is not decoration: two
   * people in a small company genuinely share a first name, and the choice
   * decides which TABLE the hour is attributed to and therefore which name
   * prints on a WH-347.
   */
  const timeEntryWorkers = [
    ...companyMembers.map((member) => ({
      value: workerValue({ kind: "user", userId: member.id }),
      label: `${member.name ?? member.email} (signs in)`,
    })),
    ...crewMembers.map((member) => ({
      value: workerValue({ kind: "crew", crewMemberId: member.id }),
      label: `${crewMemberName(member).label} (crew)`,
    })),
  ];

  const timeEntryCraftOptions = craftClassifications.map((craft) => ({
    id: craft.id,
    label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
  }));

  const timeZone = await viewerTimeZone();

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

  return (
    <div>
      <section className="mb-10" data-tour="job-time">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Field time entries</h2>
          <Link href={`/jobs/${job.id}/certified-payroll`} className="text-sm text-link hover:underline">
            Certified payroll report →
          </Link>
        </div>
        <p className="mb-3 text-sm text-ink-muted">
          Hours worked by person, by day — teammates who sign in and field crew who don&rsquo;t, optionally tied to
          a cost code and craft classification. Tracks hours by pay type; wage cost is estimated from the applicable
          fringe rate schedule when one applies.
        </p>

        {job.timeEntries.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2">
            {job.timeEntries.map((entry) => (
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
            ))}
          </ul>
        )}

        <LogTimeEntryForm
          jobId={job.id}
          workers={timeEntryWorkers}
          lineItems={job.lineItems}
          craftOptions={timeEntryCraftOptions}
        />

        <h3 className="mb-1 mt-6 text-base font-semibold text-ink">Timesheet sign-off</h3>
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
      </section>

      {showsField && (
        <section className="mb-10">
          <h2 className="mb-1 text-lg font-semibold text-ink">T&amp;M tickets</h2>
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
                  className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm"
                >
                  {ticket.signaturePath ? (
                    <SignatureImage path={ticket.signaturePath} label={`Signature of ${ticket.signerName}`} />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-slate-100">{formatCalendarDate(ticket.workDate)}</span>
                    <span className="text-slate-300">{ticket.workDescription}</span>
                    <span className="text-xs text-slate-500">
                      Signed by {ticket.signerName}, {formatInstant(ticket.signedAt, timeZone)}
                      {ticket.signaturePath ? "" : " (typed name — signed before the phone took drawn signatures)"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold text-ink">Union hiring-hall dispatch</h2>
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
                  <span className="text-ink-label">{slip.employeeUser.name ?? slip.employeeUser.email}</span>
                  {slip.craftClassification && <span className="text-xs text-ink-muted">{slip.craftClassification.name}</span>}
                  {slip.dispatchNumber && (
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-body">#{slip.dispatchNumber}</span>
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

        <DispatchSlipForm
          jobId={job.id}
          employees={companyMembers.map((member) => ({ id: member.id, name: member.name, email: member.email }))}
          crafts={craftClassifications.map((craft) => ({
            id: craft.id,
            label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
          }))}
        />
      </section>
    </div>
  );
}

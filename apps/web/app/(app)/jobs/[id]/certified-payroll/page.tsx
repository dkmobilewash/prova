import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/money";
import { buildCertifiedPayrollSummary, type CertifiedPayrollTimeEntryInput } from "@/lib/certified-payroll";
import {
  certifiedPayrollWeekStart,
  certifiedPayrollWeekWindow,
} from "@/lib/certified-payroll-week";
import { loadCertifiedPayrollWeekEntries } from "@/lib/certified-payroll-query";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";
import { payrollWorkerName } from "@/lib/worker-name";

const PAY_TYPE_COLUMNS = [
  { value: "STRAIGHT", label: "ST" },
  { value: "OVERTIME", label: "OT" },
  { value: "DOUBLE_TIME", label: "DT" },
  { value: "SHIFT_DIFFERENTIAL", label: "Diff" },
] as const;

/** Only for the ±7 previous/next links. The week's own boundaries come
 * from lib/certified-payroll-week.ts — deriving them here a second time is
 * what let the printed Saturday and the queried Saturday disagree. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** With the weekday, because the weekday is the thing a reviewer checks a
 * payroll week against. */
function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function CertifiedPayrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weekStart?: string }>;
}) {
  const { id } = await params;
  const { weekStart: weekStartParam } = await searchParams;
  // "certified payroll" is named in MANAGE_COMPLIANCE's own definition,
  // and this page prints an hourly rate against a named employee for
  // every day of the week. Same capability as /prevailing-wage, which is
  // the filing this report feeds.
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company } = context;

  const job = await prisma.job.findUnique({ where: { id }, include: { contact: true } });
  if (!job || job.companyId !== company.id) {
    notFound();
  }

  const requestedStart = weekStartParam ? new Date(`${weekStartParam}T00:00:00.000Z`) : new Date();
  const weekStart = certifiedPayrollWeekStart(
    Number.isNaN(requestedStart.getTime()) ? new Date() : requestedStart,
  );
  // The Saturday printed in the header is the query's OWN upper bound, not
  // a second computation that happens to agree with it. It did not agree:
  // the header said "– Aug 29" while the query ran to Aug 30, and nothing
  // on the page could reveal the difference.
  const weekEnd = certifiedPayrollWeekWindow(weekStart).lte;
  const previousWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  const [entries, craftClassifications] = await Promise.all([
    loadCertifiedPayrollWeekEntries(company.id, job.id, weekStart),
    prisma.craftClassification.findMany({
      where: { companyId: company.id },
      include: { fringeRateSchedules: true },
    }),
  ]);

  const fringeSchedulesByCraft = new Map<string, FringeRateScheduleInput[]>(
    craftClassifications.map((craft) => [
      craft.id,
      craft.fringeRateSchedules.map((s) => ({
        baseWage: Number(s.baseWage),
        pensionRate: s.pensionRate != null ? Number(s.pensionRate) : null,
        vacationRate: s.vacationRate != null ? Number(s.vacationRate) : null,
        healthWelfareRate: s.healthWelfareRate != null ? Number(s.healthWelfareRate) : null,
        trainingRate: s.trainingRate != null ? Number(s.trainingRate) : null,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      })),
    ]),
  );

  // Who has no name on their account. Collected before the summary is built,
  // because it groups by employeeUserId and the identity is gone by the time
  // the rows come back out.
  const missingName = new Map<string, string>();
  for (const entry of entries) {
    if (payrollWorkerName(entry.employeeUser).nameMissing) {
      missingName.set(entry.employeeUserId, entry.employeeUser.email);
    }
  }

  const summaryInputs: CertifiedPayrollTimeEntryInput[] = entries.map((entry) => ({
    employeeUserId: entry.employeeUserId,
    // NOT `name ?? email`. See lib/worker-name.ts — this column is a
    // statement to a government agency about who did the work.
    employeeName: payrollWorkerName(entry.employeeUser).label,
    craftClassificationId: entry.craftClassificationId,
    craftLabel: entry.craftClassification
      ? `${entry.craftClassification.unionLocal.parentInternational} ${entry.craftClassification.unionLocal.localNumber} — ${entry.craftClassification.name}`
      : null,
    date: entry.date,
    hours: Number(entry.hours),
    payType: entry.payType,
    perDiemAmount: entry.perDiemAmount != null ? Number(entry.perDiemAmount) : null,
    travelPayAmount: entry.travelPayAmount != null ? Number(entry.travelPayAmount) : null,
  }));

  const employeeSummaries = buildCertifiedPayrollSummary(summaryInputs, fringeSchedulesByCraft);
  const weekTotalHours = employeeSummaries.reduce((sum, e) => sum + e.totalHours, 0);
  const anyUncomputed = employeeSummaries.some((e) => e.hasUncomputedHours);

  // Hours by day, PRINTED. Every other figure on this page is a week-level
  // roll-up with no date on it, which is why an eight-day window could put
  // a foreign Sunday on a filing and no printout showed it. A day listed
  // here outside the header's range is a bug, visible on paper.
  const hoursByDay = [...summaryInputs
    .reduce((acc, entry) => {
      const key = isoDate(entry.date);
      acc.set(key, (acc.get(key) ?? 0) + entry.hours);
      return acc;
    }, new Map<string, number>())
    .entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/jobs/${job.id}`} className="text-sm text-link hover:underline">
          ← Back to job
        </Link>
        <PrintButton />
      </div>

      <h1 className="text-xl font-semibold text-ink">Certified payroll — {job.name}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {job.contact.name} · Week of {formatDate(weekStart)} – {formatDate(weekEnd)}
      </p>
      <p className="mt-3 max-w-2xl text-xs text-ink-muted">
        This is a certified-payroll-style summary of logged hours and computed wages for this job/week — it is not
        formatted as a federal WH-347 or state-equivalent form. Wage costs use the FringeRateSchedule effective for
        each craft classification and date; rows without a craft tag or an effective schedule show hours only,
        flagged below.
      </p>

      <div className="mb-4 mt-4 flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/jobs/${job.id}/certified-payroll?weekStart=${isoDate(previousWeek)}`}
          className="text-sm text-ink-body hover:underline"
        >
          ← Previous week
        </Link>
        <Link
          href={`/jobs/${job.id}/certified-payroll?weekStart=${isoDate(nextWeek)}`}
          className="text-sm text-ink-body hover:underline"
        >
          Next week →
        </Link>
      </div>

      {employeeSummaries.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">No time entries logged on this job for this week.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {/* Ahead of the summaries rather than as a footnote: this decides
              whether the week can be filed at all, and a note under the last
              table is the thing nobody reads before printing. */}
          {missingName.size > 0 && (
            <div className="rounded-lg border border-amber-700 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium text-tag-amber-ink">
                {missingName.size === 1
                  ? "One person on this week has no name on their account."
                  : `${missingName.size} people on this week have no name on their account.`}
              </p>
              <p className="mt-1 text-xs text-tag-amber-ink/80">
                The worker-name column on a WH-347 is a statement about who did the work, so it is
                left as &ldquo;Name not recorded&rdquo; rather than filled with an email address.
                Set the name on each account under Team, then reload this page before filing.
              </p>
              <ul className="mt-2 flex flex-col gap-0.5 text-xs text-tag-amber-ink/80">
                {[...missingName.values()].map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </div>
          )}
          {employeeSummaries.map((employee) => (
            <div key={employee.employeeUserId} className="rounded-lg border border-line-card bg-surface p-4">
              <p className="font-medium text-ink">
                {employee.employeeName}
                {missingName.has(employee.employeeUserId) && (
                  <span className="ml-2 text-xs font-normal text-amber-400">
                    — no name on {missingName.get(employee.employeeUserId)}
                  </span>
                )}
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="text-xs text-ink-muted">
                      <th className="pb-1 pr-3 font-normal">Classification</th>
                      {PAY_TYPE_COLUMNS.map((col) => (
                        <th key={col.value} className="pb-1 pr-3 text-right font-normal">
                          {col.label}
                        </th>
                      ))}
                      <th className="pb-1 pr-3 text-right font-normal">Total hrs</th>
                      <th className="pb-1 text-right font-normal">Wages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employee.rows.map((row) => (
                      <tr key={row.craftLabel} className="border-t border-line-row">
                        <td className="py-1 pr-3 text-ink-label">{row.craftLabel}</td>
                        {PAY_TYPE_COLUMNS.map((col) => (
                          <td key={col.value} className="py-1 pr-3 text-right text-ink-body">
                            {row.hoursByPayType[col.value] > 0 ? row.hoursByPayType[col.value] : "—"}
                          </td>
                        ))}
                        <td className="py-1 pr-3 text-right text-ink">{row.totalHours}</td>
                        <td className="py-1 text-right text-ink">
                          {row.wageCost != null ? money(row.wageCost) : "—"}
                          {row.hasUncomputedHours && <span className="ml-1 text-amber-400">*</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line-row pt-2 text-xs text-ink-muted">
                <span>Total hours: {employee.totalHours}</span>
                <span>Total wages: {employee.totalWageCost != null ? money(employee.totalWageCost) : "—"}</span>
                {employee.perDiemTotal > 0 && <span>Per diem: {money(employee.perDiemTotal)}</span>}
                {employee.travelPayTotal > 0 && <span>Travel pay: {money(employee.travelPayTotal)}</span>}
              </div>
            </div>
          ))}

          <div className="rounded-lg border border-line-card bg-surface p-4 text-sm">
            <p className="text-ink">Week total: {weekTotalHours} hours across {employeeSummaries.length} employee(s)</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line-row pt-2 text-xs text-ink-muted">
              <span className="text-ink-body">Hours by day:</span>
              {hoursByDay.map(([iso, hours]) => (
                <span key={iso}>
                  {dayLabel(new Date(`${iso}T00:00:00.000Z`))} — {hours}
                </span>
              ))}
            </div>
            {anyUncomputed && (
              <p className="mt-1 text-xs text-amber-400">
                * Some hours have no craft tag or no effective fringe rate schedule and aren&rsquo;t priced above.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

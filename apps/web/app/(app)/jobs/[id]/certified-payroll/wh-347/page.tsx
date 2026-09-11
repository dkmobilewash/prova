// The WH-347 itself, laid out as the government form rather than as a
// report about it.
//
// The sibling page (../) stays exactly as it is, and the split is
// deliberate. That one is the WORKING view: hours by pay type, wage cost,
// per diem and travel, the things a payroll clerk checks before filing.
// This one is the FILING view: the federal form's own grid, its own
// column numbers, its own week. Two audiences, two documents. Merging
// them would mean the review screen gains column numbers nobody reviews
// by, or the filing gains columns the form has no box for.
//
// It deliberately refuses to look finished. Everything cstream cannot
// source is printed IN PLACE, in red, as a sentence — and the header
// carries a banner saying the form cannot be filed yet and why. A WH-347
// is signed under penalty of perjury; a blank box on one is
// indistinguishable from a zero to everyone except the person who filled
// it in. See lib/wh347.ts.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/money";
import { certifiedPayrollWeekStart } from "@/lib/certified-payroll-week";
import { loadCertifiedPayrollWeekEntries } from "@/lib/certified-payroll-query";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";
import {
  buildWh347,
  WH347_BLOCKING_FIELD_REASON,
  type Wh347TimeEntryInput,
} from "@/lib/wh347";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The form's own column heading: weekday over the date. */
function dayHeading(date: Date): { weekday: string; date: string } {
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" }),
    date: date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" }),
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Hours as the form prints them — 8, 7.5, never 8.00 and never 0. */
function hoursCell(hours: number | null): string {
  if (hours == null) return "";
  return String(Number(hours.toFixed(2)));
}

/** What goes where a number should have been. A sentence, not a dash:
 * the reader has to learn what to do about it. Same call worker-name.ts
 * makes with "Name not recorded". */
function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-medium leading-tight text-red-600">{children}</span>;
}

export default async function Wh347Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weekStart?: string }>;
}) {
  const { id } = await params;
  const { weekStart: weekStartParam } = await searchParams;
  // Same capability as the working view it prints from. This page shows
  // strictly less than that one — no per diem, no travel, no burdened
  // cost — so anything else would be an inconsistency, not a tightening.
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company } = context;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.companyId !== company.id) notFound();

  const requested = weekStartParam ? new Date(`${weekStartParam}T00:00:00.000Z`) : new Date();
  const weekStart = certifiedPayrollWeekStart(
    Number.isNaN(requested.getTime()) ? new Date() : requested,
  );

  const [entries, craftClassifications] = await Promise.all([
    loadCertifiedPayrollWeekEntries(company.id, job.id, weekStart),
    prisma.craftClassification.findMany({
      where: { unionLocal: { companyAgreements: { some: { companyId: company.id } } } },
      // Deterministic even though findEffectiveFringeRateSchedule no
      // longer depends on fetch order to break a same-day tie — #104
      // finding 3, so the raw list itself reads sensibly too.
      include: { fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } } },
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

  const wh347Entries: Wh347TimeEntryInput[] = entries.map((entry) => ({
    employeeUserId: entry.employeeUserId,
    // The identity, not a pre-formatted name: lib/wh347.ts owns the
    // "never an email on a filing" decision so both pages cannot drift.
    employee: { name: entry.employeeUser.name, email: entry.employeeUser.email },
    craftClassificationId: entry.craftClassificationId,
    craftLabel: entry.craftClassification
      ? `${entry.craftClassification.unionLocal.parentInternational} ${entry.craftClassification.unionLocal.localNumber} — ${entry.craftClassification.name}`
      : null,
    date: entry.date,
    hours: Number(entry.hours),
    payType: entry.payType,
  }));

  const form = buildWh347({
    company: {
      name: company.name,
      dbaName: company.dbaName,
      hqAddressLine1: company.hqAddressLine1,
      hqAddressLine2: company.hqAddressLine2,
      hqCity: company.hqCity,
      hqState: company.hqState,
      hqZip: company.hqZip,
    },
    job: { name: job.name },
    weekStart,
    entries: wh347Entries,
    fringeSchedulesByCraft,
  });

  const headings = form.days.map(dayHeading);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 print:px-0 print:py-0">
      <div className="print:hidden">
        <Link
          href={`/jobs/${job.id}/certified-payroll?weekStart=${isoDate(weekStart)}`}
          className="text-sm text-brand hover:underline"
        >
          ← Certified payroll for this week
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Form WH-347</h1>
            <p className="mt-1 text-sm text-slate-400">
              U.S. Department of Labor · Payroll · {job.name} · week ending{" "}
              {formatDate(form.header.weekEnding)}
            </p>
          </div>
          <PrintButton />
        </div>

        {/* Refusing to look finished is the point. This banner is the
            first thing on the page and names every column that is not
            ready, because the alternative is an office manager signing a
            form with an empty box in it. */}
        <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm font-semibold text-red-300">
            This is not ready to file. {form.blocking.length}{" "}
            {form.blocking.length === 1 ? "thing is" : "things are"} missing.
          </p>
          <p className="mt-1 text-xs text-red-200/80">
            The grid below is real — your hours are in the right boxes for the right days. What
            follows is every field the form requires that cstream cannot fill in yet.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {form.blocking.map((field) => (
              <li key={field} className="text-xs leading-snug text-red-200">
                {WH347_BLOCKING_FIELD_REASON[field]}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The form sheet. White, black text, printed borders — this is the
          only surface in the app that is not the dark product chrome,
          because it is a facsimile of a government document and a
          reviewer compares it against a pre-printed one. */}
      <div className="mt-6 border border-slate-300 bg-white p-6 text-black print:mt-0 print:border-0 print:p-0">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide">
            U.S. Department of Labor
          </p>
          <p className="text-lg font-bold">Payroll</p>
          <p className="text-[10px]">
            (For Contractor&apos;s Optional Use; See Instructions at
            www.dol.gov/whd/forms/wh347instr.htm)
          </p>
          <p className="mt-0.5 text-[10px] font-semibold">Form WH-347</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-y border-black py-2 text-[11px]">
          <div>
            <span className="font-semibold">Name of Contractor or Subcontractor: </span>
            {form.header.contractorName}
          </div>
          <div>
            <span className="font-semibold">Address: </span>
            {form.header.contractorAddress ?? (
              <Missing>No address on the company record. Settings → Company.</Missing>
            )}
          </div>
          <div>
            <span className="font-semibold">Payroll No.: </span>
            {form.header.payrollNumber ?? <Missing>Not issued — see the list above.</Missing>}
          </div>
          <div>
            <span className="font-semibold">For Week Ending: </span>
            {formatDate(form.header.weekEnding)}
          </div>
          <div>
            <span className="font-semibold">Project and Location: </span>
            {form.header.projectName}
            {form.header.projectLocation ? (
              ` — ${form.header.projectLocation}`
            ) : (
              <> · <Missing>No project location recorded.</Missing></>
            )}
          </div>
          <div>
            <span className="font-semibold">Project or Contract No.: </span>
            {form.header.contractNumber ?? <Missing>Not recorded on this job.</Missing>}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border border-black">
                <th className="border border-black px-1 py-1 text-left align-bottom">
                  (1) Name and Individual Identifying Number of Worker
                </th>
                <th className="w-8 border border-black px-1 py-1 align-bottom">
                  (2) No. of With&shy;holding Exemp&shy;tions
                </th>
                <th className="border border-black px-1 py-1 text-left align-bottom">
                  (3) Work Classification
                </th>
                <th
                  className="border border-black px-1 py-1 text-center"
                  colSpan={8}
                >
                  (4) Day and Date
                  <div className="mt-1 grid grid-cols-8 gap-px">
                    {headings.map((h, i) => (
                      <div key={i} className="border-t border-black pt-0.5">
                        <div className="font-semibold">{h.weekday}</div>
                        <div>{h.date}</div>
                      </div>
                    ))}
                    <div className="border-t border-black pt-0.5 font-semibold">
                      Hours Worked Each Day
                    </div>
                  </div>
                </th>
                <th className="w-10 border border-black px-1 py-1 align-bottom">
                  (5) Total Hours
                </th>
                <th className="w-14 border border-black px-1 py-1 align-bottom">
                  (6) Rate of Pay
                </th>
                <th className="w-16 border border-black px-1 py-1 align-bottom">
                  (7) Gross Amount Earned
                </th>
                <th className="w-20 border border-black px-1 py-1 align-bottom">(8) Deductions</th>
                <th className="w-16 border border-black px-1 py-1 align-bottom">
                  (9) Net Wages Paid for Week
                </th>
              </tr>
            </thead>
            <tbody>
              {form.workers.length === 0 && (
                <tr>
                  <td colSpan={14} className="border border-black px-2 py-6 text-center text-[11px]">
                    No hours were logged on this job for the week ending{" "}
                    {formatDate(form.header.weekEnding)}. A payroll is still owed for every week
                    the contract is active — file a &ldquo;no work&rdquo; payroll if nobody worked.
                  </td>
                </tr>
              )}
              {form.workers.map((worker) =>
                worker.hoursRows.map((row, rowIndex) => (
                  <tr key={`${worker.employeeUserId}-${row.payType}`}>
                    {rowIndex === 0 && (
                      <td
                        className="border border-black px-1 py-1 align-top"
                        rowSpan={worker.hoursRows.length}
                      >
                        <div className={worker.name === "Name not recorded" ? "text-red-600" : ""}>
                          {worker.name}
                        </div>
                        <Missing>ID number not recorded</Missing>
                      </td>
                    )}
                    {rowIndex === 0 && (
                      <td
                        className="border border-black px-1 py-1 text-center align-top"
                        rowSpan={worker.hoursRows.length}
                      />
                    )}
                    {rowIndex === 0 && (
                      <td
                        className="border border-black px-1 py-1 align-top"
                        rowSpan={worker.hoursRows.length}
                      >
                        <span
                          className={worker.classification === "Not tagged" ? "text-red-600" : ""}
                        >
                          {worker.classification}
                        </span>
                      </td>
                    )}
                    <td className="w-6 border border-black px-1 py-1 text-center font-semibold">
                      {row.label}
                    </td>
                    {row.days.map((cell, i) => (
                      <td key={i} className="border border-black px-1 py-1 text-center">
                        {hoursCell(cell.hours)}
                      </td>
                    ))}
                    <td className="border border-black px-1 py-1 text-center">
                      {hoursCell(row.totalHours)}
                    </td>
                    {rowIndex === 0 && (
                      <>
                        <td
                          className="border border-black px-1 py-1 text-right align-top"
                          rowSpan={worker.hoursRows.length}
                        >
                          {worker.baseHourlyRate != null ? (
                            <>
                              <div>{money(worker.baseHourlyRate)}</div>
                              <div className="text-[9px]">
                                + {money(worker.fringePerHour ?? 0)} fringe
                              </div>
                            </>
                          ) : (
                            <Missing>No rate schedule</Missing>
                          )}
                        </td>
                        <td
                          className="border border-black px-1 py-1 text-right align-top"
                          rowSpan={worker.hoursRows.length}
                        >
                          {worker.grossEarnedThisProject != null ? (
                            money(worker.grossEarnedThisProject)
                          ) : (
                            <Missing>Not derivable</Missing>
                          )}
                        </td>
                        <td
                          className="border border-black px-1 py-1 align-top"
                          rowSpan={worker.hoursRows.length}
                        >
                          <Missing>
                            FICA, withholding and other come off the payroll register. cstream does
                            not hold them.
                          </Missing>
                        </td>
                        <td
                          className="border border-black px-1 py-1 align-top"
                          rowSpan={worker.hoursRows.length}
                        >
                          <Missing>Gross less deductions.</Missing>
                        </td>
                      </>
                    )}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[10px]">
          <span className="font-semibold">Total hours this payroll: </span>
          {hoursCell(form.totalHours)}
        </p>

        {/* Page 2 does not exist. Saying so on the sheet, where somebody
            about to file will look for it, rather than only in the banner
            at the top of a scrolled page. */}
        <div className="mt-6 border-t-2 border-black pt-3">
          <p className="text-[11px] font-bold uppercase">Statement of Compliance</p>
          <p className="mt-1 text-[10px] text-red-600">
            Page 2 is not built yet. It is signed under penalty of perjury and states how fringe
            benefits were paid — 4(a) to approved plans, 4(b) in cash, 4(c) exceptions. Until it
            exists, this form cannot be filed no matter how complete the grid above looks.
          </p>
        </div>
      </div>
    </div>
  );
}

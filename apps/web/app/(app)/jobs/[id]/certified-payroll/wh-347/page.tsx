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

import { jobFormLocation } from "@/lib/job-form-location";
import {
  WH347_STATEMENT_BLOCKING_REASON,
  buildWh347Statement,
  wh347StatementCitation,
} from "@/lib/wh347-statement";
import { loadWh347Statement } from "@/lib/wh347-statement-query";
import { StatementOfComplianceForm } from "./StatementOfComplianceForm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatHours, formatHoursOrNull } from "@/lib/render-hours";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/money";
import { certifiedPayrollWeekStart } from "@/lib/certified-payroll-week";
import { timeEntryWorkerName, timeEntryWorkerId } from "@/lib/worker-name";
import { loadCertifiedPayrollWeekEntries } from "@/lib/certified-payroll-query";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";
import {
  buildWh347,
  wh347RegisterGapMessage,
  WH347_BLOCKING_FIELD_REASON,
  type Wh347Deductions,
  type Wh347RegisterMoney,
  type Wh347RegisterPeriod,
  type Wh347TimeEntryInput,
} from "@/lib/wh347";
import { shortDate } from "@/lib/payroll-register-import";
import { IssuePayrollNumberButton } from "./IssuePayrollNumberButton";

/** cents -> dollars, for display only. Every other number wh347.ts works
 * in is a dollar figure (baseHourlyRate, grossEarnedThisProject…), so the
 * register's cents are converted at this one boundary rather than teaching
 * the form module a second unit. Nothing here is stored or recomputed. */
function dollars(cents: number): number {
  return cents / 100;
}

/** Column 1's identifying number as it should print: the recorded last-4
 * wins (it is the actual federal identifier), an employee number is the
 * fallback so a crew member payroll hasn't reached yet can still print
 * something the company already has on the register. */
function printedIdentifyingNumber(crew: {
  identifyingNumberLast4: string | null;
  employeeNumber: string | null;
}): string | null {
  if (crew.identifyingNumberLast4) return `…${crew.identifyingNumberLast4}`;
  return crew.employeeNumber;
}

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

/** Hours as the FORM prints them: blank for a day nobody worked, because
 * a dash in a box a federal reviewer reads as a number is worse than an
 * empty one. The rounding itself is `lib/render-hours.ts` — this is only
 * the empty-cell decision. */
function hoursCell(hours: number | null): string {
  return formatHoursOrNull(hours, "");
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
  const weekEnding = new Date(weekStart);
  weekEnding.setUTCDate(weekEnding.getUTCDate() + 6);

  // Cheap, bounded window for explaining a gap — never fed into buildWh347.
  // 45 days each side comfortably covers a register one week off (Monday
  // start), biweekly, semi-monthly and monthly cadences without loading a
  // crew member's whole history.
  const nearbyWindowStart = new Date(weekStart);
  nearbyWindowStart.setUTCDate(nearbyWindowStart.getUTCDate() - 45);
  const nearbyWindowEnd = new Date(weekEnding);
  nearbyWindowEnd.setUTCDate(nearbyWindowEnd.getUTCDate() + 45);

  const [entries, craftClassifications, crew, registerRows, issuedNumber, nearbyRegisterRows, statementRow] = await Promise.all([
    loadCertifiedPayrollWeekEntries(company.id, job.id, weekStart),
    prisma.craftClassification.findMany({
      where: { unionLocal: { companyAgreements: { some: { companyId: company.id } } } },
      // Deterministic even though findEffectiveFringeRateSchedule no
      // longer depends on fetch order to break a same-day tie — #104
      // finding 3, so the raw list itself reads sensibly too.
      include: { fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } } },
    }),
    // Column 1's identifying number, per crew member: keyed by the same
    // worker id timeEntryWorkerId uses (linkedUserId when the crew member
    // has a login, the crew member's own id otherwise) so it joins onto
    // wh347Entries without a second lookup at render time.
    prisma.crewMember.findMany({
      where: { companyId: company.id },
      select: { id: true, linkedUserId: true, employeeNumber: true, identifyingNumberLast4: true },
    }),
    // Columns 8/9, off the register — ONLY a period that exactly matches
    // this WH-347 week. A register period that merely overlaps is not
    // this week's paycheck; buildWh347 blocks a worker absent here rather
    // than guess at a partial week.
    prisma.payrollRegisterEntry.findMany({
      where: { companyId: company.id, periodStart: weekStart, periodEnd: weekEnding },
      select: {
        crewMemberId: true,
        grossCents: true,
        deductionsCents: true,
        netCents: true,
        deductionsDetail: true,
        crewMember: { select: { linkedUserId: true } },
      },
    }),
    prisma.wh347PayrollNumber.findUnique({
      where: { jobId_weekStart: { jobId: job.id, weekStart } },
      select: { number: true },
    }),
    // Purely to EXPLAIN a gap in columns 8/9 — "nothing imported" and
    // "imported, wrong week" must not read the same (see
    // wh347RegisterGapMessage). This is not this week's money and never
    // feeds buildWh347; the exact-match query above stays the only source
    // of that.
    prisma.payrollRegisterEntry.findMany({
      where: {
        companyId: company.id,
        periodStart: { gte: nearbyWindowStart, lte: nearbyWindowEnd },
      },
      select: {
        periodStart: true,
        periodEnd: true,
        crewMember: { select: { linkedUserId: true, id: true } },
      },
    }),
    // Page 2's own row. Null when nobody has filled it in, which is the
    // ordinary state and not an error — buildWh347Statement reports every
    // fact as blocking and the form below opens empty.
    loadWh347Statement(job.id, weekStart),
  ]);

  // Built BEFORE buildWh347, because page 1's blocking list asks this whether
  // page 2 is ready. The payroll period is the same two dates page 1 prints,
  // handed over rather than derived again: a period computed twice is a period
  // free to disagree with itself across two pages of one filing.
  const statement = buildWh347Statement({
    contractorName: company.dbaName ?? company.name,
    projectName: job.name,
    projectLocation: jobFormLocation(job),
    payrollNumber: issuedNumber?.number ?? null,
    periodStart: weekStart,
    periodEnd: weekEnding,
    statement: statementRow,
  });

  const identifyingNumbers = new Map<string, string>();
  for (const c of crew) {
    const printed = printedIdentifyingNumber(c);
    if (!printed) continue;
    identifyingNumbers.set(c.linkedUserId ?? c.id, printed);
  }

  const registerMoney = new Map<string, Wh347RegisterMoney>();
  for (const row of registerRows) {
    const detail = (row.deductionsDetail ?? null) as {
      ficaCents?: number;
      federalTaxCents?: number;
      stateTaxCents?: number;
      otherCents?: number;
    } | null;
    const fica = detail?.ficaCents != null ? dollars(detail.ficaCents) : null;
    const withholding =
      detail?.federalTaxCents != null || detail?.stateTaxCents != null
        ? dollars((detail?.federalTaxCents ?? 0) + (detail?.stateTaxCents ?? 0))
        : null;
    const other = detail?.otherCents != null ? dollars(detail.otherCents) : null;
    const deductions: Wh347Deductions = { fica, withholdingTax: withholding, other, total: dollars(row.deductionsCents) };
    registerMoney.set(row.crewMember.linkedUserId ?? row.crewMemberId, {
      deductions,
      netWages: dollars(row.netCents),
    });
  }

  // Per worker, the register period closest to THIS week — used only to
  // explain a blank columns 8/9 cell, never to fill one. A worker with
  // several nearby periods (e.g. a biweekly register spanning both
  // neighbours) gets the single closest one, which is the one most likely
  // to be "the file I just imported, for the wrong week".
  const nearbyRegisterPeriod = new Map<string, Wh347RegisterPeriod>();
  const nearbyDistance = new Map<string, number>();
  for (const row of nearbyRegisterRows) {
    const workerId = row.crewMember.linkedUserId ?? row.crewMember.id;
    const distance = Math.abs(row.periodStart.getTime() - weekStart.getTime());
    const current = nearbyDistance.get(workerId);
    if (current !== undefined && current <= distance) continue;
    nearbyDistance.set(workerId, distance);
    nearbyRegisterPeriod.set(workerId, {
      periodStart: shortDate(isoDate(row.periodStart)),
      periodEnd: shortDate(isoDate(row.periodEnd)),
    });
  }
  const formPeriod: Wh347RegisterPeriod = {
    periodStart: shortDate(isoDate(weekStart)),
    periodEnd: shortDate(isoDate(weekEnding)),
  };

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
    employeeUserId: timeEntryWorkerId(entry),
    // The identity, not a pre-formatted name: lib/wh347.ts owns the
    // "never an email on a filing" decision so both pages cannot drift. A
    // crew member has no email, so their name is passed directly.
    employee: entry.employeeUser
      ? { name: entry.employeeUser.name, email: entry.employeeUser.email }
      : { name: timeEntryWorkerName(entry).label, email: "" },
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
    // `location` was never passed, so the header's PROJECT AND LOCATION was
    // always blank and always blocking — while the message on screen told the
    // reader to record the job's site address, which changed nothing. Both
    // columns were on the row this page already loads. Through the same
    // helper the DAS forms use, so two government documents for one job
    // cannot disagree about where it is.
    job: {
      name: job.name,
      location: jobFormLocation(job),
      // The header's CONTRACT NO. This blocked unconditionally until
      // `Job.contractNumber` existed, and the sentence beside it said "A job
      // does not record one" — true, and it meant no week could ever be filed
      // however complete the grid was.
      contractNumber: job.contractNumber,
    },
    // Page 2's facts, from the one module that decides whether they are all
    // there. Page 1's banner and page 2's own list cannot disagree, because
    // both read this.
    statementComplete: statement.complete,
    weekStart,
    entries: wh347Entries,
    fringeSchedulesByCraft,
    payrollNumber: issuedNumber?.number ?? null,
    identifyingNumbers,
    registerMoney,
  });

  const headings = form.days.map(dayHeading);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 print:px-0 print:py-0">
      <div className="print:hidden">
        <Link
          href={`/jobs/${job.id}/certified-payroll?weekStart=${isoDate(weekStart)}`}
          className="text-sm text-link hover:underline"
        >
          ← Certified payroll for this week
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Form WH-347</h1>
            <p className="mt-1 text-sm text-ink-body">
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
        {form.blocking.length > 0 ? (
          <div className="mt-5 rounded-lg border border-red-300 bg-tag-rose p-4">
            <p className="text-sm font-semibold text-tag-rose-ink">
              This is not ready to file. {form.blocking.length}{" "}
              {form.blocking.length === 1 ? "thing is" : "things are"} missing.
            </p>
            <p className="mt-1 text-xs text-tag-rose-ink/80">
              The grid below is real — your hours are in the right boxes for the right days. What
              follows is every field the form requires that C Stream cannot fill in yet.
            </p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {form.blocking.map((field) => (
                <li key={field} className="text-xs leading-snug text-tag-rose-ink">
                  {field === "hoursOutsideWeek"
                    ? `${formatHours(form.hoursOutsideWeek)} ${form.hoursOutsideWeek === 1 ? "hour falls" : "hours fall"} outside this week's grid. ${WH347_BLOCKING_FIELD_REASON[field]}`
                    : WH347_BLOCKING_FIELD_REASON[field]}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          /* THE OTHER BRANCH, which no code path could reach until page 2
             existed. The banner above was rendered unconditionally, so the
             first week that cleared would have printed "This is not ready to
             file. 0 things are missing." over an empty list — a red panel
             saying nothing is wrong. Nothing would have caught it: `fileable`
             had never once been true. */
          <div className="mt-5 rounded-lg border border-green-800 bg-tag-green p-4">
            <p className="text-sm font-semibold text-tag-green-ink">
              Every field this form needs is filled in.
            </p>
            <p className="mt-1 text-xs text-tag-green-ink/80">
              Print it, read page 2, and sign it. C Stream has not checked page 2&rsquo;s wording
              against the current form from the Department of Labor — the paragraphs below are
              reproduced, not transcribed, so read them before you sign.
            </p>
          </div>
        )}

        <StatementOfComplianceForm
          jobId={job.id}
          weekStartIso={isoDate(weekStart)}
          signatoryName={statement.signatoryName}
          signatoryTitle={statement.signatoryTitle}
          fringeMode={statement.fringeMode}
          remarks={statement.remarks}
          exceptions={statementRow?.exceptions ?? []}
        />
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
              <Missing>
                No address on the company record. An owner records it at Settings → Company.
              </Missing>
            )}
          </div>
          <div>
            <span className="font-semibold">Payroll No.: </span>
            {form.header.payrollNumber ?? (
              <>
                <Missing>Not issued yet.</Missing>{" "}
                <IssuePayrollNumberButton jobId={job.id} weekStart={isoDate(weekStart)} />
              </>
            )}
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
                        {worker.identifyingNumber ?? (
                          <Missing>
                            ID number not recorded. Record a last-4 or employee number on the crew
                            list.
                          </Missing>
                        )}
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
                          {worker.paycheckOnFirstLine ? (
                            <span className="text-[9px] text-slate-600">
                              See {worker.name}&apos;s first line — one paycheck.
                            </span>
                          ) : worker.deductions != null ? (
                            <>
                              <div>{money(worker.deductions.total)}</div>
                              {/* The form's own 8a/8b/8c breakdown. A null sub-figure
                                  prints nothing rather than $0.00 — the register did
                                  not itemise it, which is a different claim from
                                  itemising a zero. */}
                              {worker.deductions.fica != null && (
                                <div className="text-[9px]">FICA {money(worker.deductions.fica)}</div>
                              )}
                              {worker.deductions.withholdingTax != null && (
                                <div className="text-[9px]">
                                  W/H {money(worker.deductions.withholdingTax)}
                                </div>
                              )}
                              {worker.deductions.other != null && (
                                <div className="text-[9px]">Other {money(worker.deductions.other)}</div>
                              )}
                            </>
                          ) : (
                            <Missing>
                              {wh347RegisterGapMessage(
                                worker.name,
                                formPeriod,
                                nearbyRegisterPeriod.get(worker.employeeUserId) ?? null,
                              )}
                            </Missing>
                          )}
                        </td>
                        <td
                          className="border border-black px-1 py-1 align-top"
                          rowSpan={worker.hoursRows.length}
                        >
                          {worker.paycheckOnFirstLine ? (
                            ""
                          ) : worker.netWagesThisWeek != null ? (
                            money(worker.netWagesThisWeek)
                          ) : (
                            <Missing>
                              {wh347RegisterGapMessage(
                                worker.name,
                                formPeriod,
                                nearbyRegisterPeriod.get(worker.employeeUserId) ?? null,
                              )}
                            </Missing>
                          )}
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

        {/* PAGE 2, on its own sheet of paper.
            `print:break-before-page` is the convention this repo already uses
            for one document per page — union-compliance/remittance does the
            same per local. On screen it reads as a continuation; on paper it
            is the second page the filing needs. */}
        <div className="mt-8 border-t-2 border-black pt-4 print:mt-0 print:break-before-page print:border-t-0 print:pt-0">
          <p className="text-center text-[11px] font-bold uppercase">Statement of Compliance</p>

          <p className="mt-3 text-[10px]">
            Date <span className="border-b border-black px-8">&nbsp;</span>
          </p>

          {/* The opening line, with the two facts the app holds printed into
              it. `Missing` is the page's own red in-place refusal, reused so an
              unfilled box reads the same here as in the grid above. */}
          <p className="mt-3 text-[10px] leading-relaxed">
            I,{" "}
            <span className="font-semibold underline">
              {statement.signatoryName ?? <Missing>{WH347_STATEMENT_BLOCKING_REASON.signatoryName}</Missing>}
            </span>
            ,{" "}
            <span className="font-semibold underline">
              {statement.signatoryTitle ?? <Missing>{WH347_STATEMENT_BLOCKING_REASON.signatoryTitle}</Missing>}
            </span>
            , do hereby state:
          </p>

          <p className="mt-2 text-[10px] leading-relaxed">
            (1) That I pay or supervise the payment of the persons employed by{" "}
            <span className="font-semibold">{statement.contractorName}</span> on the{" "}
            <span className="font-semibold">{statement.projectName}</span>; that during the payroll
            period commencing on the{" "}
            <span className="font-semibold">{shortDate(isoDate(statement.periodStart))}</span> and ending
            the <span className="font-semibold">{shortDate(isoDate(statement.periodEnd))}</span>, all
            persons employed on said project have been paid the full weekly wages earned, that no
            rebates have been or will be made either directly or indirectly to or on behalf of said
            contractor or subcontractor from the full weekly wages earned by any person, and that no
            deductions have been made either directly or indirectly from the full wages earned by any
            person, other than permissible deductions as defined in Regulations, Part 3 (29 CFR
            Subtitle A), issued by the Secretary of Labor under the Copeland Act, as amended.
          </p>

          <p className="mt-2 text-[10px] leading-relaxed">
            {wh347StatementCitation("paragraph-2").text}
          </p>
          <p className="mt-2 text-[10px] leading-relaxed">
            {wh347StatementCitation("paragraph-3").text}
          </p>

          {/* Section 4 prints the ELECTED paragraph and only that one. Printing
              both would leave a reader to decide which applies, which is the
              contractor's statement to make. */}
          <p className="mt-2 text-[10px] leading-relaxed">
            {statement.fringeParagraph ? (
              statement.fringeParagraph.text
            ) : (
              <Missing>{WH347_STATEMENT_BLOCKING_REASON.fringeMode}</Missing>
            )}
          </p>

          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase">(4)(c) Exceptions</p>
            {statement.exceptions.length === 0 ? (
              <p className="mt-1 text-[10px]">None.</p>
            ) : (
              <table className="mt-1 w-full border border-black text-[10px]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left font-bold uppercase">
                      Exception (craft)
                    </th>
                    <th className="border border-black px-1 py-0.5 text-left font-bold uppercase">
                      Explanation
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statement.exceptions.map((exception, index) => (
                    <tr key={`${exception.craftName}-${index}`}>
                      <td className="border border-black px-1 py-0.5 align-top">
                        {exception.craftName}
                      </td>
                      <td className="border border-black px-1 py-0.5 align-top">
                        {exception.explanation ?? (
                          <Missing>{WH347_STATEMENT_BLOCKING_REASON.exceptionExplanation}</Missing>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase">Remarks</p>
            <p className="mt-1 min-h-[2.5rem] whitespace-pre-wrap border-b border-black text-[10px]">
              {statement.remarks ?? ""}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-6 text-[10px]">
            <div>
              <p className="border-b border-black pb-4">
                {statement.signatoryName ?? ""}
                {statement.signatoryTitle ? `, ${statement.signatoryTitle}` : ""}
              </p>
              <p className="mt-0.5 font-bold uppercase">Name and title</p>
            </div>
            <div>
              {/* Deliberately blank. Nothing in this app records that anybody
                  signed a federal certification — see lib/wh347-statement.ts. */}
              <p className="border-b border-black pb-4">&nbsp;</p>
              <p className="mt-0.5 font-bold uppercase">Signature</p>
            </div>
          </div>

          <p className="mt-4 text-[9px] font-bold uppercase leading-snug">
            {wh347StatementCitation("falsification-warning").text}
          </p>

          {/* The disclosure, printed rather than screen-only, and the same call
              the pay application makes about being G702/G703-STYLE: the reader
              who signs this is the one who needs to know it was reproduced. */}
          {statement.proseUnverified && (
            <p className="mt-3 border-t border-black pt-2 text-[9px] leading-snug">
              The paragraphs above are reproduced by C Stream and have NOT been checked against the
              current Form WH-347 published by the U.S. Department of Labor. Read them against the
              official form before signing. This is a WH-347-style Statement of Compliance, not the
              government form itself.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

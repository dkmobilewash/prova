import { money } from "@/lib/money";
import type { Wh347Form, Wh347WorkerLine } from "@/lib/wh347";
import { buildSampleWh347 } from "@/lib/sample-wh347";
import { DEMO_JOB, PanelFrame, calendarDate, hoursCell } from "./panelChrome";

/**
 * One week's Form WH-347, as `app/(app)/jobs/[id]/certified-payroll/wh-347/page.tsx`
 * lays it out: the federal form's own grid, column numbers and week, on a
 * white sheet with black rules — the one surface in the app that is not the
 * dark chrome, because it is a facsimile of a government document. That is
 * followed here for the same reason.
 *
 * THE FORM IS BUILT BY `buildWh347`, not drawn by hand. The inputs below are
 * time entries (one worker, one craft, one day, one pay type, some hours), a
 * fringe rate schedule per craft, an identifying number per crew record and
 * the week's payroll register row per worker — the same inputs the page
 * assembles from Prisma. lib/wh347.ts then groups by day, puts overtime on
 * its own "O" row above straight time's "S" (the form's order), derives
 * column (6) as base rate WITH the fringe shown beside it, and computes
 * column (7) as CASH wages — base × multiplier × hours, fringe excluded —
 * which is the distinction the product is deliberate about and this
 * rendering therefore cannot get wrong.
 *
 * WHAT IS DELIBERATELY NOT HERE. This list has been CORRECTED: all three of
 * its entries described things the product did not hold, and two of the three
 * stopped being true while the sentence stayed.
 *   - "Project and Location" and "Project or Contract No." — this said
 *     "neither is on the Job model yet". BOTH ARE NOW: `Job.siteAddress` /
 *     `Job.projectLocation` (read through `jobFormLocation`) and
 *     `Job.contractNumber`. Still omitted from THIS PANEL, which is a
 *     marketing rendering off hardcoded inputs and has no job behind it — a
 *     different reason from the one that used to be written here.
 *   - Page 2, the Statement of Compliance — this said "It is not built, and
 *     lib/wh347.ts marks every form not fileable until it is." IT IS BUILT.
 *     `blocking.add("statementOfCompliance")` is conditional now, so
 *     `fileable` can be true. This panel still shows page 1 only, because one
 *     sheet is the marketing beat; it just no longer implies page 2 is
 *     missing from the product.
 *
 * Nothing here says or implies "ready to file", which is the part of the
 * original note that was about this component rather than about the app, and
 * the only part that needed no correction.
 * Column (2), withholding exemptions, is blank on the real sheet and blank
 * here.
 *
 * Two renderings of the same `Wh347Form`, one shown at a time by panel width
 * (see PanelFrame): the true 14-column form from 40rem up, and below that a
 * reflow where each worker's identity, classification, rate, gross,
 * deductions and net sit on a full-width row above their 7-day grid — the
 * grid is 9 narrow columns and fits a phone without sideways scrolling. Same
 * data, same labels, different shape; nothing is dropped.
 */

/** The marketing sheet is the shared sample crew under the demo contractor
 * — see `lib/sample-wh347.ts`, which the sales team's per-prospect sample
 * also uses, so one crew serves both and cannot drift. */
function buildForm(): Wh347Form {
  return buildSampleWh347({
    contractorName: DEMO_JOB.contractor,
    addressLine1: "2200 Commerce Dr",
    city: "Reno",
    state: "NV",
    zip: "89502",
    projectName: DEMO_JOB.name,
    payrollNumber: 14,
  });
}

/** The form's own column heading: weekday letter over the date, as `dayHeading` does. */
function dayHeading(date: Date): { weekday: string; date: string } {
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" }),
    date: date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" }),
  };
}

const cell = "border border-black px-1 py-1";
/** The narrow sheet's grid cells: nine columns have to fit ~280px on a
 * phone, so the horizontal padding comes down. */
const tight = "border border-black px-0.5 py-1";

function RateCell({ worker }: { worker: Wh347WorkerLine }) {
  return (
    <>
      <div className="tabular-nums">{money(worker.baseHourlyRate ?? 0)}</div>
      <div className="text-[9px] tabular-nums">+ {money(worker.fringePerHour ?? 0)} fringe</div>
    </>
  );
}

function DeductionsCell({ worker }: { worker: Wh347WorkerLine }) {
  const d = worker.deductions;
  if (!d) return null;
  return (
    <>
      <div className="tabular-nums">{money(d.total)}</div>
      {d.fica != null && <div className="text-[9px] tabular-nums">FICA {money(d.fica)}</div>}
      {d.withholdingTax != null && <div className="text-[9px] tabular-nums">W/H {money(d.withholdingTax)}</div>}
      {d.other != null && <div className="text-[9px] tabular-nums">Other {money(d.other)}</div>}
    </>
  );
}

/** The form as printed: fourteen columns, one paper. Shown from 40rem. */
function FullSheet({ form }: { form: Wh347Form }) {
  const headings = form.days.map(dayHeading);
  return (
    <table className="hidden w-full border-collapse text-[11px] [@container(min-width:40rem)]:table">
      <caption className="sr-only">Form WH-347 payroll grid, week ending {calendarDate(form.header.weekEnding)}</caption>
      <thead>
        <tr>
          <th scope="col" rowSpan={2} className={`${cell} text-left align-bottom`}>
            (1) Name and Individual Identifying Number of Worker
          </th>
          <th scope="col" rowSpan={2} className={`${cell} w-8 align-bottom font-semibold`}>
            (2) No. of With&shy;holding Exemp&shy;tions
          </th>
          <th scope="col" rowSpan={2} className={`${cell} text-left align-bottom`}>
            (3) Work Classification
          </th>
          <th scope="colgroup" colSpan={8} className={`${cell} text-center`}>
            (4) Day and Date
            <div className="text-[9px] font-normal">Hours Worked Each Day</div>
          </th>
          <th scope="col" rowSpan={2} className={`${cell} w-10 align-bottom`}>
            (5) Total Hours
          </th>
          <th scope="col" rowSpan={2} className={`${cell} w-14 align-bottom`}>
            (6) Rate of Pay
          </th>
          <th scope="col" rowSpan={2} className={`${cell} w-16 align-bottom`}>
            (7) Gross Amount Earned
          </th>
          <th scope="col" rowSpan={2} className={`${cell} w-20 align-bottom`}>
            (8) Deductions
          </th>
          <th scope="col" rowSpan={2} className={`${cell} w-16 align-bottom`}>
            (9) Net Wages Paid for Week
          </th>
        </tr>
        <tr>
          <th className={`${cell} w-6`} aria-label="Pay type" />
          {headings.map((h, i) => (
            <th key={i} scope="col" className={`${cell} text-center font-normal`}>
              <div className="font-semibold">{h.weekday}</div>
              <div className="tabular-nums">{h.date}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {form.workers.map((worker) =>
          worker.hoursRows.map((row, rowIndex) => (
            <tr key={`${worker.employeeUserId}-${row.payType}`}>
              {rowIndex === 0 && (
                <th scope="rowgroup" rowSpan={worker.hoursRows.length} className={`${cell} text-left align-top font-normal`}>
                  <div>{worker.name}</div>
                  <div className="tabular-nums">{worker.identifyingNumber}</div>
                </th>
              )}
              {rowIndex === 0 && <td rowSpan={worker.hoursRows.length} className={`${cell} align-top`} />}
              {rowIndex === 0 && (
                <td rowSpan={worker.hoursRows.length} className={`${cell} align-top`}>
                  {worker.classification}
                </td>
              )}
              <td className={`${cell} text-center font-semibold`}>{row.label}</td>
              {row.days.map((day, i) => (
                <td key={i} className={`${cell} text-center tabular-nums`}>
                  {hoursCell(day.hours)}
                </td>
              ))}
              <td className={`${cell} text-center tabular-nums`}>{hoursCell(row.totalHours)}</td>
              {rowIndex === 0 && (
                <>
                  <td rowSpan={worker.hoursRows.length} className={`${cell} text-right align-top`}>
                    <RateCell worker={worker} />
                  </td>
                  <td rowSpan={worker.hoursRows.length} className={`${cell} text-right align-top tabular-nums`}>
                    {money(worker.grossEarnedThisProject ?? 0)}
                  </td>
                  <td rowSpan={worker.hoursRows.length} className={`${cell} text-right align-top`}>
                    <DeductionsCell worker={worker} />
                  </td>
                  <td rowSpan={worker.hoursRows.length} className={`${cell} text-right align-top tabular-nums`}>
                    {money(worker.netWagesThisWeek ?? 0)}
                  </td>
                </>
              )}
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

/** The same form reflowed for a narrow panel: each worker's columns (1),
 * (3), (6), (7), (8) and (9) on one full-width row, their (4)/(5) grid
 * beneath. Hidden from 40rem, where the true layout takes over. */
function NarrowSheet({ form }: { form: Wh347Form }) {
  const headings = form.days.map(dayHeading);
  return (
    <table className="w-full border-collapse text-[11px] [@container(min-width:40rem)]:hidden">
      <caption className="sr-only">Form WH-347 payroll grid, week ending {calendarDate(form.header.weekEnding)}</caption>
      <thead>
        <tr>
          <th scope="col" className={`${tight} w-6 text-[9px] font-normal`} aria-label="Pay type">
            (4)
          </th>
          {headings.map((h, i) => (
            <th key={i} scope="col" className={`${tight} text-center font-normal`}>
              <div className="font-semibold">{h.weekday}</div>
              <div className="tabular-nums">{h.date}</div>
            </th>
          ))}
          <th scope="col" className={`${tight} text-center align-bottom text-[9px] font-semibold`}>
            (5) Total
          </th>
        </tr>
      </thead>
      {form.workers.map((worker) => (
        <tbody key={worker.employeeUserId}>
          <tr>
            <th scope="colgroup" colSpan={9} className={`${cell} border-t-2 text-left font-normal`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span>
                  <span className="font-semibold">{worker.name}</span>{" "}
                  <span className="tabular-nums">{worker.identifyingNumber}</span>
                </span>
                <span>{worker.classification}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                <span>
                  (6) {money(worker.baseHourlyRate ?? 0)} + {money(worker.fringePerHour ?? 0)} fringe
                </span>
                <span>(7) Gross {money(worker.grossEarnedThisProject ?? 0)}</span>
                <span>(8) Deductions {money(worker.deductions?.total ?? 0)}</span>
                <span>(9) Net {money(worker.netWagesThisWeek ?? 0)}</span>
              </div>
            </th>
          </tr>
          {worker.hoursRows.map((row) => (
            <tr key={row.payType}>
              <th scope="row" className={`${tight} text-center font-semibold`}>
                {row.label}
              </th>
              {row.days.map((day, i) => (
                <td key={i} className={`${tight} text-center tabular-nums`}>
                  {hoursCell(day.hours)}
                </td>
              ))}
              <td className={`${tight} text-center tabular-nums`}>{hoursCell(row.totalHours)}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}


/**
 * The sheet. White, black text, printed rules — a facsimile of a government
 * document, as the product renders it. Not themed on purpose: paper is paper
 * in both themes. Exported so the sales team's per-prospect sample
 * (`app/(app)/sales/[id]/sample-wh347`) renders the identical sheet, with a
 * `stamp` across the corner that the marketing panel does not need.
 */
export function Wh347SheetBody({ form, stamp }: { form: Wh347Form; stamp?: string }) {
  const weekEnding = calendarDate(form.header.weekEnding);
  return (
    <>
      <div className="relative border border-slate-300 bg-white p-3 text-black [@container(min-width:40rem)]:p-4">
        {stamp ? (
          <p className="absolute right-3 top-3 rotate-[-8deg] border-2 border-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-600">
            {stamp}
          </p>
        ) : null}
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wide">U.S. Department of Labor</p>
          <p className="text-base font-bold leading-tight">Payroll</p>
          <p className="text-[10px] font-semibold">Form WH-347</p>
        </div>

        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 border-y border-black py-2 text-[11px] [@container(min-width:24rem)]:grid-cols-2">
          <div>
            <dt className="inline font-semibold">Name of Contractor or Subcontractor: </dt>
            <dd className="inline">{form.header.contractorName}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Address: </dt>
            <dd className="inline">{form.header.contractorAddress}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Payroll No.: </dt>
            <dd className="inline tabular-nums">{form.header.payrollNumber}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">For Week Ending: </dt>
            <dd className="inline tabular-nums">{weekEnding}</dd>
          </div>
        </dl>

        <div className="mt-3 overflow-x-auto">
          <FullSheet form={form} />
          <NarrowSheet form={form} />
        </div>

        <p className="mt-2 text-[11px]">
          <span className="font-semibold">Total hours this payroll: </span>
          <span className="tabular-nums">{hoursCell(form.totalHours)}</span>
        </p>
      </div>
    </>
  );
}

export function CertifiedPayrollPanel({ className }: { className?: string }) {
  const form = buildForm();
  const weekEnding = calendarDate(form.header.weekEnding);

  return (
    <PanelFrame
      title="Form WH-347"
      meta={`U.S. Department of Labor · Payroll · ${DEMO_JOB.name} · week ending ${weekEnding}`}
      caption="Page 1 of the form, built from logged hours and the imported payroll register: hours by day, rate and fringe, cash wages, deductions and net."
      className={className}
    >
      <Wh347SheetBody form={form} />
    </PanelFrame>
  );
}

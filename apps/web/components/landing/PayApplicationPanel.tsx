import { money } from "@/lib/money";
import {
  calculatePayAppLineItem,
  calculatePayAppSummary,
  type PayAppLineItemInput,
} from "@/lib/pay-application";
import { DEMO_JOB, PanelFrame, Tile, calendarDate, sheetPercent, utcDay } from "./panelChrome";

/**
 * A pay application, as `app/(app)/jobs/[id]/pay-applications/[invoiceId]/page.tsx`
 * renders it: the G702-style summary block (seven fields, in that page's
 * order, with "Current payment due" carrying the same green emphasis) over the
 * G703-style continuation sheet (eight columns, header text verbatim).
 *
 * THE NUMBERS ARE COMPUTED, NOT TYPED. The four rows below are the same shape
 * `loadPayApplication` hands the page — scheduled value, what earlier
 * applications billed, this period, stored materials as a per-period delta —
 * and `calculatePayAppLineItem` / `calculatePayAppSummary` from
 * lib/pay-application.ts turn them into every figure on screen. Retainage is
 * the real shape too: `submitPayApplication` snapshots
 * `Job.retainagePercent × amount` onto each invoice, and the summary sums
 * those snapshots, so "Retainage to date" here is 10% of everything billed and
 * stored to date, the way the product would compute it.
 *
 * WHAT IS DELIBERATELY NOT HERE. No per-line retainage column and no
 * "period to" date: the product carries retainage at the summary level only,
 * and the real page says on screen that C Stream records no period-ending
 * date and prints the application date instead. Both are followed rather than
 * embellished.
 *
 * Columns are shown by the PANEL's width, not the viewport (see PanelFrame):
 * on a phone the scheduled value sits under the description and only "This
 * period" and "Total to date" take columns; the scheduled value gets its own
 * column from 24rem, the percent from 30rem, all eight from 40rem. Nothing is
 * invented to fill a column; narrow widths simply show fewer of the real ones.
 */

const RETAINAGE_PERCENT = 10;

/** Three earlier applications are behind this one. `previousBilled` and
 * `previousMaterialsStored` are the sums the query builds across them. */
const SOV_LINES: PayAppLineItemInput[] = [
  {
    lineItemId: "framing-l2",
    description: "Metal stud framing — L2",
    scheduledValue: 184_000,
    previousBilled: 128_800,
    thisPeriodBilled: 36_800,
    previousMaterialsStored: 0,
    materialsStoredValue: 0,
  },
  {
    lineItemId: "drywall-l2",
    description: "Drywall hang & finish — L2",
    scheduledValue: 212_500,
    previousBilled: 85_000,
    thisPeriodBilled: 53_125,
    previousMaterialsStored: 0,
    materialsStoredValue: 9_600,
  },
  {
    lineItemId: "ceilings-l2",
    description: "Acoustical ceilings — L2",
    scheduledValue: 96_400,
    previousBilled: 0,
    thisPeriodBilled: 19_280,
    previousMaterialsStored: 0,
    materialsStoredValue: 0,
  },
  {
    lineItemId: "shaftwall",
    description: "Fire-rated shaftwall",
    scheduledValue: 74_200,
    previousBilled: 22_260,
    thisPeriodBilled: 14_840,
    previousMaterialsStored: 0,
    materialsStoredValue: 0,
  },
];

const APPLICATION_NUMBER = 4;
const APPLICATION_DATE = utcDay("2026-08-31");

function buildPayApplication() {
  const lineItems = SOV_LINES.map(calculatePayAppLineItem);

  // Exactly what submitPayApplication stores: the invoice amount is the sum of
  // this period's billed and newly stored values, and the retainage held back
  // on it is the job's rate applied to that amount. Earlier invoices did the
  // same, so their held-back total is the rate applied to what they billed
  // and stored. (This panel reads no retainage column — it applies the rate
  // to illustrative amounts; the company-wide figure lives in
  // lib/retainage-query.ts and nowhere else.)
  const thisPeriodAmount = SOV_LINES.reduce(
    (sum, line) => sum + line.thisPeriodBilled + line.materialsStoredValue,
    0,
  );
  const previousAmount = SOV_LINES.reduce(
    (sum, line) => sum + line.previousBilled + line.previousMaterialsStored,
    0,
  );
  const withheld = (amount: number) => Number(((amount * RETAINAGE_PERCENT) / 100).toFixed(2));

  // `retainagePercent:` was passed here and `PayAppSummaryInput` no longer
  // has the field. #409 removed it deliberately — "a rate sitting in the
  // input of the function that computes retainage is an open invitation to
  // derive the figure from it live", because the amount held back on an
  // invoice is a SNAPSHOT taken at creation. This panel was written against
  // the older signature and merged AFTER it, so `main` itself stopped
  // typechecking at `801b7a0d`: both PRs were green, and nothing ever
  // compiled them together, because #404's CI ran before #409 was on main.
  // A clean `merge-tree` is not the same as a merged result that builds.
  //
  // Deleting the argument is the whole fix and moves no pixel — the
  // function never read it. `RETAINAGE_PERCENT` still drives `withheld()`
  // two lines up, which is where a rate legitimately belongs: applied to an
  // amount to produce the snapshot, never handed to the summariser.
  //
  // The column's own name is deliberately NOT spelled out above.
  // `retainage-single-source.test.ts` greps every file for it and requires
  // the result to match an enumerated list, and it does not strip comments —
  // so a prose mention of the identifier puts this file in a census about
  // files that READ the column, which this one does not. Same shape as
  // #185, arriving from the other side: there a comment disarmed a census,
  // here it armed one.
  const summary = calculatePayAppSummary({
    lineItems,
    previousRetainageWithheld: withheld(previousAmount),
    thisPeriodRetainageWithheld: withheld(thisPeriodAmount),
  });

  return { lineItems, summary };
}

// Column visibility by panel width. Written out as literal class strings
// because Tailwind scans source for whole class names. Below 24rem (a phone,
// where the panel is ~343px) the scheduled value moves UNDER the line item's
// description instead of taking a column, so the description keeps room to
// read; from 24rem (the hero's 420px column) it is a column of its own; the
// percent joins from 30rem; the tab body (~800px) shows all eight.
const cellBase = "py-1.5 text-right tabular-nums";
const from24 = "hidden [@container(min-width:24rem)]:table-cell";
const from30 = "hidden [@container(min-width:30rem)]:table-cell";
const from40 = "hidden [@container(min-width:40rem)]:table-cell";

export function PayApplicationPanel({ className }: { className?: string }) {
  const { lineItems, summary } = buildPayApplication();

  return (
    <PanelFrame
      title={`Application for payment #${APPLICATION_NUMBER} — ${DEMO_JOB.name}`}
      meta={`${DEMO_JOB.gc} · Application date ${calendarDate(APPLICATION_DATE)}`}
      caption="A G702/G703-style summary and continuation sheet built from the job's schedule of values."
      className={className}
    >
      {/* The summary block, in the page's own order. Two columns, three once
          the panel is wide enough — the page uses grid-cols-2 sm:grid-cols-3. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 [@container(min-width:24rem)]:grid-cols-3">
        <Tile label="Contract sum to date" value={money(summary.contractSumToDate)} />
        <Tile label="Total completed & stored to date" value={money(summary.totalCompletedAndStoredToDate)} />
        <Tile label="Retainage to date" value={money(summary.retainageToDate)} />
        <Tile label="Total earned less retainage" value={money(summary.totalEarnedLessRetainage)} />
        <Tile
          label="Less previous certificates for payment"
          value={money(summary.previousCertificatesForPayment)}
        />
        <Tile label="Current payment due" value={money(summary.currentPaymentDue)} tone="good" />
        <Tile
          label="Balance to finish, including retainage"
          value={money(summary.balanceToFinishIncludingRetainage)}
          className="col-span-2 [@container(min-width:24rem)]:col-span-3"
        />
      </div>

      {/* The continuation sheet. Real table semantics: a caption for the
          sheet, column headers with scope, one row per SOV line. */}
      <div className="mt-4 overflow-x-auto border-t border-line-row pt-3">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Continuation sheet — schedule of values</caption>
          <thead>
            <tr className="text-[11px] text-ink-muted">
              <th scope="col" className="pb-1 pr-2 font-normal">
                Line item
              </th>
              <th scope="col" className={`pb-1 pr-2 text-right font-normal ${from24}`}>
                Scheduled value
              </th>
              <th scope="col" className={`pb-1 pr-2 text-right font-normal ${from40}`}>
                Previous
              </th>
              <th scope="col" className="pb-1 pr-2 text-right font-normal">
                This period
              </th>
              <th scope="col" className={`pb-1 pr-2 text-right font-normal ${from40}`}>
                Materials stored to date
              </th>
              <th scope="col" className="pb-1 pr-2 text-right font-normal">
                Total to date
              </th>
              <th scope="col" className={`pb-1 pr-2 text-right font-normal ${from30}`}>
                %
              </th>
              <th scope="col" className={`pb-1 text-right font-normal ${from40}`}>
                Balance to finish
              </th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((row) => (
              <tr key={row.lineItemId} className="border-t border-line-row align-top">
                <th scope="row" className="py-1.5 pr-2 font-normal text-ink-label">
                  {row.description}
                  {/* The scheduled value, under the description, only while
                      the panel is too narrow for its own column. */}
                  <span className="block text-[11px] tabular-nums text-ink-muted [@container(min-width:24rem)]:hidden">
                    Scheduled {money(row.scheduledValue)}
                  </span>
                </th>
                <td className={`${cellBase} pr-2 text-ink-body ${from24}`}>{money(row.scheduledValue)}</td>
                <td className={`${cellBase} pr-2 text-ink-body ${from40}`}>{money(row.previousBilled)}</td>
                <td className={`${cellBase} pr-2 text-ink`}>{money(row.thisPeriodBilled)}</td>
                <td className={`${cellBase} pr-2 text-ink-body ${from40}`}>
                  {money(row.materialsStoredToDate)}
                </td>
                <td className={`${cellBase} pr-2 text-ink`}>{money(row.totalCompletedAndStoredToDate)}</td>
                <td className={`${cellBase} pr-2 text-ink-body ${from30}`}>
                  {sheetPercent(row.percentOfScheduledValue)}
                </td>
                <td className={`${cellBase} text-ink-body ${from40}`}>{money(row.balanceToFinish)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelFrame>
  );
}

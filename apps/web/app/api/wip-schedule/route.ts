import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/authz";
import { csvCell, toCsv } from "@/lib/export";
import { loadWipSchedule } from "@/lib/wip-schedule-query";
import { WIP_SCHEDULE_COLUMNS } from "@/lib/wip-schedule";
import { viewerToday } from "@/lib/viewerToday";

/**
 * The WIP schedule as a file. Sheet 15's last Missing row.
 *
 * A Route Handler rather than a Server Action for the reason
 * app/api/export/route.ts gives: a Server Action returns a value to the
 * component that called it, and a download needs a Response carrying its
 * own content type and Content-Disposition.
 *
 * VIEW_COMPANY_FINANCIALS rather than OWNER, which is the one difference
 * from the everything-export next door and a deliberate one. That export is
 * every table in the company including each employee's hours; this is one
 * financial report, and `VIEW_COMPANY_FINANCIALS` is the capability this app
 * already built for exactly this question -- it is what `/cash-flow` asks
 * for, and this file is the thing a person goes to `/cash-flow` to get.
 * Gating it harder than the screen that shows the same figures would be
 * theatre.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, allowed } = await requireCapability("VIEW_COMPANY_FINANCIALS");
  if (!allowed) {
    // Plain text rather than a redirect, copying the export route: this URL
    // is hit by a download, and a redirect would save the sign-in page as a
    // .csv file.
    return new NextResponse("You do not have access to company financials.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const rows = await loadWipSchedule(context.company.id);
  // The reader's calendar day, not the server's -- an "as of" date is the
  // one figure on a financial document that must match the day the person
  // pressing the button is having. See lib/viewerToday.ts.
  const today = await viewerToday();

  // A title block above the table. This is what a WIP schedule looks like
  // on a surety's desk, and it is also the export route's own rule applied
  // here: say it IN THE FILE, because the file is what outlives this
  // account. A spreadsheet handed to an underwriter with no statement of
  // what it covers or what a blank cell means is a document that will be
  // read wrong by someone acting in good faith.
  //
  // The row count excludes the TOTAL line the table ends with.
  const preamble = [
    ["Work in Progress Schedule"],
    ["Company", context.company.name],
    ["As of", today],
    ["Jobs included", `Contracted and in progress (${Math.max(rows.length - 1, 0)})`],
    ["Method", "Percentage of completion, cost-to-cost"],
    [
      "Blank cells",
      "Not a zero. A figure is left blank where under 80% of the job's value carries the estimate it depends on, so the number would describe missing data rather than the job. The coverage columns say how much is covered.",
    ],
    [],
  ]
    .map((line) => line.map(csvCell).join(","))
    .join("\n");

  const table = toCsv(
    WIP_SCHEDULE_COLUMNS.map((c) => c.label),
    rows.map((row) =>
      Object.fromEntries(WIP_SCHEDULE_COLUMNS.map((c) => [c.label, row[c.key]])),
    ),
  );

  return new NextResponse(`${preamble}\n${table}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="prova-wip-schedule-${today}.csv"`,
    },
  });
}

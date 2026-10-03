import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { certifiedPayrollWeekStart, certifiedPayrollWeekWindow } from "@/lib/certified-payroll-week";
import { loadCertifiedPayrollWeekSummary } from "@/lib/certified-payroll-week.summary";
import { csvCell, toCsv } from "@/lib/export";
import { buildPayrollExportRows, PAYROLL_EXPORT_COLUMNS } from "@/lib/payroll-export";

/**
 * ONE WEEK OF HOURS, AS A FILE PAYROLL CAN RUN.
 *
 * `PayrollRegisterImport` reads a finished register back in from Gusto, ADP
 * RUN or Sage 100. Nothing went the other way, so the hours were only ever
 * on a screen and somebody retyped them. This is the other direction.
 *
 * A Route Handler rather than a Server Action for the reason
 * app/api/export/route.ts gives: an action returns a value to the component
 * that called it, and a download needs a Response carrying its own content
 * type and Content-Disposition.
 *
 * `MANAGE_COMPLIANCE`, which is what the certified-payroll PAGE asks for
 * and therefore the only honest gate: this file is the figures on that
 * page, and gating the download harder than the screen showing the same
 * numbers would be theatre. The page's own comment makes the same argument
 * about /prevailing-wage.
 *
 * The figures come from `loadCertifiedPayrollWeekSummary` — the same call
 * the page renders — so a payroll file cannot disagree with the week it was
 * downloaded from.
 */

export const dynamic = "force-dynamic";

function plain(message: string, status: number) {
  // Plain text rather than a redirect, copying the export route: this URL is
  // hit by a download, and a redirect would save the sign-in page as a .csv.
  return new NextResponse(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return plain("You do not have access to payroll records.", 403);

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const weekStartParam = url.searchParams.get("weekStart");
  if (!jobId) return plain("A job is required.", 400);
  if (!weekStartParam || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)) {
    return plain("A week is required, as YYYY-MM-DD.", 400);
  }

  const requested = new Date(`${weekStartParam}T00:00:00.000Z`);
  if (Number.isNaN(requested.getTime())) return plain("That is not a date.", 400);

  // The job must be this company's. Scoped in the WHERE rather than checked
  // after the read: one blob store serves every tenant and so does one
  // database, and an id in a query string is not evidence of ownership.
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: context.company.id },
    select: { id: true, name: true },
  });
  if (!job) return plain("No such job.", 404);

  // Snapped, not trusted: a mid-week date in the query string would
  // otherwise export a window that starts on a Wednesday and silently
  // disagree with every other certified-payroll surface.
  const weekStart = certifiedPayrollWeekStart(requested);
  const weekEnd = certifiedPayrollWeekWindow(weekStart).lte;

  const { summaries } = await loadCertifiedPayrollWeekSummary(context.company.id, job.id, weekStart);
  const rows = buildPayrollExportRows(summaries, {
    start: isoDate(weekStart),
    end: isoDate(weekEnd),
  });

  const csv = toCsv(
    PAYROLL_EXPORT_COLUMNS.map((c) => c.label),
    rows.map((row) =>
      Object.fromEntries(PAYROLL_EXPORT_COLUMNS.map((c) => [c.label, row[c.key]])),
    ),
  );

  // The job name is somebody's free text and lands in a header a browser
  // parses — strip it to something a filename can hold.
  const slug = job.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const filename = `payroll-${slug || "job"}-${isoDate(weekStart)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvCell(filename).replace(/"/g, "")}"`,
    },
  });
}

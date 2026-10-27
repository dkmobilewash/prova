import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { loadScheduleProposals } from "@/lib/plan-ingest/scheduleProposalsQuery";
import { summaryInputFrom, takeoffSummary, takeoffSummaryCsv } from "@/lib/takeoff/summaryExport";
import { takeoffSummaryPdf } from "@/lib/takeoff/summaryPdf";
import { loadTakeoffWorkspace } from "@/lib/takeoff/workspaceLoad";
import { viewerToday } from "@/lib/viewerToday";

/**
 * The takeoff summary, as a file: `?jobId=…&format=csv|pdf`. A Route Handler
 * because it returns a download (see `app/api/export/route.ts`). Behind the
 * company's `takeoffExportOn` switch and the takeoff tab's own capability.
 * Built from exactly what the takeoff page loads, so the figures are the
 * figures on screen; see `lib/takeoff/summaryExport.ts`.
 */

export const dynamic = "force-dynamic";

function plain(message: string, status: number) {
  // Plain text, never a redirect: a redirect would save the sign-in page as a .csv.
  return new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "job";

export async function GET(request: Request) {
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return plain("A job's costs and pricing aren't part of your job function.", 403);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const format = url.searchParams.get("format");
  if (!jobId) return plain("A job is required.", 400);
  if (format !== "csv" && format !== "pdf") return plain("Ask for format=csv or format=pdf.", 400);

  const company = await prisma.company.findUnique({ where: { id: context.company.id }, select: { takeoffExportOn: true } });
  if (!company?.takeoffExportOn) {
    return plain("The takeoff export is off for your company. The account owner can turn it on under Settings.", 403);
  }
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: context.company.id },
    select: { id: true, name: true, status: true },
  });
  if (!job) return plain("No such job.", 404);

  const data = await loadTakeoffWorkspace({ id: context.company.id }, job);
  if (data === null) return plain("This job has no drawing yet.", 404);
  const summary = takeoffSummary(summaryInputFrom({ ...data, schedules: await loadScheduleProposals(data.plan.id) }));
  // The viewer's own calendar day, not the server's (`viewerDayCensus.test.ts`).
  const today = await viewerToday();
  const stem = `takeoff-summary-${safeName(job.name)}-${today}`;

  if (format === "csv") {
    return new NextResponse(takeoffSummaryCsv(summary), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${stem}.csv"` },
    });
  }
  const bytes = summary.sheets.length === 0 ? null : await readPlanBytes(data.plan.id, context.company.id);
  const pdf = await takeoffSummaryPdf(
    summary,
    { jobName: job.name, fileName: data.plan.fileName, revisionLabel: data.plan.revisionLabel, exportedOn: today },
    bytes?.ok ? bytes.bytes : null,
  );
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${stem}.pdf"` },
  });
}

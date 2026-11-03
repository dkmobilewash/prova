import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { g703Csv, g703FileName, g703Workbook } from "@/lib/billing/g703-export";
import { payApplicationDocument } from "@/lib/billing/pay-application-document";
import { loadPayApplication } from "@/lib/pay-application-query";
import { can } from "@/lib/permissions";
import { sheetResponse } from "@/lib/sheet-export";
import { viewerTimeZone } from "@/lib/viewerToday";

export const dynamic = "force-dynamic";

/** The continuation sheet as a file. The same capability and the same document as
 * the pay application page. Another company's id reads as missing. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; invoiceId: string }> },
) {
  const context = await requireApiContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!can(context, "MANAGE_BILLING")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { jobId, invoiceId } = await params;
  const view = await loadPayApplication(jobId, invoiceId, context.company.id);
  if (!view?.isPayApplication) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = payApplicationDocument(view, context.company, await viewerTimeZone());

  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  return sheetResponse(format === "xlsx" ? g703Workbook(doc) : g703Csv(doc), format, g703FileName(doc, format));
}

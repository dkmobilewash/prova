import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { changeOrderLog, changeOrderLogFileName, changeOrderLogRows } from "@/lib/change-order-log";
import { loadChangeOrdersForLog } from "@/lib/change-order-log-query";
import { can } from "@/lib/permissions";
import { sheetCsv, sheetResponse, sheetWorkbook } from "@/lib/sheet-export";
import { viewerToday } from "@/lib/viewerToday";

export const dynamic = "force-dynamic";

/** The log as a file, from the same rows as its page. Job cost access, like the
 * change order card. Another company's job reads as missing. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!can(context, "VIEW_JOB_COSTS")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const loaded = await loadChangeOrdersForLog(id, context.company.id);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const asOf = await viewerToday();
  const rows = changeOrderLogRows(changeOrderLog(loaded.changeOrders, asOf), { jobName: loaded.jobName, asOf });
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  return sheetResponse(
    format === "xlsx" ? sheetWorkbook(rows, "Change orders") : sheetCsv(rows),
    format,
    changeOrderLogFileName(loaded.jobName, asOf, format),
  );
}

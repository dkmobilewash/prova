import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { storedRasterFor } from "@/lib/plan-ingest/raster";

/**
 * One scanned sheet's raster read — the lines and words the RASTER stage
 * stored, in points — fetched by the viewer when that sheet is opened.
 *
 * ── WHY A ROUTE AND NOT A PROP ──
 *
 * The workspace used to hand the viewer EVERY page's read in the page's own
 * payload. On Evergreen that is 106 rows, 416,923 line segments, 31 MB of
 * lines and 2.7 MB of words serialised into the HTML of a page the person
 * opened to look at one sheet — and Chrome's labelling round reported the
 * tab going blank and unresponsive on exactly that set, twice. A sheet's
 * read is wanted when the sheet is on screen and not before, so it is
 * served here, same-origin, one page at a time, with the same company and
 * capability check the PDF route does (`plan/[planId]/route.ts`).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ planId: string; page: string }> }) {
  const { planId, page } = await params;
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return NextResponse.json({ error: "Not available to this job function." }, { status: 403 });
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return NextResponse.json({ error: "Not a page." }, { status: 400 });
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, companyId: context.company.id }, select: { id: true } });
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  const raster = await storedRasterFor(plan.id, pageNumber);
  if (raster === null) return NextResponse.json({ error: "No raster read for this page." }, { status: 404 });
  return NextResponse.json(raster, { headers: { "Cache-Control": "private, max-age=300" } });
}

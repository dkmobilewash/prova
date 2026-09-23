import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

/**
 * Serves a plan PDF to the viewer, through this app rather than from its
 * public blob URL.
 *
 * WHY NOT JUST HAND THE BROWSER THE BLOB URL. Two reasons, and the second is
 * the one that matters.
 *
 * 1. pdf.js fetches the bytes itself, so a blob URL would be a cross-origin
 *    fetch, and whether that host sends `Access-Control-Allow-Origin` could
 *    not be established from here — the same unanswered question
 *    `jobs/[id]/photo-report/page.tsx` records about canvas tainting, wearing
 *    a different hat. Serving it same-origin removes the question rather than
 *    betting on the answer.
 *
 * 2. A BLOB URL IS NOT PROOF OF WHOSE FILE IT IS. That is #195's own security
 *    finding, and a Vercel blob store is one store shared by every tenant
 *    (CLAUDE.md). A public URL is readable by anyone who has it, forever,
 *    with no company check — fine for a photo somebody chose to share, wrong
 *    for a GC's bid documents. This route re-reads the row, re-checks the
 *    company and re-checks the capability on every request, which the URL
 *    cannot do. That is a security improvement this feature gets for free by
 *    solving the CORS problem the honest way.
 *
 * The cost is function egress on every page render of a drawing. Said out
 * loud in the changelog rather than discovered on a bill.
 */
export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const context = await requireCompanyContext();

  // The same capability the Takeoff tab withholds on, checked before the row
  // is read rather than after.
  if (!can(context, "VIEW_JOB_COSTS")) {
    return NextResponse.json({ error: "Not available to this job function." }, { status: 403 });
  }

  // Tenancy is the `where`: a plan id from another company matches nothing,
  // and "not found" is the right answer to give for both cases anyway.
  const plan = await prisma.takeoffPlan.findFirst({
    where: { id: planId, companyId: context.company.id },
    select: { fileUrl: true, fileName: true },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  }

  // Range is forwarded so pdf.js can fetch a page at a time out of a large
  // set instead of pulling the whole file before it draws anything.
  const range = request.headers.get("range");
  const upstream = await fetch(plan.fileUrl, {
    headers: range ? { range } : undefined,
    cache: "no-store",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: "That drawing could not be read from storage." }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("content-type", "application/pdf");
  // `inline` so the viewer renders it rather than the browser downloading it.
  // The filename is quoted and stripped of quotes/newlines: it is a name a
  // person typed, and it is going into a header.
  const safeName = (plan.fileName ?? "plan.pdf").replace(/["\r\n]/g, "");
  headers.set("content-disposition", `inline; filename="${safeName}"`);
  headers.set("accept-ranges", "bytes");
  // PRIVATE, and never a shared cache: this response is scoped to one
  // company, and a CDN holding it would be serving one tenant's drawing from
  // another tenant's request.
  headers.set("cache-control", "private, max-age=0, must-revalidate");
  for (const header of ["content-length", "content-range"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

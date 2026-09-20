import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { defaultScheduleWindow, listScheduleForJob } from "@/lib/schedule-core";

/**
 * Who is planned on this job, and whether the hours arrived.
 *
 * `MANAGE_FIELD`: this is the crew on site, which is field work rather
 * than correspondence. Attendance is DERIVED from time entries here
 * rather than stored — see schedule-core.ts and the schema's own note on
 * why `CrewScheduleDay` has no `attended` column.
 *
 * The window defaults to a week either side of today. `from`/`to` are
 * accepted so the phone can page without this route guessing.
 */
export const dynamic = "force-dynamic";

const FIELD_ONLY =
  "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const today = new Date().toISOString().slice(0, 10);
  const fallback = defaultScheduleWindow(today);
  const from = request.nextUrl.searchParams.get("from") ?? fallback.from;
  const to = request.nextUrl.searchParams.get("to") ?? fallback.to;
  if (!DAY.test(from) || !DAY.test(to)) return jsonError("from and to must be dates", 400);
  if (from > to) return jsonError("from must not be after to", 400);

  return NextResponse.json(await listScheduleForJob(job.id, from, to, today));
}

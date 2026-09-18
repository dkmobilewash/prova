import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { isRatioBreach, ratioLabel, type LocalDayRatio } from "@/lib/apprentice-ratio";
import { loadJobDayRatio } from "@/lib/union-compliance-query";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

type Warning = {
  source: "planned" | "logged";
  unionLocalLabel: string;
  rule: string;
  status: "OVER" | "NO_JOURNEYMAN";
  journeymen: number;
  apprentices: number;
  allowedApprentices: number | null;
};

function warningsFrom(source: Warning["source"], days: LocalDayRatio[]): Warning[] {
  return days
    .filter((d) => d.rule !== null && isRatioBreach(d.day))
    .map((d) => ({
      source,
      unionLocalLabel: d.unionLocalLabel,
      rule: ratioLabel(d.rule!),
      status: d.day.status as Warning["status"],
      journeymen: d.day.journeymanHours,
      apprentices: d.day.apprenticeHours,
      allowedApprentices: d.day.allowedApprenticeHours,
    }));
}

/**
 * The apprentice ratio for one job on one day, as warnings the phone can
 * show while the crew can still be changed. `?date=yyyy-mm-dd` is the
 * phone's own calendar day.
 *
 * Only breaches come back — too many apprentices, or apprentices with no
 * journeyman — each from the day's crew SCHEDULE ("planned", counted in
 * people) or the hours already LOGGED. A day that is incomplete (hours with
 * no craft, or no rule recorded) is not a warning here; the monthly review
 * on /union-compliance is where that is reported.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!job || job.companyId !== context.companyId) return jsonError("Job not found", 400);

  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    return jsonError("date must be yyyy-mm-dd", 400);
  }

  const { logged, planned } = await loadJobDayRatio(context.companyId, job.id, date);
  return NextResponse.json({
    date,
    warnings: [...warningsFrom("planned", planned), ...warningsFrom("logged", logged)],
  });
}

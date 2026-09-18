import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  createFieldReport,
  listFieldReportsForJob,
  FIELD_ONLY,
} from "@/lib/field-reports-core";
import { prisma } from "@prova/db";
import { loadManpower, manpowerLine } from "@/lib/manpower";
import { weatherLine, type DayWeather } from "@/lib/weather";

/**
 * The mobile HTTP surface for daily field reports — PR 1 of the Expo app.
 *
 * A phone cannot call a Server Action, so these route handlers wrap the same
 * core (lib/field-reports-core.ts) the web action uses. The difference from
 * the web path is only the edges: no session is a 401, not a redirect to
 * /sign-in; a missing capability is a 403, not a hidden section; and there
 * is no revalidatePath — a phone has no server cache.
 *
 * middleware.ts runs clerkMiddleware on /api(.*) (see its matcher) but does
 * NOT list /api/v1 in isProtectedRoute, so auth.protect() never redirects a
 * phone to /sign-in. The session is read here via requireApiContext, which
 * is the same currentUser() + adoption the web path uses, minus the
 * redirect.
 */

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return jsonError("jobId is required", 400);

  const result = await listFieldReportsForJob(context.company, jobId);
  if (!result.ok) return jsonError(result.error, 400);

  // What the phone shows on each report and can't work out itself: the
  // weather as one line, the crew from that day's time entries, and whether
  // the day is signed (so the report is read-only).
  const dates = result.value.map((r) => new Date(`${r.reportDate}T00:00:00.000Z`));
  const [manpower, live] = await Promise.all([
    loadManpower(jobId, dates),
    prisma.timesheetSignoff.findMany({ where: { jobId, reopenedAt: null }, select: { date: true, approvedAt: true } }),
  ]);
  const locked = new Map(live.map((s) => [s.date.toISOString().slice(0, 10), s.approvedAt ? "APPROVED" : "SUBMITTED"]));
  return NextResponse.json(
    result.value.map((r) => {
      const auto = r.weatherAuto as DayWeather | null;
      const crew = manpower.get(r.reportDate);
      return {
        ...r,
        weatherLine: auto ? weatherLine(auto) : null,
        weatherKind: auto?.kind ?? null,
        manpowerLine: crew ? manpowerLine(crew) : null,
        lockState: locked.get(r.reportDate) ?? null,
      };
    }),
  );
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError("JSON body must be an object", 400);
  }

  const input = body as Record<string, unknown>;
  if (typeof input.jobId !== "string" || !input.jobId) {
    return jsonError("jobId is required", 400);
  }

  const result = await createFieldReport(context.company, context.id, {
    jobId: input.jobId,
    reportDate: input.reportDate,
    workPerformed: input.workPerformed,
    crewPresent: input.crewPresent,
    weather: input.weather,
    delays: input.delays,
    clientId: input.clientId,
    clientOperationId: input.clientOperationId,
    clientUpdatedAt: input.clientUpdatedAt,
  });

  if (!result.ok) return jsonError(result.error, 400);
  return NextResponse.json(result.value.report, {
    status: result.value.created ? 201 : 200,
  });
}

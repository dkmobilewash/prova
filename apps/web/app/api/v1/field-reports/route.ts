import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  createFieldReport,
  listFieldReportsForJob,
  FIELD_ONLY,
} from "@/lib/field-reports-core";

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
  return NextResponse.json(result.value);
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
  });

  if (!result.ok) return jsonError(result.error, 400);
  return NextResponse.json({ ok: true }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateFieldReport, FIELD_ONLY } from "@/lib/field-reports-core";

/**
 * PATCH /api/v1/field-reports/[id] — the mobile edit surface.
 *
 * Same edges as the collection route: no session is a 401, a missing
 * capability is a 403, and there is no revalidatePath. The body is JSON
 * `{ workPerformed, crewPresent?, weather?, delays?, clientId?,
 * clientUpdatedAt? }`. A phone edits a report it may have written while
 * offline, so `clientUpdatedAt` drives last-write-wins: a stale edit is
 * answered 200 with `{ applied: false, report }` rather than blocking or
 * clobbering the newer one.
 */

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  const { id } = await params;

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
  const result = await updateFieldReport(context.company, id, {
    workPerformed: input.workPerformed,
    crewPresent: input.crewPresent,
    weather: input.weather,
    delays: input.delays,
    clientId: input.clientId,
    clientUpdatedAt: input.clientUpdatedAt,
  });

  if (!result.ok) return jsonError(result.error, 400);
  return NextResponse.json(result.value);
}

import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";

/**
 * PATCH /api/v1/jobs/[id]/punch-list/[itemId] — the phone's "it's fixed"
 * surface.
 *
 * Takes `{ status }` now that an item has three states. `{ isDone }` is
 * still accepted and mapped, because a build of the app is installed on a
 * phone right now and its queue may replay an old-shaped body hours after
 * this deploys: true is READY_FOR_REVIEW, which is exactly what ticking the
 * box always meant — the crew saying they fixed it.
 *
 * VERIFIED is deliberately NOT reachable from here. Verifying is the other
 * half of the Ready/Verified split and it belongs to somebody who did not
 * do the work; the phone is the person who did.
 *
 * `isDone` and `completedAt` no longer exist: they were a stored
 * derivation of `status` and were dropped with this change. When the work
 * was finished is `readyAt`.
 *
 * Same edges as the collection route: no session is a 401, a missing
 * capability is a 403, and there is no revalidatePath.
 */

export const dynamic = "force-dynamic";

const FIELD_ONLY =
  "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function toJson(i: {
  id: string;
  description: string;
  status: string;
  readyAt: Date | null;
  verifiedAt: Date | null;
  area: string | null;
  dueOn: Date | null;
  assignedName: string | null;
}) {
  return {
    id: i.id,
    description: i.description,
    status: i.status,
    readyAt: i.readyAt ? i.readyAt.toISOString() : null,
    verifiedAt: i.verifiedAt ? i.verifiedAt.toISOString() : null,
    area: i.area,
    dueOn: i.dueOn ? i.dueOn.toISOString() : null,
    assignedName: i.assignedName,
    photoCount: 0,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  const { id, itemId } = await params;

  const item = await prisma.punchListItem.findUnique({ where: { id: itemId } });
  if (!item || item.companyId !== context.companyId || item.jobId !== id) {
    return jsonError("Punch list item not found", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError("JSON body must be an object", 400);
  }

  const fields = body as Record<string, unknown>;
  const rawStatus = fields.status;
  const isDone = fields.isDone;

  let status: "OPEN" | "READY_FOR_REVIEW";
  if (typeof rawStatus === "string") {
    if (rawStatus !== "OPEN" && rawStatus !== "READY_FOR_REVIEW") {
      return jsonError("status must be OPEN or READY_FOR_REVIEW — verifying is done on the web", 400);
    }
    status = rawStatus;
  } else if (typeof isDone === "boolean") {
    status = isDone ? "READY_FOR_REVIEW" : "OPEN";
  } else {
    return jsonError("status must be OPEN or READY_FOR_REVIEW", 400);
  }

  // Sending one back from the phone leaves no reason behind, so an item
  // that had been VERIFIED is not reopened here — the crew unticking their
  // own row must not silently undo somebody's sign-off.
  if (status === "OPEN" && item.status === "VERIFIED") {
    return jsonError("This item has been verified. Reopening one is done on the web, with a reason.", 409);
  }

  const now = new Date();
  const updated = await prisma.punchListItem.update({
    where: { id: itemId },
    data:
      status === "READY_FOR_REVIEW"
        ? { status, readyAt: now, readyByUserId: context.id, reopenedAt: null, reopenedByUserId: null, reopenReason: null }
        : { status, readyAt: null, readyByUserId: null },
  });

  return NextResponse.json(toJson(updated));
}

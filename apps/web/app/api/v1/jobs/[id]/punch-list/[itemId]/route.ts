import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";

/**
 * PATCH /api/v1/jobs/[id]/punch-list/[itemId] — the mobile "tick it off"
 * surface. Checking an item off during a walkthrough is one tap and
 * reversible, so the body is just `{ isDone }`; `completedAt` is stamped
 * alongside `isDone` so "when did this get closed" stays answerable later.
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
  isDone: boolean;
  completedAt: Date | null;
}) {
  return {
    id: i.id,
    description: i.description,
    isDone: i.isDone,
    completedAt: i.completedAt ? i.completedAt.toISOString() : null,
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

  const isDone = (body as Record<string, unknown>).isDone;
  if (typeof isDone !== "boolean") {
    return jsonError("isDone must be a boolean", 400);
  }

  const updated = await prisma.punchListItem.update({
    where: { id: itemId },
    data: { isDone, completedAt: isDone ? new Date() : null },
  });

  return NextResponse.json(toJson(updated));
}

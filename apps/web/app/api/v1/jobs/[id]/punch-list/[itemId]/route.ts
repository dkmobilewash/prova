import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { ownerRefusal } from "@/lib/actions/shared";

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

/**
 * DELETE /api/v1/jobs/[id]/punch-list/[itemId] — taking an item off the
 * list that should never have been on it. Issue #592: the phone could add
 * an item and had no way at all to remove one, so a typo or an item logged
 * against the wrong job could only be toggled between three states forever.
 *
 * OWNER-ONLY, AND THAT IS PARITY RATHER THAN A CHOICE MADE HERE. The web's
 * `deletePunchListItem` (lib/actions/punchLists.ts) refuses anybody who is
 * not the account owner, through this same `ownerRefusal` — the predicate is
 * imported rather than restated so the two surfaces cannot drift into
 * disagreeing about who may destroy a field record.
 *
 * SO THIS DOES NOT SOLVE #592's OWN HEADLINE CASE, and that is deliberate,
 * not an oversight: the issue is about a CREW MEMBER who typos an item, and
 * a crew member still cannot delete from the phone — they get the sentence
 * below. Widening it is a product decision about who may destroy evidence a
 * GC may later be shown, and if the answer comes back "crew may remove
 * their own", the change belongs HERE AND IN `punchLists.ts` TOGETHER. A
 * phone that can delete what the web refuses is the worse of the two bugs.
 *
 * ORDER OF THE TWO GUARDS, both before any query: MANAGE_FIELD is "punch
 * items are part of your work at all", OWNER is "you may destroy one" —
 * same order as the action. Nobody refused gets a database round trip, and
 * nobody refused learns whether an id exists. `lib/mobile-api-guards.test.ts`
 * reads this handler's own body for the capability and asserts that
 * ordering.
 *
 * A MISSING ITEM IS A 404 HERE WHERE PATCH ANSWERS 400 FOR THE SAME
 * CONDITION, and the difference is load-bearing rather than untidy. The
 * phone REPLAYS this request from its queue, and "the row you asked me to
 * remove is already gone" is the one 4xx that means the caller got exactly
 * what it wanted. 404 is what lets the queue settle such a delete as done
 * instead of parking it in "needs attention" forever — the
 * `punch-list:delete` case in `apps/mobile/lib/sync-queue.ts` is the other
 * half of this sentence, and it is matched on the STATUS. 400 stays
 * reserved for a request that is wrong.
 *
 * What happens to what hung off the item is the schema's answer, not this
 * handler's: `Media.punchListItemId` and `SheetPin.punchItemId` are both
 * `onDelete: SetNull`, so a photo of the fix outlives the item it was taken
 * against — identically to the web action, which also just deletes the row.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);
  if (!can(context, "MANAGE_FIELD")) return jsonError(FIELD_ONLY, 403);

  // The same refusal the web row renders, word for word, so a crew member
  // who is told no on one surface is told the same thing on the other.
  const refusal = ownerRefusal(context, "Only the account owner can remove a punch list item");
  if (refusal) return jsonError(refusal.error, 403);

  const { id, itemId } = await params;

  const item = await prisma.punchListItem.findUnique({ where: { id: itemId } });
  if (!item || item.companyId !== context.companyId || item.jobId !== id) {
    return jsonError("Punch list item not found", 404);
  }

  await prisma.punchListItem.delete({ where: { id: itemId } });

  // A body rather than a 204: `request` in apps/mobile/lib/api.ts reads the
  // response as JSON, and a route that answers every other call with an
  // object has no reason to be the one that does not.
  return NextResponse.json({ ok: true });
}

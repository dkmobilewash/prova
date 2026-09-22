"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { createPunchListItems } from "@/lib/field/punch-list-items";
import { capabilityForStatus, parseAssignee, parseDueOn } from "@/lib/punch-items";
import type { PunchItemStatus } from "@prova/db";
import {
  actionFail as fail,
  actionOk as ok,
  InputError,
  ownerRefusal,
  runAction,
  type ActionResult,
} from "./shared";

/** Every entry point to these records is a page guarded by MANAGE_FIELD,
 * so every write here answers to the same capability. A guarded page
 * in front of an open action is not a guard: the action is its own
 * endpoint and answers whoever posts to it.
 *
 * Returned rather than thrown, like every other refusal in this module —
 * production redacts a thrown Server Action message, so the sentence
 * telling this person where to ask for access would never arrive. Same
 * reasoning as `submittals.ts`, which is the reference for this shape. */
const FIELD_ONLY = "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** Deliberately says what it is FOR, not just that you can't. Being unable
 * to sign off your own work is the feature, and somebody who reads this as
 * a bug will go looking for one. */
const VERIFY_ONLY =
  "Verifying is somebody else's sign-off: whoever fixed an item can mark it ready, but a second person confirms it. The account owner sets who verifies, on the Team page.";

/** Actions in this module RETURN their failures instead of throwing them.
 *
 * Every guard below used to throw. Production replaces a thrown Server
 * Action message with React's own "the specific message is omitted in
 * production builds" paragraph (verified against the installed
 * react-server-dom-webpack: its production `emitErrorChunk` has no
 * parameter for the error at all, and the client's `resolveErrorProd`
 * takes none either), so "Pick a job" and "Description is required" have
 * never once been read by a user of this page. `throw` is reserved for
 * genuine bugs, which SHOULD be redacted.
 */

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function findOwnJob(jobId: string, companyId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== companyId) return null;
  return job;
}

async function findOwnItem(itemId: string, companyId: string) {
  const item = await prisma.punchListItem.findUnique({ where: { id: itemId } });
  if (!item || item.companyId !== companyId) return null;
  return item;
}

/** The job and description checks, shared by create and edit so the two
 * forms cannot disagree about what a valid item is. Throws `InputError`,
 * which `runAction` returns; see the note at the top of this file. */
async function readItemFields(formData: FormData, companyId: string) {
  const description = text(formData, "description");
  if (!description) throw new InputError("Description is required");

  const jobId = text(formData, "jobId");
  if (!jobId) throw new InputError("Pick a job");

  // A job that isn't this company's is a page left open while the job was
  // deleted somewhere else, or a post nobody's browser made. Returned
  // either way: the first case is a real person who needs to reload, and
  // the second learns nothing from a sentence it already guessed.
  if (!(await findOwnJob(jobId, companyId))) throw new InputError("Job not found");

  const area = text(formData, "area") || null;

  const due = parseDueOn(text(formData, "dueOn"));
  if (!due.ok) throw new InputError(due.error);

  const assignee = parseAssignee(text(formData, "assignedTo"), text(formData, "assignedName"));
  if (!assignee.ok) throw new InputError(assignee.error);

  // Each half of the assignee is checked against THIS company. An id posted
  // from anywhere else is a row belonging to somebody we have never heard
  // of, and a foreign key would happily accept it.
  if (assignee.value.assignedUserId) {
    const user = await prisma.user.findFirst({
      where: { id: assignee.value.assignedUserId, companyId },
      select: { id: true },
    });
    if (!user) throw new InputError("That person isn't on this company's team");
  }
  if (assignee.value.assignedCrewMemberId) {
    const crew = await prisma.crewMember.findFirst({
      where: { id: assignee.value.assignedCrewMemberId, companyId },
      select: { id: true },
    });
    if (!crew) throw new InputError("That crew member isn't on this company's list");
  }

  const causedByOthers = formData.get("causedByOthers") === "on";
  // Who caused it only means anything if somebody else did. Clearing the
  // checkbox clears the party rather than leaving a stale answer to a
  // question the row no longer asks.
  const responsibleParty = causedByOthers ? (text(formData, "responsibleParty") || null) : null;
  if (responsibleParty && !RESPONSIBLE_PARTIES.includes(responsibleParty)) {
    throw new InputError("Pick who caused it");
  }

  const backchargeId = text(formData, "backchargeId") || null;
  if (backchargeId) {
    // Same job as well as same company: a backcharge is always a deduction
    // against a specific job, so evidence from a different one is a
    // mis-click that would read later as a connection somebody drew.
    const backcharge = await prisma.backcharge.findFirst({
      where: { id: backchargeId, companyId, jobId },
      select: { id: true },
    });
    if (!backcharge) throw new InputError("That backcharge isn't on this job");
  }

  return {
    description,
    jobId,
    area,
    dueOn: due.value,
    ...assignee.value,
    causedByOthers,
    responsibleParty: responsibleParty as "GC" | "OWNER" | "OTHER_TRADE" | "SUPPLIER" | "OURSELVES" | "NOBODY" | null,
    backchargeId,
  };
}

/** The delay log's vocabulary, reused deliberately — see
 * `PunchListItem.responsibleParty` in operations.prisma. Listed here rather
 * than imported from Prisma's generated enum object so a value removed from
 * the schema fails this file's typecheck instead of silently accepting an
 * old form post. */
const RESPONSIBLE_PARTIES = ["GC", "OWNER", "OTHER_TRADE", "SUPPLIER", "OURSELVES", "NOBODY"];

/**
 * One item, from the page's form.
 *
 * The body is `createPunchListItems` in lib/field/punch-list-items.ts —
 * lifted so the Ask command `add_punch_items` writes through the SAME
 * validations, the same in-company assertion and the same transaction
 * rather than its own copy. The core already RETURNS its refusals, so this
 * hands them straight back: a thrown one would be redacted in production,
 * which is the whole reason these actions stopped throwing.
 */
export async function createPunchListItem(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    // The full field read, so a create and an edit cannot disagree about
    // what a valid assignee or due date is. Description and job are then
    // handed to the shared core, which owns the transaction and the
    // "which items got made" answer the Ask card needs.
    const fields = await readItemFields(formData, company.id);

    const result = await createPunchListItems(company.id, fields.jobId, {
      descriptions: [fields.description],
      raisedByUserId: user.id,
      defaults: {
        area: fields.area,
        dueOn: fields.dueOn,
        assignedUserId: fields.assignedUserId,
        assignedCrewMemberId: fields.assignedCrewMemberId,
        assignedName: fields.assignedName,
      },
    });
    if (!result.ok) return result;

    revalidatePath("/punch-lists");
    return ok;
  });
}

export async function updatePunchListItem(itemId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    const item = await findOwnItem(itemId, company.id);
    if (!item) return fail("Punch list item not found");

    const fields = await readItemFields(formData, company.id);

    await prisma.punchListItem.update({ where: { id: item.id }, data: fields });

    revalidatePath("/punch-lists");
    return ok;
  });
}

/**
 * Moving an item between states — the body of all three actions below, so
 * the capability rule and the stamps cannot drift apart between them.
 *
 * `status` is the only record of where an item is, and there is nothing
 * derived from it to keep in step.
 *
 * This comment used to say `isDone` and `completedAt` were kept in sync by a
 * trigger named `prova_punch_item_status_sync`. Both columns were dropped by
 * `20260920030000_punch_item_verification` and no such trigger exists —
 * checked, not assumed: `information_schema.triggers` on a database with
 * every committed migration applied lists none at all for `PunchListItem`.
 * Left standing, it sent the next person hunting for a trigger firing
 * against missing columns, which is a very plausible cause of a page that
 * will not load and was not this one's.
 */
async function moveTo(
  context: Awaited<ReturnType<typeof requireCompanyContext>>,
  itemId: string,
  next: PunchItemStatus,
  extra: (userId: string) => Record<string, unknown>,
  validate?: () => string | null,
): Promise<ActionResult> {
  const { company, ...user } = context;
  return runAction(async () => {
    // The MANAGE_FIELD guard is at each exported action below rather than
    // here. That is not duplication for its own sake: every action is its
    // own endpoint with its own stable id, and
    // `action-capability-guards.test.ts` reads each one's SOURCE — a guard
    // it cannot see is a guard the next person deleting a line cannot see
    // either. This runs after it, on a caller that is already allowed.
    //
    // Both halves stay BEFORE the first query. The item lookup came first
    // for about an hour and the census failed the build over it, rightly:
    // an estimator posting here reached `prisma.punchListItem` before
    // anything refused them, and "which item does not exist" is a probe.

    // The reason for a send-back, checked here rather than in the caller
    // for the same ordering reason — a refusal about a blank box told
    // somebody without access that their post got that far.
    const invalid = validate?.();
    if (invalid) return fail(invalid);

    const item = await findOwnItem(itemId, company.id);
    if (!item) return fail("Punch list item not found");

    // The stricter half depends on BOTH states, so it can only be decided
    // once the row is known: agreeing that somebody else's work is done,
    // and undoing somebody's agreement, are the two that need a second
    // person. Everything else is field work.
    if (capabilityForStatus(next, item.status) === "VERIFY_PUNCH_ITEMS" && !can(context, "VERIFY_PUNCH_ITEMS")) {
      return fail(VERIFY_ONLY);
    }

    await prisma.punchListItem.update({
      where: { id: item.id },
      data: { status: next, ...extra(user.id) },
    });

    revalidatePath("/punch-lists");
    return ok;
  });
}

/** The crew saying they have fixed it. One click, no reason asked for, and
 * reversible — this is the tap that happens twenty times on a walkthrough. */
export async function markPunchListItemReady(itemId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
  return moveTo(context, itemId, "READY_FOR_REVIEW", (userId) => ({
    readyAt: new Date(),
    readyByUserId: userId,
    // A previous send-back is history the next screen should not still be
    // showing as current, and the row keeps `updatedAt` either way.
    reopenedAt: null,
    reopenedByUserId: null,
    reopenReason: null,
  }));
}

/** Somebody who did not do the work agreeing that it is done. The whole
 * reason the middle state exists. */
export async function verifyPunchListItem(itemId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // The floor, then the ceiling: MANAGE_FIELD to touch a punch item at all,
  // and VERIFY_PUNCH_ITEMS inside `moveTo` to be the second signature.
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
  return moveTo(context, itemId, "VERIFIED", (userId) => ({
    verifiedAt: new Date(),
    verifiedByUserId: userId,
  }));
}

/**
 * Sending one back, with the reason REQUIRED — the one place this feature
 * asks for typing, because "it was closed and then it was open again" with
 * nothing to say why is exactly the argument this record has to settle
 * months later.
 */
export async function reopenPunchListItem(itemId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
  const reason = text(formData, "reopenReason");
  return moveTo(context, itemId, "OPEN", (userId) => ({
    reopenedAt: new Date(),
    reopenedByUserId: userId,
    reopenReason: reason,
    // The claim and the sign-off are both withdrawn: an OPEN row carrying
    // "verified by Diego" reads as verified to everything that looks at it.
    readyAt: null,
    readyByUserId: null,
    verifiedAt: null,
    verifiedByUserId: null,
  }), () => (reason ? null : "Say why it is going back"));
}

export async function deletePunchListItem(itemId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    // `ownerRefusal`, not `assertOwner`: this action's declared type promises
    // a sentence the row can render, and `assertOwner` throws. The message is
    // specific rather than the default, per the list-page convention — "Only
    // the account owner can do that" tells nobody which button they pressed.
    const refusal = ownerRefusal(context, "Only the account owner can remove a punch list item");
    if (refusal) return refusal;

    const item = await findOwnItem(itemId, company.id);
    if (!item) return fail("Punch list item not found");

    await prisma.punchListItem.delete({ where: { id: item.id } });

    revalidatePath("/punch-lists");
    return ok;
  });
}

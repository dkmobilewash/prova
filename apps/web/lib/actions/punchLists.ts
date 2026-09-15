"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { createPunchListItems } from "@/lib/field/punch-list-items";
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

  return { description, jobId };
}

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

    const result = await createPunchListItems(
      company.id,
      String(formData.get("jobId") ?? "").trim(),
      { descriptions: [String(formData.get("description") ?? "")], raisedByUserId: user.id },
    );
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

    const { description, jobId } = await readItemFields(formData, company.id);

    await prisma.punchListItem.update({
      where: { id: item.id },
      data: { description, jobId },
    });

    revalidatePath("/punch-lists");
    return ok;
  });
}

/** Checking an item off is one click and reversible, so unlike delete it
 * asks nothing. completedAt is stamped alongside isDone so "when did this
 * get closed" is answerable later. */
export async function setPunchListItemDone(itemId: string, isDone: boolean): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    const item = await findOwnItem(itemId, company.id);
    if (!item) return fail("Punch list item not found");

    await prisma.punchListItem.update({
      where: { id: item.id },
      data: { isDone, completedAt: isDone ? new Date() : null },
    });

    revalidatePath("/punch-lists");
    return ok;
  });
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

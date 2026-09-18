"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  actionFail as fail,
  actionOk as ok,
  isUniqueConstraintError,
  ownerRefusal,
  type ActionResult,
} from "./shared";
import {
  BidPursuitInputError,
  optionalDateFromString,
  optionalValueFromString,
  stageFromString,
  type BidPursuitStage,
} from "@/lib/bid-pursuits";

/**
 * Writing the company's own pre-bid pipeline — BidPursuit.
 *
 * MANAGE_ESTIMATING, the same gate as /pipeline where these rows are shown
 * and as the `bid_pursuits` Ask tool that reads them. Chasing work before it
 * is bid is an estimator's job.
 *
 * Every action RETURNS its failure rather than throwing: production redacts
 * a thrown Server Action message, and "that invitation is already linked to
 * another pursuit" is a sentence somebody needs to read.
 *
 * NOTHING HERE TOUCHES SalesLead / SalesOpportunity. Those are Prova's own
 * CRM, on the operator company only. See pursuits.prisma.
 */

const NO_PERMISSION =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";
const NOT_FOUND = "That pursuit is no longer on your list.";
const LINKED_STAGE =
  "This pursuit is linked to a logged bid invitation, so it is INVITED. Unlink the invitation first if the invite did not really come from this pursuit.";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function optionalText(formData: FormData, key: string): string | null {
  return text(formData, key) || null;
}

/** The fields the create and edit forms share (`BidPursuitFields`). Throws
 * BidPursuitInputError for anything a person typed wrong; callers turn that
 * into a returned failure. */
function fieldsFrom(formData: FormData) {
  const projectName = text(formData, "projectName");
  if (!projectName) throw new BidPursuitInputError("Give the project a name.");
  return {
    projectName,
    owner: optionalText(formData, "owner"),
    architect: optionalText(formData, "architect"),
    expectedGcs: optionalText(formData, "expectedGcs"),
    // ENTERED, never stamped: somebody's estimate of a future date.
    expectedBidDate: optionalDateFromString(formData.get("expectedBidDate")),
    estimatedValue: optionalValueFromString(formData.get("estimatedValue")),
    stage: stageFromString(formData.get("stage") || "WATCHING"),
    note: optionalText(formData, "note"),
  };
}

export async function createBidPursuit(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  let fields: ReturnType<typeof fieldsFrom>;
  try {
    fields = fieldsFrom(formData);
  } catch (err) {
    if (err instanceof BidPursuitInputError) return fail(err.message);
    throw err;
  }

  await prisma.bidPursuit.create({
    data: { ...fields, companyId: company.id, createdByUserId: context.id },
  });

  revalidatePath("/pipeline");
  return ok;
}

export async function updateBidPursuit(id: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  let fields: ReturnType<typeof fieldsFrom>;
  try {
    fields = fieldsFrom(formData);
  } catch (err) {
    if (err instanceof BidPursuitInputError) return fail(err.message);
    throw err;
  }

  const existing = await prisma.bidPursuit.findFirst({
    where: { id, companyId: company.id },
    select: { bidInvitationId: true },
  });
  if (!existing) return fail(NOT_FOUND);
  if (existing.bidInvitationId && fields.stage !== "INVITED") return fail(LINKED_STAGE);

  // Scoped in the WHERE, so a row belonging to another company never matches.
  const updated = await prisma.bidPursuit.updateMany({ where: { id, companyId: company.id }, data: fields });
  if (updated.count === 0) return fail(NOT_FOUND);

  revalidatePath("/pipeline");
  return ok;
}

export async function setBidPursuitStage(id: string, stage: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  let next: BidPursuitStage;
  try {
    next = stageFromString(stage);
  } catch (err) {
    if (err instanceof BidPursuitInputError) return fail(err.message);
    throw err;
  }

  const existing = await prisma.bidPursuit.findFirst({
    where: { id, companyId: company.id },
    select: { bidInvitationId: true },
  });
  if (!existing) return fail(NOT_FOUND);
  // A link to a logged invitation IS the statement that the invite arrived.
  // Letting the stage say otherwise would store two facts that disagree.
  if (existing.bidInvitationId && next !== "INVITED") return fail(LINKED_STAGE);

  await prisma.bidPursuit.updateMany({ where: { id, companyId: company.id }, data: { stage: next } });

  revalidatePath("/pipeline");
  return ok;
}

/**
 * Link a pursuit to the BidInvitation it became — or, with an empty id,
 * unlink it.
 *
 * Linking moves the stage to INVITED in the same write, because linking IS
 * somebody saying the invite arrived. Unlinking leaves the stage alone: an
 * invite can have arrived by phone without being logged, which is exactly
 * what INVITED-with-no-link means.
 */
export async function linkBidPursuitToInvitation(id: string, bidInvitationId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  const pursuit = await prisma.bidPursuit.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
  if (!pursuit) return fail(NOT_FOUND);

  const invitationId = String(bidInvitationId ?? "").trim();
  if (!invitationId) {
    await prisma.bidPursuit.updateMany({ where: { id, companyId: company.id }, data: { bidInvitationId: null } });
    revalidatePath("/pipeline");
    return ok;
  }

  // Re-read through THIS company rather than trusted from the form. A forged
  // id finds nothing and is refused in the same words as a stale one — no
  // "that belongs to someone else" branch, which would be an existence oracle.
  const invitation = await prisma.bidInvitation.findFirst({
    where: { id: invitationId, companyId: company.id },
    select: { id: true },
  });
  if (!invitation) return fail("That bid invitation is not on your account.");

  try {
    await prisma.bidPursuit.updateMany({
      where: { id, companyId: company.id },
      data: { bidInvitationId: invitationId, stage: "INVITED" },
    });
  } catch (err) {
    // BY CODE, NOT BY `instanceof` — the instanceof form is false at runtime
    // in this app (shared.ts, measured 2026-08-28; it cost #304 a click test).
    if (isUniqueConstraintError(err)) {
      return fail("That invitation is already linked to another pursuit. One invitation comes from one pursuit.");
    }
    throw err;
  }

  revalidatePath("/pipeline");
  return ok;
}

/** Owner-only, like every destructive action on a list page. A pursuit is
 * not an evidence record, but it is somebody's months of chasing. */
export async function deleteBidPursuit(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;
  const refusal = ownerRefusal(context, "Only the account owner can delete a pursuit. Mark it Dropped instead.");
  if (refusal) return refusal;

  const removed = await prisma.bidPursuit.deleteMany({ where: { id, companyId: company.id } });
  if (removed.count === 0) return fail(NOT_FOUND);

  revalidatePath("/pipeline");
  return ok;
}

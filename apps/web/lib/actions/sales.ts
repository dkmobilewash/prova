"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
import { prisma } from "@prova/db";
import {
  OPPORTUNITY_STAGES,
  SALES_ACTIVITY_TYPES,
  SALES_LEAD_SOURCES,
  actionFail as fail,
  actionOk as ok,
  type ActionResult,
} from "./shared";

/** Thrown by the form parsers below, caught at each action's boundary and
 * converted to a returned failure — same shape as submittals.ts, the
 * reference implementation for this pattern. */
class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

function optionalEnum<T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] | null {
  const raw = text(formData, key);
  if (!raw) return null;
  if (!allowed.includes(raw as T[number])) throw new InputError(`"${key}" must be one of: ${allowed.join(", ")}`);
  return raw as T[number];
}

function requiredEnum<T extends readonly string[]>(formData: FormData, key: string, allowed: T, label: string): T[number] {
  const raw = text(formData, key);
  if (!allowed.includes(raw as T[number])) throw new InputError(`Pick ${label}`);
  return raw as T[number];
}

/** Stored at UTC midnight, same rule as every other date in this app. */
function optionalDate(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError("Date is not valid");
  return date;
}

function requiredDate(formData: FormData, key: string, label: string): Date {
  const date = optionalDate(formData, key);
  if (date === null) throw new InputError(`${label} is required`);
  return date;
}

function optionalDecimal(formData: FormData, key: string): string | null {
  const raw = text(formData, key);
  if (!raw) return null;
  if (Number.isNaN(Number(raw))) throw new InputError(`"${key}" must be a number`);
  return raw;
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/**
 * The only gate this whole file uses. Two independent checks, deliberately
 * NOT expressed as a lib/permissions.ts Capability: that map is about what
 * a job function can do WITHIN a company, and its own rule is "an OWNER
 * holds every capability regardless of job function" -- there is no way to
 * express "owner only, no job function grants this" in it, and forcing one
 * in would corrupt a map that is otherwise purely about roles. Tenant
 * identity (isProvaOperator) and person identity (role) are checked
 * directly instead, same as assertOwner everywhere else in this codebase.
 *
 * A non-operator company gets "not found," not an authorization message --
 * this feature does not exist for them, and saying so would be a stranger
 * kind of lie than just not showing it. A member at the operator company
 * gets the real reason, matching assertOwner's own convention.
 */
function assertSalesAccess(context: { company: { isProvaOperator: boolean }; role: string }) {
  if (!context.company.isProvaOperator) {
    throw new InputError("Not found");
  }
  if (context.role !== "OWNER") {
    throw new InputError("Only the account owner can use the sales CRM");
  }
}

async function findLead(leadId: string, companyId: string) {
  const lead = await prisma.salesLead.findUnique({ where: { id: leadId } });
  if (!lead || lead.companyId !== companyId) return null;
  return lead;
}

async function findOpportunity(opportunityId: string, companyId: string) {
  const opportunity = await prisma.salesOpportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.companyId !== companyId) return null;
  return opportunity;
}

/**
 * A move dated before the move it follows is not a date somebody meant to
 * type. Refused rather than stored: stageSpells() measures each stretch
 * from its own move to the next, so an out-of-order row would produce a
 * negative-length spell and shuffle the whole history.
 */
async function assertMoveNotBackwards(
  tx: Pick<typeof prisma, "salesStageChange">,
  opportunityId: string,
  effectiveOn: Date,
) {
  const previous = await tx.salesStageChange.findFirst({
    where: { opportunityId },
    orderBy: [{ effectiveOn: "desc" }, { recordedAt: "desc" }],
  });
  if (previous !== null && effectiveOn < previous.effectiveOn) {
    throw new InputError(
      `This deal's last recorded move was ${previous.effectiveOn.toISOString().slice(0, 10)}. A move cannot be dated before it.`,
    );
  }
}

export async function createSalesLead(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const { company } = context;

    const companyName = required(formData, "companyName", "Company name");
    const contactName = text(formData, "contactName");
    const email = text(formData, "email");
    const phone = text(formData, "phone");
    const source = optionalEnum(formData, "source", SALES_LEAD_SOURCES);

    await prisma.salesLead.create({
      data: {
        companyId: company.id,
        companyName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        source,
      },
    });

    revalidatePath("/sales");
    return ok;
  });
}

export async function updateSalesLead(leadId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const lead = await findLead(leadId, context.company.id);
    if (!lead) return fail("Lead not found");

    const companyName = required(formData, "companyName", "Company name");
    const contactName = text(formData, "contactName");
    const email = text(formData, "email");
    const phone = text(formData, "phone");
    const source = optionalEnum(formData, "source", SALES_LEAD_SOURCES);

    await prisma.salesLead.update({
      where: { id: leadId },
      data: {
        companyName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        source,
      },
    });

    revalidatePath(`/sales/${leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

/** Blocks once there's real history on record, same reasoning as
 * deleteContact -- a lead with a pipeline or a call log stays even if none
 * of it ever closed.
 *
 * Activities were added to this guard when SalesActivity was: its leadId
 * FK is RESTRICT, so without the check Postgres refuses the delete and the
 * person gets a thrown constraint error instead of a sentence telling them
 * why. Same reason deleteContact's guard grew twice. */
export async function deleteSalesLead(leadId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);

    const lead = await prisma.salesLead.findUnique({
      where: { id: leadId },
      include: { _count: { select: { opportunities: true, activities: true } } },
    });
    if (!lead || lead.companyId !== context.company.id) return fail("Lead not found");

    // Only the non-zero parts are named. "Acme has 0 opportunities and 3
    // logged activities on file" is the shape of refusal message this repo
    // has already had to fix once.
    const held: string[] = [];
    if (lead._count.opportunities > 0) {
      held.push(
        `${lead._count.opportunities} opportunit${lead._count.opportunities === 1 ? "y" : "ies"}`,
      );
    }
    if (lead._count.activities > 0) {
      held.push(
        `${lead._count.activities} logged activit${lead._count.activities === 1 ? "y" : "ies"}`,
      );
    }
    if (held.length > 0) {
      return fail(
        `${lead.companyName} has ${held.join(" and ")} on file, so its record stays. Only a lead with no history can be deleted.`,
      );
    }

    await prisma.salesLead.delete({ where: { id: leadId } });
    revalidatePath("/sales");
    return ok;
  });
}

export async function createSalesOpportunity(leadId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const userId = context.id;
  return runAction(async () => {
    assertSalesAccess(context);
    const lead = await findLead(leadId, context.company.id);
    if (!lead) return fail("Lead not found");

    const stage = requiredEnum(formData, "stage", OPPORTUNITY_STAGES, "a stage");
    const estimatedMrr = optionalDecimal(formData, "estimatedMrr");
    const expectedCloseDate = optionalDate(formData, "expectedCloseDate");
    const notes = text(formData, "notes");
    const stageEffectiveOn = requiredDate(formData, "stageEffectiveOn", "The date it reached this stage");
    const stageNote = text(formData, "stageNote");

    // One transaction, so a stage and its history cannot come apart. The
    // opening record has no fromStage: the deal was not moved here, it
    // started here.
    await prisma.$transaction(async (tx) => {
      const opportunity = await tx.salesOpportunity.create({
        data: {
          companyId: context.company.id,
          leadId,
          stage,
          estimatedMrr,
          expectedCloseDate,
          notes: notes || null,
        },
      });

      await tx.salesStageChange.create({
        data: {
          companyId: context.company.id,
          opportunityId: opportunity.id,
          fromStage: null,
          toStage: stage,
          effectiveOn: stageEffectiveOn,
          note: stageNote || null,
          recordedByUserId: userId,
        },
      });
    });

    revalidatePath(`/sales/${leadId}`);
    // /sales renders each lead's opportunity count, so it goes stale
    // without this -- adding a lead's first opportunity left the list
    // reading zero until something else happened to revalidate it.
    revalidatePath("/sales");
    return ok;
  });
}

export async function updateSalesOpportunity(opportunityId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const userId = context.id;
  return runAction(async () => {
    assertSalesAccess(context);
    const opportunity = await findOpportunity(opportunityId, context.company.id);
    if (!opportunity) return fail("Opportunity not found");

    const stage = requiredEnum(formData, "stage", OPPORTUNITY_STAGES, "a stage");
    const estimatedMrr = optionalDecimal(formData, "estimatedMrr");
    const expectedCloseDate = optionalDate(formData, "expectedCloseDate");
    const notes = text(formData, "notes");

    // The move is recorded ONLY when the stage actually differs. Editing
    // the MRR on a deal is not a stage change, and writing a row for it
    // would reset its time-in-stage to zero — the figure this history
    // exists to make true.
    const isMove = stage !== opportunity.stage;
    const stageEffectiveOn = isMove
      ? requiredDate(formData, "stageEffectiveOn", "The date it moved")
      : null;
    const stageNote = text(formData, "stageNote");

    await prisma.$transaction(async (tx) => {
      if (isMove && stageEffectiveOn !== null) {
        await assertMoveNotBackwards(tx, opportunityId, stageEffectiveOn);
      }

      await tx.salesOpportunity.update({
        where: { id: opportunityId },
        data: { stage, estimatedMrr, expectedCloseDate, notes: notes || null },
      });

      if (isMove && stageEffectiveOn !== null) {
        await tx.salesStageChange.create({
          data: {
            companyId: context.company.id,
            opportunityId,
            fromStage: opportunity.stage,
            toStage: stage,
            effectiveOn: stageEffectiveOn,
            note: stageNote || null,
            recordedByUserId: userId,
          },
        });
      }
    });

    revalidatePath(`/sales/${opportunity.leadId}`);
    return ok;
  });
}

export async function deleteSalesOpportunity(opportunityId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const opportunity = await findOpportunity(opportunityId, context.company.id);
    if (!opportunity) return fail("Opportunity not found");

    await prisma.salesOpportunity.delete({ where: { id: opportunityId } });
    revalidatePath(`/sales/${opportunity.leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

async function findActivity(activityId: string, companyId: string) {
  const activity = await prisma.salesActivity.findUnique({ where: { id: activityId } });
  if (!activity || activity.companyId !== companyId) return null;
  return activity;
}

/**
 * Which deal this activity was about, if any. Empty is valid and common —
 * an intro call happens before an opportunity exists. A named opportunity
 * must belong to THIS lead: without the check, an owner could attribute a
 * call to a deal with a different company, and the row would look correct
 * from every page that renders it.
 */
async function readOpportunityField(
  formData: FormData,
  leadId: string,
  companyId: string,
): Promise<string | null> {
  const opportunityId = text(formData, "opportunityId");
  if (!opportunityId) return null;

  const opportunity = await prisma.salesOpportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.companyId !== companyId || opportunity.leadId !== leadId) {
    throw new InputError("That opportunity is not one of this lead's");
  }
  return opportunityId;
}

/**
 * An activity dated in the future has not happened.
 *
 * The log records what took place; something upcoming belongs in the
 * follow-up field, which the form says as much. Refused because of what a
 * future row DOES to the rest of the feature: supersession reads the
 * lead's latest activity, so a note dated tomorrow silently cleared a real
 * outstanding follow-up and marked it "since superseded" — found in the
 * browser on 2026-09-04. lib/sales-activity.ts's occurredBy() makes the
 * rows already in the database read correctly; this stops new ones.
 */
function assertNotInTheFuture(occurredOn: Date, todayIso: string) {
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  if (occurredOn > today) {
    throw new InputError(
      "That date is in the future. Log what happened; use the follow-up date for what is still to come.",
    );
  }
}

/**
 * A follow-up before the thing it follows up on is not a date somebody
 * meant to type. Refused rather than stored, because /sales reads the
 * latest activity's followUpOn as what the lead owes, and a backwards one
 * would sit at the top of the queue permanently overdue.
 */
function assertFollowUpNotBackwards(occurredOn: Date, followUpOn: Date | null) {
  if (followUpOn !== null && followUpOn < occurredOn) {
    throw new InputError("The follow-up date is before the activity it follows up on");
  }
}

export async function createSalesActivity(leadId: string, formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess({ company, role: user.role });
    const lead = await findLead(leadId, company.id);
    if (!lead) return fail("Lead not found");

    const type = requiredEnum(formData, "type", SALES_ACTIVITY_TYPES, "what kind of activity this was");
    const occurredOn = requiredDate(formData, "occurredOn", "The date it happened");
    const summary = required(formData, "summary", "A summary");
    const followUpOn = optionalDate(formData, "followUpOn");
    assertNotInTheFuture(occurredOn, await viewerToday());
    assertFollowUpNotBackwards(occurredOn, followUpOn);
    const opportunityId = await readOpportunityField(formData, leadId, company.id);

    await prisma.salesActivity.create({
      data: {
        companyId: company.id,
        leadId,
        type,
        occurredOn,
        summary,
        followUpOn,
        opportunityId,
        loggedByUserId: user.id,
      },
    });

    revalidatePath(`/sales/${leadId}`);
    // The follow-up queue and the last-contact column both live on /sales
    // and are derived from these rows, so both move with every write here.
    revalidatePath("/sales");
    return ok;
  });
}

/** loggedByUserId is deliberately not editable — who recorded an entry is
 * audit, not content, same as ContactInteraction. */
export async function updateSalesActivity(
  activityId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const activity = await findActivity(activityId, context.company.id);
    if (!activity) return fail("Activity not found");

    const type = requiredEnum(formData, "type", SALES_ACTIVITY_TYPES, "what kind of activity this was");
    const occurredOn = requiredDate(formData, "occurredOn", "The date it happened");
    const summary = required(formData, "summary", "A summary");
    const followUpOn = optionalDate(formData, "followUpOn");
    assertNotInTheFuture(occurredOn, await viewerToday());
    assertFollowUpNotBackwards(occurredOn, followUpOn);
    const opportunityId = await readOpportunityField(formData, activity.leadId, context.company.id);

    await prisma.salesActivity.update({
      where: { id: activityId },
      data: { type, occurredOn, summary, followUpOn, opportunityId },
    });

    revalidatePath(`/sales/${activity.leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

/**
 * Deletable, unlike an RFI or a submittal. This is an internal log of our
 * own conversations, not evidence sent to anyone — a call logged against
 * the wrong lead should be removable rather than corrected into a lie.
 */
export async function deleteSalesActivity(activityId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const activity = await findActivity(activityId, context.company.id);
    if (!activity) return fail("Activity not found");

    await prisma.salesActivity.delete({ where: { id: activityId } });

    revalidatePath(`/sales/${activity.leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

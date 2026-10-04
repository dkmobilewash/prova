"use server";

import { revalidatePath } from "next/cache";
import { numericReaders } from "@/lib/numeric-input";
import { requireCompanyContext } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
// The signal kinds and review decisions are imported from the module that
// OWNS them rather than redeclared beside the other sales enums in
// ./shared. A second copy of a canonical list is the #526 defect, and a
// completeness test on the first copy cannot see the second.
import {
  REVIEW_DECISIONS,
  SALES_SIGNAL_KINDS,
  type ReviewDecision,
} from "@/lib/sales-qualification";
import { parseSubListing } from "@/lib/sub-listing/parse";
import { PRIME_OUTCOMES, signalsForSub } from "@/lib/sub-listing/signals";
import { normaliseCompanyName } from "@/lib/sub-listing/leadMatch";
import { prisma } from "@prova/db";
import {
  InputError,
  OPPORTUNITY_STAGES,
  SALES_ACTIVITY_TYPES,
  SALES_LEAD_SOURCES,
  actionFail as fail,
  optionalLinkFromForm,
  actionOk as ok,
  joinWithConjunction,
  runAction,
  type ActionResult,
  type ActionResultWith,
} from "./shared";

// `InputError` and `runAction` are imported from ./shared rather than
// declared here. Two classes with the same name are not the same class:
// `instanceof` is false between them, so a refusal thrown by a shared
// parser walked straight past a local boundary and reached production as a
// redacted digest. That is what #407 found on /welcome, and this module
// held the fifteenth copy of the class it found there.

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

function optionalEnum<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
): T[number] | null {
  const raw = text(formData, key);
  if (!raw) return null;
  if (!allowed.includes(raw as T[number]))
    throw new InputError(`"${key}" must be one of: ${allowed.join(", ")}`);
  return raw as T[number];
}

function requiredEnum<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
  label: string,
): T[number] {
  const raw = text(formData, key);
  if (!allowed.includes(raw as T[number]))
    throw new InputError(`Pick ${label}`);
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

const { optionalNumber } = numericReaders((message) => {
  throw new InputError(message);
});

function optionalDecimal(formData: FormData, key: string): string | null {
  return optionalNumber(formData, key, { maxDecimals: 2 })?.value ?? null;
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
function assertSalesAccess(context: {
  company: { isProvaOperator: boolean };
  role: string;
}) {
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
  const opportunity = await prisma.salesOpportunity.findUnique({
    where: { id: opportunityId },
  });
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

export async function createSalesLead(
  formData: FormData,
): Promise<ActionResult> {
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

export async function updateSalesLead(
  leadId: string,
  formData: FormData,
): Promise<ActionResult> {
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
      include: {
        _count: {
          select: { opportunities: true, activities: true, signals: true },
        },
      },
    });
    if (!lead || lead.companyId !== context.company.id)
      return fail("Lead not found");

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
    // Signals are RESTRICT children too, and counting them here is NOT
    // optional: WORK-SPLIT records this exact guard shipping without the
    // activities count while `SalesActivity.leadId` was already RESTRICT, so
    // the delete failed at the database with a message production redacts.
    // A researched lead now refuses deletion and says how much evidence it is
    // holding — which is also the right answer on the merits, since the
    // research is the expensive part of the record.
    if (lead._count.signals > 0) {
      held.push(
        `${lead._count.signals} researched signal${lead._count.signals === 1 ? "" : "s"}`,
      );
    }
    if (held.length > 0) {
      // #218: `held.join(" and ")` was written when this only ever saw two
      // possible entries (opportunities, activities), so it never had to be
      // "a, b, and c" — which it now does, with signals. joinWithConjunction
      // is the shared style, same as deleteContact, and it already handled
      // three; the comment is updated because the two-entry reasoning it gave
      // has stopped being true.
      return fail(
        `${lead.companyName} has ${joinWithConjunction(held)} on file, so its record stays. Only a lead with no history can be deleted.`,
      );
    }

    await prisma.salesLead.delete({ where: { id: leadId } });
    revalidatePath("/sales");
    return ok;
  });
}

export async function createSalesOpportunity(
  leadId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const userId = context.id;
  return runAction(async () => {
    assertSalesAccess(context);
    const lead = await findLead(leadId, context.company.id);
    if (!lead) return fail("Lead not found");

    const stage = requiredEnum(
      formData,
      "stage",
      OPPORTUNITY_STAGES,
      "a stage",
    );
    const estimatedMrr = optionalDecimal(formData, "estimatedMrr");
    const expectedCloseDate = optionalDate(formData, "expectedCloseDate");
    const notes = text(formData, "notes");
    const stageEffectiveOn = requiredDate(
      formData,
      "stageEffectiveOn",
      "The date it reached this stage",
    );
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

export async function updateSalesOpportunity(
  opportunityId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const userId = context.id;
  return runAction(async () => {
    assertSalesAccess(context);
    const opportunity = await findOpportunity(
      opportunityId,
      context.company.id,
    );
    if (!opportunity) return fail("Opportunity not found");

    const stage = requiredEnum(
      formData,
      "stage",
      OPPORTUNITY_STAGES,
      "a stage",
    );
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
    // Its siblings (create, delete) both revalidate /sales too -- this one
    // didn't, so a stage move made from the detail page left the pipeline
    // band on /sales showing the old stage until something else forced a
    // refresh. /sales's pipeline totals, columns and "sitting longest" are
    // all derived from exactly the stage this action just moved. #153.
    revalidatePath("/sales");
    return ok;
  });
}

export async function deleteSalesOpportunity(
  opportunityId: string,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const opportunity = await findOpportunity(
      opportunityId,
      context.company.id,
    );
    if (!opportunity) return fail("Opportunity not found");

    await prisma.salesOpportunity.delete({ where: { id: opportunityId } });
    revalidatePath(`/sales/${opportunity.leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

async function findActivity(activityId: string, companyId: string) {
  const activity = await prisma.salesActivity.findUnique({
    where: { id: activityId },
  });
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

  const opportunity = await prisma.salesOpportunity.findUnique({
    where: { id: opportunityId },
  });
  if (
    !opportunity ||
    opportunity.companyId !== companyId ||
    opportunity.leadId !== leadId
  ) {
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
    throw new InputError(
      "The follow-up date is before the activity it follows up on",
    );
  }
}

export async function createSalesActivity(
  leadId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess({ company, role: user.role });
    const lead = await findLead(leadId, company.id);
    if (!lead) return fail("Lead not found");

    const type = requiredEnum(
      formData,
      "type",
      SALES_ACTIVITY_TYPES,
      "what kind of activity this was",
    );
    const occurredOn = requiredDate(
      formData,
      "occurredOn",
      "The date it happened",
    );
    const summary = required(formData, "summary", "A summary");
    const followUpOn = optionalDate(formData, "followUpOn");
    assertNotInTheFuture(occurredOn, await viewerToday());
    assertFollowUpNotBackwards(occurredOn, followUpOn);
    const opportunityId = await readOpportunityField(
      formData,
      leadId,
      company.id,
    );

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

    const type = requiredEnum(
      formData,
      "type",
      SALES_ACTIVITY_TYPES,
      "what kind of activity this was",
    );
    const occurredOn = requiredDate(
      formData,
      "occurredOn",
      "The date it happened",
    );
    const summary = required(formData, "summary", "A summary");
    const followUpOn = optionalDate(formData, "followUpOn");
    assertNotInTheFuture(occurredOn, await viewerToday());
    assertFollowUpNotBackwards(occurredOn, followUpOn);
    const opportunityId = await readOpportunityField(
      formData,
      activity.leadId,
      context.company.id,
    );

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
export async function deleteSalesActivity(
  activityId: string,
): Promise<ActionResult> {
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

/* ------------------------------------------------------------------------- *
 * Signals: what we know about a prospect, each with the page it came from.
 * ------------------------------------------------------------------------- */

/**
 * `sourceUrl` is required, so this composes the shared optional reader rather
 * than adding a fourth copy of URL validation — `shared.ts` documents at
 * length how three copies of that check drifted and two fields had none at
 * all. The required-ness is the only thing added here.
 */
function requiredSourceUrl(formData: FormData): string {
  const link = optionalLinkFromForm(formData, "sourceUrl", "The source link");
  if (!link.ok) throw new InputError(link.error);
  if (!link.value) {
    throw new InputError(
      "A signal needs the page you read it on. Without a source it is a rumour, and it will be read as a fact on a call.",
    );
  }
  return link.value;
}

export async function createSalesLeadSignal(
  leadId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess({ company, role: user.role });
    const lead = await findLead(leadId, company.id);
    if (!lead) return fail("Lead not found");

    const kind = requiredEnum(
      formData,
      "kind",
      SALES_SIGNAL_KINDS,
      "what this tells you",
    );
    const claim = required(formData, "claim", "What you found");
    const sourceUrl = requiredSourceUrl(formData);
    const sourceTitle = text(formData, "sourceTitle") || null;
    const disqualifies = formData.get("disqualifies") === "on";

    /* Typed in BY A PERSON, so it lands CONFIRMED and reviewed by them — they
       are the review. Only the research seam creates PROPOSED rows, and the
       band counts CONFIRMED only, so defaulting this to PROPOSED would hide a
       hand-entered fact from the band that exists to use it. */
    await prisma.salesLeadSignal.create({
      data: {
        companyId: company.id,
        leadId,
        kind,
        claim,
        sourceUrl,
        sourceTitle,
        disqualifies,
        state: "CONFIRMED",
        reviewedAt: new Date(),
        reviewedByUserId: user.id,
      },
    });

    revalidatePath(`/sales/${leadId}`);
    // The band is derived from these rows and shows on BOTH pages. Revalidating
    // only the detail page is the bug WORK-SPLIT records for activities, where
    // /sales went stale for the same reason.
    revalidatePath("/sales");
    return ok;
  });
}

/**
 * Move a signal off PROPOSED. There is no path back to it: PROPOSED means
 * nobody has looked, and a reviewed signal has been looked at whichever way it
 * went.
 */
export async function reviewSalesLeadSignal(
  signalId: string,
  decision: ReviewDecision,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess({ company, role: user.role });

    if (!REVIEW_DECISIONS.includes(decision)) {
      return fail("That is not a review decision");
    }

    const signal = await prisma.salesLeadSignal.findUnique({
      where: { id: signalId },
    });
    if (!signal || signal.companyId !== company.id)
      return fail("Signal not found");

    await prisma.salesLeadSignal.update({
      where: { id: signalId },
      data: {
        state: decision,
        reviewedAt: new Date(),
        reviewedByUserId: user.id,
      },
    });

    revalidatePath(`/sales/${signal.leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

/**
 * Correct a signal's claim or its source. DELIBERATELY NOT A DELETE, and not
 * an edit of `kind` either.
 *
 * Evidence records in this app lock their identity fields after creation and
 * close rather than delete — a dismissed signal is the memory that we already
 * looked at this and it was wrong, which is what stops the next search
 * re-proposing it. So a wrong signal is DISMISSED through the action above.
 * What this allows is fixing a typo in the sentence or a truncated URL, which
 * is a correction to the record rather than a change to what it says.
 */
export async function updateSalesLeadSignal(
  signalId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess({ company, role: user.role });

    const signal = await prisma.salesLeadSignal.findUnique({
      where: { id: signalId },
    });
    if (!signal || signal.companyId !== company.id)
      return fail("Signal not found");

    const claim = required(formData, "claim", "What you found");
    const sourceUrl = requiredSourceUrl(formData);
    const sourceTitle = text(formData, "sourceTitle") || null;

    await prisma.salesLeadSignal.update({
      where: { id: signalId },
      data: { claim, sourceUrl, sourceTitle },
    });

    revalidatePath(`/sales/${signal.leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

/* --------------------------------------------------------------------- */
/* Reading a public subcontractor listing                                 */
/* --------------------------------------------------------------------- */

/**
 * IMPORTING SUBCONTRACTORS OFF A PUBLIC BID OR AWARD DOCUMENT.
 *
 * The acquisition motion: find a project out to bid or recently awarded, find
 * the subs named on it, and reach each one about their own job. `lib/sub-listing/`
 * does the reading; this does the writing, and the two halves are deliberately
 * separate because one is pure and testable and the other is not.
 *
 * ── THE CLIENT CANNOT INVENT A SUBCONTRACTOR ──
 *
 * The browser parses the pasted text to show a review table, and then the
 * confirm sends **the raw text again** and this function parses it a second
 * time with the same parser. Nothing the screen displays is trusted: a row that
 * is not in the server's own reading of the document cannot be imported,
 * because the server never sees the client's rows at all. That is
 * `SpreadsheetImport`'s rule — *"what lands can never be something this
 * component invented"* — and it matters more here, because what lands is a
 * sourced claim somebody will read down a telephone.
 *
 * The selection arrives as LINE NUMBERS, which is the only thing the two
 * parses are guaranteed to agree on. If the counts do not match, the import is
 * refused rather than reconciled — a listing that reads differently on the
 * server than it did in the browser is not something to guess about.
 *
 * ── EVERYTHING LANDS PROPOSED ──
 *
 * `createSalesLeadSignal` forces `CONFIRMED` and stamps the reviewer, on the
 * theory that a person typing a signal in IS the review. Nothing here is typed
 * by a person, so nothing here may claim to have been reviewed: every row lands
 * `PROPOSED` with no reviewer, and the band cannot move until somebody presses
 * Confirm on the lead. A machine-proposed signal that counted toward a band
 * would make the band measure how much reading happened rather than what is
 * known.
 *
 * ── NO MODEL, AND THAT IS A LANE DECISION AS WELL AS A DESIGN ONE ──
 *
 * This reads a table with a parser, not a document with a model. AI extraction
 * is Diego's lane (CLAUDE.md, from 2026-09-26), so a model-based reader here
 * would be in the wrong lane AND would carry the invention failure
 * `lib/research/bidResearch.eval.ts` exists to measure. A subcontractor listing
 * is a table; a parser is the right instrument and the cheaper one.
 */
export type SubListingImportSummary = {
  leadsCreated: number;
  leadsAttached: number;
  signalsProposed: number;
  rowsSkipped: number;
};

/** One pasted page's worth. A listing with more rows than this is a document
 *  nobody has reviewed, and the review is the point. */
const MAX_LISTING_ROWS = 60;

/**
 * WHAT THIS DOCUMENT HAS SAID ABOUT ONE ROW, FOR DECIDING WHETHER THE NEXT ROW
 * IS THE SAME COMPANY.
 *
 * Only the two rungs below are ever enough. `normaliseCompanyName` alone is NOT,
 * and that was the defect: it strips entity suffixes, so
 *
 *     "Valley Interiors, Inc."  ->  "valley interiors"
 *     "Valley Interiors, LLC"   ->  "valley interiors"
 *     "Baker Drywall Co"        ->  "baker drywall"
 *     "Baker Drywall Corp"      ->  "baker drywall"
 *
 * and two genuinely different legal companies collapsed into one `SalesLead`
 * with both sets of claims on it. An Inc. and an LLC trading under one name are
 * different companies, and this trade is full of them. The only thing the user
 * saw was `leadsCreated` reading one lower than the number of rows they ticked.
 *
 * `leadMatch.ts` refuses to do this against a PRE-EXISTING lead and says why in
 * its own header — *"An automatic merge on a name is the same class of error as
 * the one the whole feature is built to avoid"* — so the in-import path doing it
 * silently was this file taking the opposite decision on the same evidence. The
 * rule below is the same rule as `leadMatch.ts`'s, one notch further: merge only
 * on evidence of SAMENESS printed in the document, and never over evidence of
 * difference.
 */
type ImportedCompany = {
  leadId: string;
  /** The name exactly as printed — case and runs of whitespace aside, which are
   *  typing rather than identity. */
  spelling: string;
  /** The name with punctuation and entity suffixes gone. Never enough on its
   *  own; only ever read together with an identifier. */
  normalised: string;
  /**
   * The licence's DIGITS. A contractor holds ONE licence number under several
   * classifications, so "C-9 884201" on the framing row and "C-35 884201" on the
   * plaster row are the same contractor and differ as strings. The class prefix
   * is not identity; the number is.
   */
  licence: string | null;
  /** A public-works registration number as printed. */
  registration: string | null;
};

function identify(row: {
  name: string;
  licence: string | null;
  registration: string | null;
}): Omit<ImportedCompany, "leadId"> {
  const digits = row.licence?.match(/(\d{6,8})\s*$/);
  return {
    spelling: row.name.toLowerCase().replace(/\s+/g, " ").trim(),
    normalised: normaliseCompanyName(row.name),
    licence: digits ? digits[1] : null,
    registration: row.registration,
  };
}

/**
 * Has this row already been imported, in this same pass?
 *
 * Two rungs, and a CONTRADICTION beats both of them:
 *
 *  1. The document spells the name identically on both rows. A §4104 listing
 *     names a subcontractor once per PORTION OF WORK, so a sub doing framing and
 *     plaster appears twice on one page — one table entry, written out twice by
 *     one clerk. That is the case the dedupe was written for, and it is a far
 *     stronger piece of evidence than two names typed by two people in two
 *     places, which is the situation `leadMatch.ts` refuses to act on.
 *  2. The names agree once entity suffixes go AND the document prints the SAME
 *     licence or registration number on both. `leadMatch.ts` names the reason
 *     this is allowed to decide: "a contractor licence is the one identifier in
 *     this trade that is unique, printed on the document, and typed by neither
 *     party". That is what lets "Valley Interior Systems" and "Valley Interior
 *     Systems, Inc." be one lead while "Valley Interiors, Inc." and "Valley
 *     Interiors, LLC" are two.
 *
 * And the contradiction, which runs the other way and is checked first: if both
 * rows print an identifier OF THE SAME KIND and the two differ, they are not the
 * same company whatever the names look like. There is nothing left for an
 * identical spelling to add — the document has already said these are two
 * registrants.
 *
 * Nothing here merges a row into a lead that existed BEFORE this import. That
 * stays a human choice on the review screen, unchanged.
 *
 * A linear scan: `MAX_LISTING_ROWS` is 60, and a map keyed on one of two
 * possible keys would have to be read twice and written twice anyway.
 */
function alreadyImported(
  row: Omit<ImportedCompany, "leadId">,
  imported: readonly ImportedCompany[],
): string | null {
  const contradicts = (a: string | null, b: string | null) => a !== null && b !== null && a !== b;

  for (const seen of imported) {
    if (contradicts(row.licence, seen.licence)) continue;
    if (contradicts(row.registration, seen.registration)) continue;

    if (row.spelling && row.spelling === seen.spelling) return seen.leadId;

    const identified =
      (row.licence !== null && row.licence === seen.licence) ||
      (row.registration !== null && row.registration === seen.registration);
    if (identified && row.normalised && row.normalised === seen.normalised) return seen.leadId;
  }

  return null;
}

export async function importSubListing(
  formData: FormData,
): Promise<ActionResultWith<SubListingImportSummary>> {
  const { company, ...user } = await requireCompanyContext();
  try {
    assertSalesAccess({ company, role: user.role });

    const listingText = required(formData, "listingText", "The listing you pasted");

    // `requiredSourceUrl` rather than a second copy of it: it is 200 lines above
    // in this same file, it is what the hand-typed path uses, and the two had
    // already drifted to different wordings for the same refusal — #526 in
    // miniature. It throws `InputError`, which the catch below converts.
    const sourceUrl = requiredSourceUrl(formData);
    const sourceTitle = text(formData, "sourceTitle") || null;
    const primeOutcome = requiredEnum(
      formData,
      "primeOutcome",
      PRIME_OUTCOMES,
      "whether the prime's bid won",
    );

    const parsed = parseSubListing(listingText);

    const wanted = text(formData, "lines")
      .split(",")
      .map((entry) => Number.parseInt(entry.trim(), 10))
      .filter((line) => Number.isInteger(line));
    const unique = [...new Set(wanted)];

    if (unique.length === 0) return { ok: false, error: "Pick at least one subcontractor to add." };
    if (unique.length > MAX_LISTING_ROWS) {
      return {
        ok: false,
        error: `That is ${unique.length} subcontractors at once. Import up to ${MAX_LISTING_ROWS} so the reading stays something a person has actually looked at.`,
      };
    }

    const chosen = parsed.rows.filter((row) => unique.includes(row.line));
    if (chosen.length !== unique.length) {
      return {
        ok: false,
        error:
          "The listing does not read the same way now as it did on screen, so nothing was added. Paste it again and pick from the fresh reading.",
      };
    }

    const touched = new Set<string>();

    const summary = await prisma.$transaction(async (tx) => {
      let leadsCreated = 0;
      let leadsAttached = 0;
      let signalsProposed = 0;
      let rowsSkipped = 0;

      /**
       * Leads created inside THIS import, with what the document printed about
       * each — see `alreadyImported` above for the rule and why it is that rule.
       *
       * `leadCandidatesFor` only ever sees the leads that existed before the
       * import, so it cannot match a row against one created two rows ago. A
       * §4104 listing names a subcontractor once per PORTION OF WORK, so a sub
       * doing both framing and plaster appears twice on one page — and that
       * produced two `SalesLead` rows with the same name in a single
       * transaction, which is the exact thing `leadMatch.ts` says the whole
       * matching exercise is for. Both were then undeletable, because a lead
       * with signals on it cannot be removed.
       *
       * It was keyed on `normaliseCompanyName(row.name)` alone, which fixed that
       * at the price of a worse failure in the other direction: an Inc. and an
       * LLC with one trading name normalise to the same string and became one
       * lead carrying both companies' claims.
       */
      const importedHere: ImportedCompany[] = [];

      for (const row of chosen) {
        const proposals = signalsForSub(row, parsed.header, primeOutcome);
        if (proposals.length === 0) {
          // A row with no checkable fact would produce a lead with nothing on
          // it, which is worse than no lead: it reads as researched.
          rowsSkipped += 1;
          continue;
        }

        const attachTo = text(formData, `attach:${row.line}`);
        let leadId: string;

        if (attachTo) {
          // Re-read and re-scope INSIDE the transaction. The candidate list the
          // reviewer chose from was rendered from an earlier read.
          const existing = await tx.salesLead.findUnique({ where: { id: attachTo } });
          if (!existing || existing.companyId !== company.id) {
            throw new InputError(
              "One of the leads you chose to add to is no longer there, so nothing was added. Paste the listing again.",
            );
          }
          leadId = existing.id;
          leadsAttached += 1;
        } else {
          const identity = identify(row);
          const already = alreadyImported(identity, importedHere);
          if (already) {
            leadId = already;
          } else {
            const created = await tx.salesLead.create({
              data: {
                companyId: company.id,
                companyName: row.name,
                source: "OUTBOUND",
              },
            });
            leadId = created.id;
            leadsCreated += 1;
            importedHere.push({ ...identity, leadId: created.id });
          }
        }

        await tx.salesLeadSignal.createMany({
          data: proposals.map((proposal) => ({
            companyId: company.id,
            leadId,
            kind: proposal.kind,
            claim: proposal.claim,
            sourceUrl,
            sourceTitle,
            // PROPOSED, with no reviewer. Nothing here was reviewed by anybody.
            state: "PROPOSED" as const,
          })),
        });
        signalsProposed += proposals.length;
        touched.add(leadId);
      }

      return { leadsCreated, leadsAttached, signalsProposed, rowsSkipped };
    });

    // BOTH pages, because the band is derived from these rows and renders on
    // each. `createSalesLeadSignal` revalidates both and says why; this had the
    // mirror-image omission, so a lead already open in another tab would have
    // shown its old band.
    for (const leadId of touched) revalidatePath(`/sales/${leadId}`);
    revalidatePath("/sales");
    return { ok: true, value: summary };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}

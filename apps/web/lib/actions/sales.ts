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
import { looksCutOff, parseSubListing } from "@/lib/sub-listing/parse";
// The licence number is a JOIN KEY, and there is exactly one place that makes
// one — see the module header. `identify()` below used to carry its own copy of
// the digit rule, which is the #526 shape: a canonical rule with a hand-rolled
// duplicate beside it, where a completeness test on the first cannot see the
// second.
import { licenceNumberFrom, readTypedLicence } from "@/lib/sales-licence";
import { PRIME_OUTCOMES, listedByGcFor, signalsForSub } from "@/lib/sub-listing/signals";
import type { ListedSub as ListedSubRow, SubListingParse } from "@/lib/sub-listing/parse";
import { identifiersContradict, normaliseCompanyName } from "@/lib/sub-listing/leadMatch";
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

/**
 * THE TWO LISTING COLUMNS A PERSON CAN ALSO TYPE, read for the create and edit
 * forms so the two cannot drift.
 *
 * Only two of the five. `licenceNumber` and `city` are things somebody knows
 * about a company they just met; `registrationNumber`, `listedByGc` and
 * `listedOnProject` are PROVENANCE — which document introduced this lead — and a
 * box that let anyone retype that would make it a claim about the past rather
 * than a record of it. The import writes those three; nothing else does.
 *
 * The licence is refused rather than silently dropped when it is not a licence
 * number. `readTypedLicence`'s header argues that out: the field is labelled on
 * screen as the number a CSLB lookup uses, nothing downstream reviews it, and
 * the person who can fix it is the one looking at the box.
 */
function readListingFields(formData: FormData): {
  licenceNumber: string | null;
  city: string | null;
} {
  const licence = readTypedLicence(text(formData, "licenceNumber"));
  if (!licence.ok) throw new InputError(licence.why);
  return { licenceNumber: licence.licenceNumber, city: text(formData, "city") || null };
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
    const listing = readListingFields(formData);

    await prisma.salesLead.create({
      data: {
        companyId: company.id,
        companyName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        source,
        ...listing,
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
    /* Editable, and that is the point rather than an oversight: an import can
       put the wrong licence on a lead (a listing misprints one, or a row was
       attached to the wrong company), and a join key nobody can correct is a
       wrong number that looks up as somebody else for good. The provenance
       columns are not here — see `readListingFields`. */
    const listing = readListingFields(formData);

    await prisma.salesLead.update({
      where: { id: leadId },
      data: {
        companyName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        source,
        ...listing,
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
  return {
    spelling: row.name.toLowerCase().replace(/\s+/g, " ").trim(),
    normalised: normaliseCompanyName(row.name),
    // `licenceNumberFrom`, not a local regex. The local one was anchored at the
    // END of the string, so it read "C-9 884201" and missed "884201 (C-9)" — and
    // more to the point, it meant the number used to decide IDENTITY here and
    // the number STORED on the lead were produced by two different rules that
    // nothing compared. One extractor, one digit width, one test.
    licence: licenceNumberFrom(row.licence),
    registration: row.registration,
  };
}

/*
 * `identifiersContradict` MOVED to `lib/sub-listing/leadMatch.ts` and is
 * imported above. It was private to this file until the review screen needed
 * the same answer — and two copies of "are these the same registrant" in one
 * app is the second-list failure CLAUDE.md records, free to drift in whichever
 * direction nothing tested. `ImportedCompany` satisfies its parameter type
 * structurally, so every call site below is unchanged.
 */

/**
 * THE RULE THAT TRAVELS BETWEEN DOCUMENTS: an identifier neither party typed,
 * corroborated by the name.
 *
 * One implementation, read by the in-pass dedupe and by the cross-import lookup
 * alike, so the question "are these the same firm" has one answer in this file
 * rather than two that have to be kept in step.
 *
 * The identical-SPELLING rung deliberately lives in `alreadyImported` instead of
 * here, and that placement is the point rather than an oversight. It was briefly
 * a `spellingIsEnough` flag on this function, and a mutation flipping that flag
 * at the cross-import call site SURVIVED every test — correctly, because it
 * cannot matter there: that caller's query has already filtered on the licence,
 * so the identifier leg below is satisfied for every candidate it sees, and
 * spelling equality implies normalised equality (522 spelling-equal name pairs
 * checked, no counterexample, since both reduce the same lowercased string and
 * removing punctuation before collapsing whitespace is blind to run length). A
 * parameter that cannot change an outcome is a knob a reader will believe in, so
 * it is gone. The rung now sits where it is true and nowhere else.
 */
function sameCompany(
  row: Omit<ImportedCompany, "leadId">,
  known: Omit<ImportedCompany, "leadId">,
): boolean {
  if (identifiersContradict(row, known)) return false;

  const identified =
    (row.licence !== null && row.licence === known.licence) ||
    (row.registration !== null && row.registration === known.registration);
  return identified && !!row.normalised && row.normalised === known.normalised;
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
 * This function sees only rows of the CURRENT paste. A lead that existed BEFORE
 * this import is reached by `leadHoldingThisLicence` below, on the licence alone
 * and with the name corroborating it — a deliberately narrower rule than this
 * one, for the reason that function gives. (This sentence used to read "nothing
 * here merges a row into a lead that existed BEFORE this import — that stays a
 * human choice on the review screen", which was true when written and had
 * stopped being the whole story: the human choice is still there and is still
 * the only way a row joins a lead the licence cannot identify.)
 *
 * A linear scan: `MAX_LISTING_ROWS` is 60, and a map keyed on one of two
 * possible keys would have to be read twice and written twice anyway.
 */
function alreadyImported(
  row: Omit<ImportedCompany, "leadId">,
  imported: readonly ImportedCompany[],
): ImportedCompany | null {
  for (const seen of imported) {
    if (identifiersContradict(row, seen)) continue;

    /* WITHIN ONE DOCUMENT, and only within one, an identical spelling is enough
       by itself. A §4104 listing names a subcontractor once per PORTION OF WORK,
       so two identical spellings on one page are one table entry written out
       twice by one clerk. Two documents spelling a name the same way is two
       agencies' clerks agreeing by coincidence, which is exactly what
       `leadMatch.ts` refuses to act on — so this rung is not reachable from
       `leadHoldingThisLicence`, by construction rather than by a flag. */
    if (row.spelling && row.spelling === seen.spelling) return seen;

    if (sameCompany(row, seen)) return seen;
  }
  return null;
}

/**
 * EVERYTHING THIS PASTE NOW KNOWS ABOUT ONE FIRM, GATHERED ONTO THE ONE ENTRY
 * THAT STANDS FOR IT.
 *
 * Found by review on 2026-10-05, and it is the defect the entry below was most
 * likely to grow. `importedHere` held what a SINGLE row printed, and a row that
 * merged into an existing entry taught it nothing — so the entry stayed as weak
 * as the first row that made it, forever. Two consequences, both measured:
 *
 *   - a row merging onto a lead from an EARLIER import pushed its own
 *     identifiers rather than that lead's, so a later row of the same paste
 *     carrying a CONTRADICTING registration saw `registration: null`, found no
 *     contradiction, matched on spelling and wrote another registrant's DIR
 *     number onto a lead with real history;
 *   - a blank-licence row above two rows carrying DIFFERENT licences was a
 *     bridge between them: each compared against the blank entry, neither
 *     contradicted it, and all three welded into one lead. Reversing the rows
 *     gave two leads. The rule was order-dependent, and this file's own header
 *     says a same-kind disagreement "outranks every resemblance".
 *
 * `identifiersContradict` was never the problem — `alreadyImported` has called
 * it first since it was written. It was being asked about an entry that had not
 * been told. So this fills the blanks and never overwrites, which is the same
 * rule the lead columns themselves follow further down.
 */
function absorb(entry: ImportedCompany, row: Omit<ImportedCompany, "leadId">): void {
  entry.licence ??= row.licence;
  entry.registration ??= row.registration;
}

/**
 * THE SAME FIRM ARRIVING IN A SECOND IMPORT — THE CASE THE WHOLE CHANNEL IS
 * MADE OF, AND THE ONE NOTHING WAS HANDLING.
 *
 * Measured before it was built, which is why this exists: three imports naming
 * one licence — "Probe Drywall, Inc.", "PROBE DRYWALL INC" and a third spelling
 * — produced THREE `SalesLead` rows, each stamped `licenceNumber: "884201"`, each
 * carrying five PROPOSED signals and each therefore PERMANENTLY UNDELETABLE
 * (`deleteSalesLead` refuses a lead holding signals, and that refusal is right).
 * The column and its `(companyId, licenceNumber)` index already existed and
 * nothing read them for identity.
 *
 * That is the failure `leadMatch.ts` says the whole matching exercise is for,
 * one level out: it fixed the five-leads-one-signal-each case WITHIN a page and
 * left it untouched between pages, where the premise of an automated channel
 * lives. A drywall firm bids repeatedly, for different GCs, on different jobs;
 * five `PROJECT` signals on one lead is a prospect you know something about,
 * five leads with one each is a CRM that has learned nothing.
 *
 * ── WHY THIS MERGES ON A LICENCE AND NOT ON ANYTHING ELSE ──
 *
 * The asymmetry is the design. A duplicate is visible, embarrassing and
 * permanent; a WRONG merge is invisible, puts one company's evidence on another
 * company's record, and is permanent in exactly the same way. CLAUDE.md's rule
 * that a claim plus a concern beats a refusal does not reach this decision,
 * because that rule turns on there being a human downstream who can resolve the
 * doubt — and there is no screen anywhere that un-merges a lead. So this is the
 * one place in the feature where the conservative reading wins outright.
 *
 * Hence the single key: the CSLB licence number. `leadMatch.ts` names the reason
 * in its own header — "a contractor licence is the one identifier in this trade
 * that is unique, printed on the document, and typed by neither party" — and
 * `lib/sales-licence.ts` is the one thing that turns a printed cell into it, so
 * the number used to decide identity here is byte-identical to the number
 * stored. Not the name: "Acme Drywall", "Acme Drywall, Inc." and "ACME DRYWALL
 * INC" are one firm and "Valley Interiors, Inc." and "Valley Interiors, LLC" are
 * two, and no amount of string work tells those cases apart.
 *
 * And the licence is still not enough ON ITS OWN, which is the conservative
 * choice this function is most likely to be argued with about. A stored licence
 * is not always document-sourced — `readTypedLicence` lets a person type one,
 * and a transposed digit there is undetectable — so the name has to corroborate
 * it. The cost of that is a dba or a renamed firm landing as a duplicate; the
 * cost of dropping it is one mistyped digit silently welding two companies
 * together for good. See the report note: making the licence VISIBLE to
 * `leadCandidatesFor`, so a reviewer is offered the merge the machine declined,
 * is the right next slice and it is in another file.
 *
 * The query is the one the `(companyId, licenceNumber)` index was added for, and
 * it is deliberately a `findMany`: leads written before this existed may already
 * share a licence. Oldest first, tie-broken on `id`, so two runs of the same
 * import cannot pick different leads — and so a pile of pre-existing duplicates
 * converges on the one with the most history rather than growing.
 */
async function leadHoldingThisLicence(
  tx: Pick<typeof prisma, "salesLead">,
  companyId: string,
  row: Omit<ImportedCompany, "leadId">,
): Promise<{ leadId: string; licence: string | null; registration: string | null } | null> {
  // A row whose licence cell was blank, unreadable or ambiguous has no key, and
  // this path has nothing to offer it. `licenceKey` can say WHICH of those it
  // was; on an import there is nobody to tell.
  if (row.licence === null) return null;

  const holders = await tx.salesLead.findMany({
    where: { companyId, licenceNumber: row.licence },
    select: { id: true, companyName: true, licenceNumber: true, registrationNumber: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  for (const held of holders) {
    // Through `identify` rather than rebuilt here, so the stored lead and the
    // incoming row are reduced to a comparable shape by one function.
    const known = identify({
      name: held.companyName,
      licence: held.licenceNumber,
      registration: held.registrationNumber,
    });
    /* The lead's OWN identifiers travel back, not just its id. The row matched
       on the licence, so that one is equal by construction — the registration is
       the one that matters: the lead may hold one this document never printed,
       and `absorb` needs it or the next row of this paste can contradict it
       unseen. */
    if (sameCompany(row, known)) {
      return { leadId: held.id, licence: known.licence, registration: known.registration };
    }
  }

  return null;
}

/**
 * WHAT THE DOCUMENT SAID ABOUT THIS ROW THAT BELONGS IN A COLUMN RATHER THAN IN
 * A SENTENCE.
 *
 * Every one of these was already being read by `parse.ts` and already reaching a
 * `SalesLeadSignal.claim` as prose — true, sourced, and unjoinable. The licence
 * is the one that matters most: California's CSLB file is public and carries a
 * telephone number for all but a handful of registrants, so a licence in a
 * column is the difference between a lead nobody can ring and a lead somebody
 * can. See the field comments on `SalesLead`.
 *
 * Nothing here is inferred. Each field is null unless the document printed it,
 * and null means "the document did not say" rather than "none".
 */
type ListingProvenance = {
  licenceNumber: string | null;
  registrationNumber: string | null;
  city: string | null;
  listedByGc: string | null;
  listedOnProject: string | null;
};

const PROVENANCE_FIELDS = [
  "licenceNumber",
  "registrationNumber",
  "city",
  "listedByGc",
  "listedOnProject",
] as const satisfies readonly (keyof ListingProvenance)[];

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function listingProvenance(
  row: ListedSubRow,
  header: SubListingParse["header"],
): ListingProvenance {
  /* A project name that wrapped is marked, exactly as the PROJECT claim marks
     it. `parse.ts` reads a listing line by line, so "Lincoln Elementary
     Modernization and" is what a two-line project heading leaves behind — and
     this column is rendered on the lead page, where a fragment reads as a whole
     name to whoever is about to say it out loud. That is the specific failure
     signals.ts records ("a project truncated at a conjunction was read down a
     telephone as though it were the whole name"), and it does not stop being
     true because the words arrived in a column instead of a claim. */
  const project = blank(header.project);

  return {
    /* Bare digits, from the one extractor — the class prefix and any leading
       zero gone, because CSLB's own key has neither. "C-9 884201" and
       "C-35 884201" are one contractor, and "061234" and "61234" are one licence.
       Null when the cell cannot yield a key, which `licenceKey` can say the
       reason for and this path deliberately does not ask: on an import there is
       nobody to ask, and the row's LICENCE claim still quotes what was printed. */
    licenceNumber: licenceNumberFrom(row.licence),
    registrationNumber: blank(row.registration),
    city: blank(row.city),
    /* The ROW's own attribution first, the page prime only as a fallback —
       `signals.ts`'s function rather than a second copy of the precedence here.
       The sentence a person reads down a telephone and the column they read on
       screen have to name the same general contractor, and until this call
       existed the two files agreed only by assertion: `signals.test.ts` reads
       this very line out of this file's source and fails if it drifts. That
       census now has nothing to catch, which is the point of #526's lesson —
       the guard that works is the one that makes the second copy impossible
       rather than detectable. `listedByGcFor` carries the reasoning, including
       why falling back to `header.prime` can never attribute the wrong GC: it
       is nulled by design on exactly the multi-prime packets where guessing
       would be wrong, so there is nothing to fall back TO in that case. */
    listedByGc: listedByGcFor(row, header),
    listedOnProject: project && looksCutOff(project) ? `${project}\u2026` : project,
  };
}

/** Just the fields this listing knows and the stored lead does not. */
function provenanceGaps(
  stored: Partial<ListingProvenance>,
  incoming: ListingProvenance,
): Partial<ListingProvenance> {
  const patch: Partial<ListingProvenance> = {};
  for (const field of PROVENANCE_FIELDS) {
    if (blank(stored[field]) === null && incoming[field] !== null) {
      patch[field] = incoming[field];
    }
  }
  return patch;
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
    /* THE CLAIMS A LEAD ALREADY HOLDS FROM THIS SOURCE, so re-reading one
       document does not write its sentences again.
       `(leadId, sourceUrl, kind, claim)` is the natural key of a piece of
       evidence and nothing was honouring it: three imports of one listing left
       five distinct claims tripled, so a reviewer confirmed the same sentence
       three times and the lead stayed undeletable.
       The duplication is the visible half. The half that matters is that the
       query filters on NO state — so a claim somebody DISMISSED is not written
       back as PROPOSED by the next import. A rejected sentence returning as
       un-reviewed is the review step being undone by a re-read, and it would
       look exactly like fresh evidence.
       Keyed on the source as well as the claim on purpose: two documents
       reporting the same fact are two pieces of evidence, and their claims
       differ anyway because each names its own project and line. A document
       RE-POSTED at one URL with different wording therefore still lands, which
       is the behaviour a correction needs. */
    const claimsOnRecord = new Map<string, Set<string>>();
    const claimKey = (kind: string, claim: string) => `${kind}\u0000${claim}`;

    const summary = await prisma.$transaction(async (tx) => {
      let leadsCreated = 0;
      /* DISTINCT LEADS, not rows. The screen renders this as "…and N you
         already had", and N is a count of records. It was two counters' worth of
         `+= 1` — one per row on the hand-attach path, one per lead on the
         licence path — so two rows landing on one lead said "2 you already had"
         when there was one. Found by review; a Set makes the sentence true
         however the two paths are mixed. */
      const attachedLeads = new Set<string>();
      let signalsProposed = 0;
      let rowsSkipped = 0;

      /**
       * The leads THIS import has already landed a row on, with what the
       * document printed about each — see `alreadyImported` above for the rule
       * and why it is that rule.
       *
       * "Landed a row on" rather than "created": a lead an earlier row of this
       * same paste was MERGED into by licence is in here too, so the
       * identical-spelling rung can still reach it. Only the human `attach:`
       * path stays out, because that is a per-row decision somebody made about
       * that row and nothing here should spread it to another.
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

        const provenance = listingProvenance(row, parsed.header);
        const attachTo = text(formData, `attach:${row.line}`);
        let leadId: string;
        /* Whether this row MADE the lead. A lead created here is created WITH
           this row's columns, so there is nothing to fill in; every other path
           leads to a row that already existed and must not be overwritten. */
        let freshlyCreated = false;

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
          attachedLeads.add(existing.id);
        } else {
          const identity = identify(row);
          const already = alreadyImported(identity, importedHere);
          /* The lead this same firm was given by an EARLIER import, found on the
             one key that survives a second document — see
             `leadHoldingThisLicence`. Asked only after the in-pass rule has had
             its go, so a row that belongs to a lead this very listing just made
             never reaches the database at all.

             It counts as `leadsAttached`, which is what the screen already says
             it is ("…and 1 you already had"): the lead DID already exist, and
             counting it as created would tell the reviewer a new record was
             written when none was. It is also pushed onto `importedHere`, and
             that is not tidiness — without it a second row of this same listing
             naming this same firm with a BLANK licence cell would stop seeing the
             identical-spelling rung and create a duplicate that the old code did
             not, because the old code had the first row CREATE the lead. A fix
             that introduces the bug it is fixing, one row further down. */
          const held = already ? null : await leadHoldingThisLicence(tx, company.id, identity);
          if (already) {
            leadId = already.leadId;
            /* The entry learns what this row printed. Without it the entry stays
               as weak as the row that made it and becomes a bridge between two
               rows the documents say are different registrants — see `absorb`. */
            absorb(already, identity);
          } else if (held) {
            leadId = held.leadId;
            attachedLeads.add(held.leadId);
            /* The UNION of what the row printed and what the lead already holds,
               never the row alone. The lead's registration is the half this
               document may not carry. */
            importedHere.push({
              ...identity,
              licence: identity.licence ?? held.licence,
              registration: identity.registration ?? held.registration,
              leadId: held.leadId,
            });
          } else {
            const created = await tx.salesLead.create({
              data: {
                companyId: company.id,
                companyName: row.name,
                source: "OUTBOUND",
                // The licence, the city, the GC and the project — columns now,
                // not only words inside the claims. `listingProvenance` above
                // says what each one is and is not.
                ...provenance,
              },
            });
            leadId = created.id;
            leadsCreated += 1;
            freshlyCreated = true;
            importedHere.push({ ...identity, leadId: created.id });
          }
        }

        /* FILL THE BLANKS, NEVER OVERWRITE — and the rule is one sentence
           because the alternative has a specific victim.

           Two paths arrive here with a lead that already existed: a person chose
           to attach this row to it, or an earlier row of this same listing
           created it. In both cases the stored columns are either from a document
           somebody has already reviewed or from a human who typed them, and this
           row is neither more recent nor better evidence. Overwriting would let a
           second import silently restate where a lead came from — and on a
           mis-attached row it would move another company's licence number onto
           it, which is precisely the confident-wrong-answer failure the whole
           review screen exists to prevent.

           Filling a blank cannot do that: it adds what was not known. A
           CONFLICT (stored says 884201, this row says 772130) is left alone and
           stays visible, because the row's own LICENCE signal still carries the
           number it printed, with its source and line. The contradiction belongs
           in front of a person, not resolved by whichever import ran last.

           Re-read inside the transaction rather than from anything the loop is
           carrying: the attach path's `existing` is already such a read, and a
           second row attaching to the same lead must see the first row's fill. */
        if (!freshlyCreated) {
          const stored = await tx.salesLead.findUnique({
            where: { id: leadId },
            select: {
              licenceNumber: true,
              registrationNumber: true,
              city: true,
              listedByGc: true,
              listedOnProject: true,
            },
          });
          const patch = stored ? provenanceGaps(stored, provenance) : {};
          if (Object.keys(patch).length > 0) {
            await tx.salesLead.update({ where: { id: leadId }, data: patch });
          }
        }

        /* Read once per lead and then kept, because several rows of one paste
           land on one lead and the set has to include what THIS paste has
           already written — two rows of a listing can produce the same sentence
           for a lead when the claim does not quote their line. */
        let onRecord = claimsOnRecord.get(leadId);
        if (!onRecord) {
          const held = await tx.salesLeadSignal.findMany({
            where: { companyId: company.id, leadId, sourceUrl },
            select: { kind: true, claim: true },
          });
          onRecord = new Set(held.map((signal) => claimKey(signal.kind, signal.claim)));
          claimsOnRecord.set(leadId, onRecord);
        }

        const fresh = proposals.filter((proposal) => {
          const key = claimKey(proposal.kind, proposal.claim);
          if (onRecord.has(key)) return false;
          onRecord.add(key);
          return true;
        });

        if (fresh.length > 0) {
          await tx.salesLeadSignal.createMany({
            data: fresh.map((proposal) => ({
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
          signalsProposed += fresh.length;
        }
        /* Revalidated whether or not anything was written: the row still reached
           this lead, and a caller watching the page should see the same thing a
           reload would show. */
        touched.add(leadId);
      }

      return { leadsCreated, leadsAttached: attachedLeads.size, signalsProposed, rowsSkipped };
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

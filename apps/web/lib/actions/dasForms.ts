"use server";

/**
 * Writes for the apprenticeship committees and the two DAS notices.
 *
 * FAILURES ARE RETURNED, NEVER THROWN. Production redacts a thrown Server
 * Action message to a digest (CLAUDE.md, verified 2026-08-27), and every
 * refusal in this file is a sentence a person needs to read — "that committee
 * still has notices on it", "this notice has already been sent". A throw here
 * would arrive as the full-page error boundary with no way forward.
 *
 * THE EVIDENCE RULE, WHICH IS MOST OF THIS FILE:
 *
 *   A DAS 140 or DAS 142 that has been SENT is correspondence that reached a
 *   state-recognized apprenticeship committee. CLAUDE.md: identity fields are
 *   locked after creation, sent correspondence can close but never delete,
 *   and dates that matter are ENTERED rather than stamped. So:
 *
 *     - `jobId`, `committeeId` and `craftName` are never editable. They are
 *       what the notice IS; changing one would silently rewrite which
 *       committee was told what.
 *     - Once `sentOn` / `requestedOn` is set, only the free-text note and the
 *       proof-of-transmission note can change. Everything else was on the
 *       paper that went out.
 *     - A sent notice cannot be deleted at all, by anybody, owner included.
 *       An unsent draft can be, and that is owner-only.
 *     - The sent date is recorded ONCE. It is the fact the ten-day and
 *       72-hour tests turn on, and a compliance date that can be quietly
 *       edited afterwards is not evidence of anything.
 *
 *   The one thing that IS freely editable after the fact is the committee's
 *   RESPONSE on a DAS 142, and the asymmetry is deliberate: that is our
 *   record of what somebody else told us, not a claim we made to them. A
 *   committee that says "unable to dispatch" a week after saying nothing is a
 *   record that should move.
 *
 * NOTHING HERE STAMPS A DATE FROM A CLICK. Every date arrives from an
 * `<input type="date">` and is parsed at UTC midnight, which is how every
 * other calendar day in this app is stored.
 *
 * NOTHING HERE FABRICATES A COMMITTEE. `createApprenticeshipCommittee` takes
 * what a person typed off DIR's lookup and stores exactly that; no address is
 * defaulted, no program number is generated, and every contact field may stay
 * empty. lib/das-print.ts then prints the blank with a sentence.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { dayOf } from "@/lib/das-forms";
import { can } from "@/lib/permissions";
import {
  actionFail as fail,
  actionOk as ok,
  isUniqueConstraintError,
  nullableDecimalFromForm,
  optionalNumberFromForm,
  ownerRefusal,
  runAction,
  type ActionResult,
} from "./shared";

/** Said the same way everywhere, so a person who sees it twice knows it is
 * the same reason and not two different problems. */
const NOT_YOUR_FUNCTION =
  "Recording apprenticeship notices isn't part of your job function. Someone with compliance access can do it.";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** A blank date is null, never today. Same helper, same reasoning as
 * lib/actions/apprenticeship.ts: these are dates on documents, and the app
 * has no way to know them. */
function date(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const ELECTIONS = ["APPROVED_TO_TRAIN", "WILL_COMPLY_WITH_STANDARDS", "CAC_REGULATIONS"] as const;
const METHODS = ["FIRST_CLASS_MAIL", "FAX", "EMAIL", "HAND_DELIVERED"] as const;
const OUTCOMES = ["DISPATCHED", "UNABLE_TO_DISPATCH", "NO_RESPONSE"] as const;

function election(formData: FormData): (typeof ELECTIONS)[number] | null {
  const raw = text(formData, "election");
  return (ELECTIONS as readonly string[]).includes(raw)
    ? (raw as (typeof ELECTIONS)[number])
    : null;
}

function method(formData: FormData): (typeof METHODS)[number] | null {
  const raw = text(formData, "sentMethod");
  return (METHODS as readonly string[]).includes(raw) ? (raw as (typeof METHODS)[number]) : null;
}

function outcome(formData: FormData): (typeof OUTCOMES)[number] | null {
  const raw = text(formData, "outcome");
  return (OUTCOMES as readonly string[]).includes(raw) ? (raw as (typeof OUTCOMES)[number]) : null;
}

/** Tri-state, and the third state is the point: "not recorded" is not "no".
 * 8 CCR 230(a) sends an approved-to-train contractor to one committee and an
 * unapproved one to all of them, so a blank here must make the job side
 * decline to answer rather than pick a branch. */
function tristate(formData: FormData, key: string): boolean | null {
  const raw = text(formData, key);
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

/* ------------------------------------------------------------------ *
 * The committee directory
 * ------------------------------------------------------------------ */

export async function createApprenticeshipCommittee(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const name = text(formData, "name");
  if (!name) return fail("Name the committee, as DIR's lookup writes it.");
  const craftName = text(formData, "craftName");
  if (!craftName) {
    return fail("Name the craft or trade this committee trains for — a notice goes per craft.");
  }
  const geographicArea = text(formData, "geographicArea");
  if (!geographicArea) {
    return fail(
      "Enter the committee's geographic area. Whether a job's site falls inside it is what decides " +
        "whether this committee gets the notice at all.",
    );
  }

  const craftClassificationId = text(formData, "craftClassificationId") || null;
  if (craftClassificationId) {
    const craft = await prisma.craftClassification.findFirst({
      where: { id: craftClassificationId, companyId: company.id },
    });
    if (!craft) return fail("That classification isn't one of yours.");
  }

  // Same committee, same craft, same area entered twice is one committee, not
  // two — and the same reason `createApprenticeshipEnrollment` guards this:
  // a page that looks like it did nothing gets clicked again.
  const already = await prisma.apprenticeshipCommittee.findFirst({
    where: { companyId: company.id, name, craftName, geographicArea },
  });
  if (already !== null) {
    return fail("That committee is already recorded for this craft and area. Reload; it is on the list.");
  }

  await prisma.apprenticeshipCommittee.create({
    data: {
      companyId: company.id,
      name,
      craftName,
      craftClassificationId,
      geographicArea,
      programSponsorNumber: text(formData, "programSponsorNumber") || null,
      addressLine1: text(formData, "addressLine1") || null,
      addressLine2: text(formData, "addressLine2") || null,
      city: text(formData, "city") || null,
      state: text(formData, "state") || null,
      postalCode: text(formData, "postalCode") || null,
      email: text(formData, "email") || null,
      fax: text(formData, "fax") || null,
      phone: text(formData, "phone") || null,
      approvedToTrainUs: tristate(formData, "approvedToTrainUs"),
      sourceUrl: text(formData, "sourceUrl") || null,
      note: text(formData, "note") || null,
    },
  });

  revalidatePath("/union-compliance");
  return ok;
}

export async function updateApprenticeshipCommittee(
  committeeId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const existing = await prisma.apprenticeshipCommittee.findFirst({
    where: { id: committeeId, companyId: company.id },
  });
  if (existing === null) return fail("That committee isn't on this company.");

  const name = text(formData, "name");
  if (!name) return fail("Name the committee.");
  const geographicArea = text(formData, "geographicArea");
  if (!geographicArea) return fail("Enter the committee's geographic area.");

  // WRITABLE HERE, AND CLEARABLE. The shared field set renders this select on
  // the row edit as well as the add form, and for a week this update dropped
  // it: changing the classification reported success and changed nothing, and
  // a link set by mistake could not be removed at all. An empty value is the
  // select's own "Not linked" option, so it clears the link rather than being
  // ignored — same tri-state honesty as `approvedToTrainUs` below.
  //
  // It matters more than an advisory field sounds: this link is what
  // `dasProposals` joins a craft on the job to a committee by, so a wrong one
  // suppresses a real DAS 140 proposal and a missing one raises a false "no
  // committee is linked to this craft".
  const craftClassificationId = text(formData, "craftClassificationId") || null;
  if (craftClassificationId !== null) {
    const craft = await prisma.craftClassification.findFirst({
      where: { id: craftClassificationId, companyId: company.id },
    });
    if (!craft) return fail("That classification isn't one of yours.");
  }

  // `craftName` is deliberately absent from this update. It is not identity
  // on the committee itself, but every notice snapshots it at creation, so
  // editing it here would make the directory and the sent notices disagree
  // about what a craft is called with nothing on screen to say why. A
  // committee covering a second craft is a second row.
  await prisma.apprenticeshipCommittee.update({
    where: { id: committeeId },
    data: {
      name,
      craftClassificationId,
      geographicArea,
      programSponsorNumber: text(formData, "programSponsorNumber") || null,
      addressLine1: text(formData, "addressLine1") || null,
      addressLine2: text(formData, "addressLine2") || null,
      city: text(formData, "city") || null,
      state: text(formData, "state") || null,
      postalCode: text(formData, "postalCode") || null,
      email: text(formData, "email") || null,
      fax: text(formData, "fax") || null,
      phone: text(formData, "phone") || null,
      approvedToTrainUs: tristate(formData, "approvedToTrainUs"),
      sourceUrl: text(formData, "sourceUrl") || null,
      note: text(formData, "note") || null,
    },
  });

  revalidatePath("/union-compliance");
  return ok;
}

export async function deleteApprenticeshipCommittee(committeeId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  // `ownerRefusal`, NOT `assertOwner`: this function promises
  // `Promise<ActionResult>`, and a thrown refusal on that contract reaches a
  // real user as a digest. `ownerRefusalCensus.test.ts` fails the build on the
  // other choice.
  const refusal = ownerRefusal(context, "Only the account owner can remove a committee.");
  if (refusal) return refusal;
  const { company } = context;

  const existing = await prisma.apprenticeshipCommittee.findFirst({
    where: { id: committeeId, companyId: company.id },
    include: { _count: { select: { das140Notices: true, das142Requests: true } } },
  });
  if (existing === null) return fail("That committee isn't on this company.");

  // Names only the non-zero kinds, the way `deleteSalesLead` does: "it has
  // children" tells nobody which screen to go to.
  const blockers: string[] = [];
  if (existing._count.das140Notices > 0) {
    blockers.push(
      `${existing._count.das140Notices} DAS 140 ${existing._count.das140Notices === 1 ? "notice" : "notices"}`,
    );
  }
  if (existing._count.das142Requests > 0) {
    blockers.push(
      `${existing._count.das142Requests} DAS 142 ${existing._count.das142Requests === 1 ? "request" : "requests"}`,
    );
  }
  if (blockers.length > 0) {
    return fail(
      `${existing.name} still has ${blockers.join(" and ")} pointing at it. Those are the record of ` +
        `what was sent to this committee — they are not removed with it.`,
    );
  }

  await prisma.apprenticeshipCommittee.delete({ where: { id: committeeId } });
  revalidatePath("/union-compliance");
  return ok;
}

/* ------------------------------------------------------------------ *
 * DAS 140
 * ------------------------------------------------------------------ */

/** The job and the committee, both proved to be this company's. Returns the
 * refusal sentence instead of a row when either is not. */
async function jobAndCommittee(
  jobId: string,
  committeeId: string,
  companyId: string,
): Promise<
  | { error: string; job?: undefined; committee?: undefined }
  | {
      error?: undefined;
      job: NonNullable<Awaited<ReturnType<typeof prisma.job.findFirst>>>;
      committee: NonNullable<Awaited<ReturnType<typeof prisma.apprenticeshipCommittee.findFirst>>>;
    }
> {
  const [job, committee] = await Promise.all([
    prisma.job.findFirst({ where: { id: jobId, companyId } }),
    prisma.apprenticeshipCommittee.findFirst({ where: { id: committeeId, companyId } }),
  ]);
  if (!job) return { error: "That job isn't on this company." };
  if (!committee) return { error: "That committee isn't one of yours." };
  return { job, committee };
}

export async function createDas140Notice(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const committeeId = text(formData, "committeeId");
  if (!committeeId) return fail("Choose the committee this notice goes to.");
  const found = await jobAndCommittee(jobId, committeeId, company.id);
  if (found.error !== undefined) return fail(found.error);

  const chosen = election(formData);
  if (chosen === null) {
    return fail(
      "Tick one of the three boxes. C Stream will not choose for you — the box is a declaration you " +
        "are making to the state.",
    );
  }

  const contractExecutedOn = date(formData, "contractExecutedOn");
  if (contractExecutedOn === null) {
    return fail(
      "Enter the date the contract was executed. The ten-day clock starts there, so a blank means " +
        "there is no deadline to show you.",
    );
  }

  return runAction(async () => {
    const journeymanHours = nullableDecimalFromForm(formData, "estimatedJourneymanHours", { min: 0 });
    const apprenticeHours = nullableDecimalFromForm(formData, "estimatedApprenticeHours", { min: 0 });
    const contractAmount = nullableDecimalFromForm(formData, "contractAmount", { min: 0 });

    try {
      await prisma.das140Notice.create({
        data: {
          jobId,
          committeeId,
          // SNAPSHOT, not a join. The craft as notified, frozen here so
          // editing the committee later cannot rewrite what was sent.
          craftName: found.committee.craftName,
          election: chosen,
          contractExecutedOn,
          estimatedJourneymanHours: journeymanHours,
          estimatedApprenticeHours: apprenticeHours,
          estimatedStartOn: date(formData, "estimatedStartOn"),
          estimatedCompletionOn: date(formData, "estimatedCompletionOn"),
          contractAmount,
          projectIdentifier: text(formData, "projectIdentifier") || null,
          note: text(formData, "note") || null,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail(
          `A DAS 140 for ${found.committee.craftName} and ${found.committee.name} is already recorded on ` +
            `this job. A second notice for the same craft and committee is a correction to that one — ` +
            `edit it instead.`,
        );
      }
      throw err;
    }

    revalidatePath(`/jobs/${jobId}/compliance`);
    return ok;
  });
}

export async function updateDas140Notice(noticeId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const existing = await prisma.das140Notice.findFirst({
    where: { id: noticeId, job: { companyId: company.id } },
  });
  if (existing === null) return fail("That notice isn't on this company.");

  // SENT: only the two notes move. Everything else was on the paper.
  if (existing.sentOn !== null) {
    await prisma.das140Notice.update({
      where: { id: noticeId },
      data: {
        note: text(formData, "note") || null,
        proofNote: text(formData, "proofNote") || null,
      },
    });
    revalidatePath(`/jobs/${existing.jobId}/compliance`);
    return ok;
  }

  const chosen = election(formData);
  if (chosen === null) return fail("Tick one of the three boxes.");
  const contractExecutedOn = date(formData, "contractExecutedOn");
  if (contractExecutedOn === null) return fail("Enter the date the contract was executed.");

  return runAction(async () => {
    await prisma.das140Notice.update({
      where: { id: noticeId },
      data: {
        election: chosen,
        contractExecutedOn,
        estimatedJourneymanHours: nullableDecimalFromForm(formData, "estimatedJourneymanHours", { min: 0 }),
        estimatedApprenticeHours: nullableDecimalFromForm(formData, "estimatedApprenticeHours", { min: 0 }),
        estimatedStartOn: date(formData, "estimatedStartOn"),
        estimatedCompletionOn: date(formData, "estimatedCompletionOn"),
        contractAmount: nullableDecimalFromForm(formData, "contractAmount", { min: 0 }),
        projectIdentifier: text(formData, "projectIdentifier") || null,
        note: text(formData, "note") || null,
        proofNote: text(formData, "proofNote") || null,
      },
    });
    revalidatePath(`/jobs/${existing.jobId}/compliance`);
    return ok;
  });
}

/**
 * Records that the notice went out. ONCE.
 *
 * Not editable afterwards, and that is the evidence rule rather than an
 * oversight: this date is the whole of the ten-day test, and a compliance
 * date somebody can quietly change later is not evidence of anything. The
 * refusal names the recorded date so a person who mistyped can see what is
 * on file and explain it in the note.
 */
export async function recordDas140Sent(noticeId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const existing = await prisma.das140Notice.findFirst({
    where: { id: noticeId, job: { companyId: company.id } },
  });
  if (existing === null) return fail("That notice isn't on this company.");
  if (existing.sentOn !== null) {
    return fail(
      `This notice is already recorded as sent on ${dayOf(existing.sentOn)}. A sent ` +
        `date is what the ten-day test turns on, so it cannot be edited — add a note if it needs ` +
        `explaining.`,
    );
  }

  const sentOn = date(formData, "sentOn");
  if (sentOn === null) {
    return fail("Enter the date you actually sent it — the date on the fax or the postmark, not today.");
  }
  const sentMethod = method(formData);
  if (sentMethod === null) {
    return fail("Say how it went — mail, fax, email or by hand. Proof of transmission may be asked for.");
  }

  await prisma.das140Notice.update({
    where: { id: noticeId },
    data: { sentOn, sentMethod, proofNote: text(formData, "proofNote") || null },
  });
  revalidatePath(`/jobs/${existing.jobId}/compliance`);
  return ok;
}

export async function deleteDas140Notice(noticeId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can remove a DAS 140.");
  if (refusal) return refusal;
  const { company } = context;

  const existing = await prisma.das140Notice.findFirst({
    where: { id: noticeId, job: { companyId: company.id } },
  });
  if (existing === null) return fail("That notice isn't on this company.");
  // Sent correspondence closes, it never deletes. Owner included.
  if (existing.sentOn !== null) {
    return fail(
      "This notice has been sent to the committee. Sent correspondence stays on the record — it cannot " +
        "be removed, by anyone.",
    );
  }

  await prisma.das140Notice.delete({ where: { id: noticeId } });
  revalidatePath(`/jobs/${existing.jobId}/compliance`);
  return ok;
}

/* ------------------------------------------------------------------ *
 * DAS 142
 * ------------------------------------------------------------------ */

export async function createDas142Request(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const committeeId = text(formData, "committeeId");
  if (!committeeId) return fail("Choose the committee you are asking.");
  const found = await jobAndCommittee(jobId, committeeId, company.id);
  if (found.error !== undefined) return fail(found.error);

  const neededFrom = date(formData, "neededFrom");
  if (neededFrom === null) {
    return fail("Enter the day you need an apprentice on site. The 72-hour lead time counts back from it.");
  }
  const neededTo = date(formData, "neededTo");
  if (neededTo !== null && neededTo < neededFrom) {
    return fail("The last day you need somebody cannot be before the first.");
  }

  return runAction(async () => {
    const count = optionalNumberFromForm(formData, "apprenticesRequested", { integer: true, min: 1 });
    if (count === null) {
      return fail("How many apprentices are you asking for? One request, one number.");
    }

    try {
      await prisma.das142Request.create({
        data: {
          jobId,
          committeeId,
          craftName: found.committee.craftName,
          apprenticesRequested: count.n,
          neededFrom,
          neededTo,
          projectIdentifier: text(formData, "projectIdentifier") || null,
          note: text(formData, "note") || null,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail(
          `A request to ${found.committee.name} for ${found.committee.craftName} starting that day is ` +
            `already recorded on this job. Edit that one, or pick a different day.`,
        );
      }
      throw err;
    }

    revalidatePath(`/jobs/${jobId}/compliance`);
    return ok;
  });
}

export async function updateDas142Request(
  requestId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const existing = await prisma.das142Request.findFirst({
    where: { id: requestId, job: { companyId: company.id } },
  });
  if (existing === null) return fail("That request isn't on this company.");

  // SENT: the notes only. `neededFrom` especially is frozen — it is the
  // anchor the lead time was measured against, so moving it afterwards would
  // silently turn a short-notice request into a timely one.
  if (existing.requestedOn !== null) {
    await prisma.das142Request.update({
      where: { id: requestId },
      data: {
        note: text(formData, "note") || null,
        proofNote: text(formData, "proofNote") || null,
      },
    });
    revalidatePath(`/jobs/${existing.jobId}/compliance`);
    return ok;
  }

  const neededFrom = date(formData, "neededFrom");
  if (neededFrom === null) return fail("Enter the day you need an apprentice on site.");
  const neededTo = date(formData, "neededTo");
  if (neededTo !== null && neededTo < neededFrom) {
    return fail("The last day you need somebody cannot be before the first.");
  }

  return runAction(async () => {
    const count = optionalNumberFromForm(formData, "apprenticesRequested", { integer: true, min: 1 });
    if (count === null) return fail("How many apprentices are you asking for?");

    try {
      await prisma.das142Request.update({
        where: { id: requestId },
        data: {
          apprenticesRequested: count.n,
          neededFrom,
          neededTo,
          projectIdentifier: text(formData, "projectIdentifier") || null,
          note: text(formData, "note") || null,
          proofNote: text(formData, "proofNote") || null,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail("There is already a request to that committee for that craft starting that day.");
      }
      throw err;
    }
    revalidatePath(`/jobs/${existing.jobId}/compliance`);
    return ok;
  });
}

/** Records that the request went out. ONCE, for the reason
 * `recordDas140Sent` gives. */
export async function recordDas142Sent(
  requestId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const existing = await prisma.das142Request.findFirst({
    where: { id: requestId, job: { companyId: company.id } },
  });
  if (existing === null) return fail("That request isn't on this company.");
  if (existing.requestedOn !== null) {
    return fail(
      `This request is already recorded as sent on ${dayOf(existing.requestedOn)}. ` +
        `That date is what the 72-hour lead time is measured from, so it cannot be edited.`,
    );
  }

  const requestedOn = date(formData, "requestedOn");
  if (requestedOn === null) {
    return fail("Enter the date you actually sent it — the 72 hours are counted from that, not from today.");
  }
  const sentMethod = method(formData);
  if (sentMethod === null) {
    return fail(
      "Say how it went. The rule names first class mail, fax and email, and proof of submission may be asked for.",
    );
  }

  await prisma.das142Request.update({
    where: { id: requestId },
    data: { requestedOn, sentMethod, proofNote: text(formData, "proofNote") || null },
  });
  revalidatePath(`/jobs/${existing.jobId}/compliance`);
  return ok;
}

/**
 * What the committee said back.
 *
 * FREELY EDITABLE, unlike everything else here, and the asymmetry is the
 * design: this is our record of somebody else's answer, not a claim we made
 * to them. A committee that said nothing for a week and then writes back is
 * a record that has to move. A cleared outcome goes back to "nothing
 * recorded", which is a different fact from NO_RESPONSE — that one means
 * somebody checked and nothing came.
 */
export async function recordDas142Response(
  requestId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const { company } = context;

  const existing = await prisma.das142Request.findFirst({
    where: { id: requestId, job: { companyId: company.id } },
  });
  if (existing === null) return fail("That request isn't on this company.");
  if (existing.requestedOn === null) {
    return fail("Record that you sent the request first — a committee cannot answer one that never went.");
  }

  await prisma.das142Request.update({
    where: { id: requestId },
    data: {
      respondedOn: date(formData, "respondedOn"),
      outcome: outcome(formData),
      outcomeNote: text(formData, "outcomeNote") || null,
    },
  });
  revalidatePath(`/jobs/${existing.jobId}/compliance`);
  return ok;
}

export async function deleteDas142Request(requestId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can remove a DAS 142.");
  if (refusal) return refusal;
  const { company } = context;

  const existing = await prisma.das142Request.findFirst({
    where: { id: requestId, job: { companyId: company.id } },
  });
  if (existing === null) return fail("That request isn't on this company.");
  if (existing.requestedOn !== null) {
    return fail(
      "This request has been sent to the committee. Sent correspondence stays on the record — and a " +
        "request the committee could not fill is the thing that shows you asked.",
    );
  }

  await prisma.das142Request.delete({ where: { id: requestId } });
  revalidatePath(`/jobs/${existing.jobId}/compliance`);
  return ok;
}

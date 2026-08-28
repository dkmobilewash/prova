"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { assertOwner } from "./shared";

/** Actions in this module RETURN their failures instead of throwing them.
 *
 * Next.js redacts the message of any error thrown from a Server Action in
 * a production build — verified on 2026-08-27 against a real production
 * build, not inferred. A thrown guard message reads perfectly in dev and
 * degrades to an opaque digest for a real user, which is the worst
 * possible way to fail. So: expected, user-readable failures come back as
 * `{ ok: false, error }` and the form renders `error`; `throw` is
 * reserved for genuine bugs, which SHOULD be redacted in production.
 *
 * This is the first module written in this shape. If the team settles on
 * a shared type in shared.ts, this alias moves there — one line.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

const ok: ActionResult = { ok: true };
function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** Thrown by the form parsers below, caught at each action's boundary and
 * converted to a returned failure — parsing stays terse, the wire stays
 * honest. Anything else that throws is a real bug and is rethrown. */
class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Stored at UTC midnight so date comparisons are calendar-day
 * comparisons, not instant comparisons — same rule as RFIs. */
function optionalDate(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError("Date is not valid");
  return date;
}

function requiredDate(formData: FormData, key: string, label: string): Date {
  const date = optionalDate(formData, key);
  if (!date) throw new InputError(`${label} is required`);
  return date;
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

async function findSubmittal(submittalId: string, companyId: string) {
  const submittal = await prisma.submittal.findUnique({
    where: { id: submittalId },
    include: { revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } },
  });
  if (!submittal || submittal.companyId !== companyId) return null;
  return submittal;
}

/** Issues the next submittal number for a job. Reads nothing from
 * Submittal on purpose — same counter rule as RFI and safety case
 * numbers: a number derived from surviving rows is reissued the moment
 * the highest row is deleted, and the GC's transmittal log would then
 * point one number at two different packages. */
async function issueSubmittalNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.submittalCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

export async function createSubmittal(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const jobId = required(formData, "jobId", "Job");
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== company.id) return fail("Job not found");

    const title = required(formData, "title", "Title");
    const description = text(formData, "description");
    const specSection = text(formData, "specSection");
    const drawingReference = text(formData, "drawingReference");

    // The sent date is entered, not stamped — entering the packages you
    // already sent must not record them all as sent today. Blank means it
    // hasn't gone out yet: registered but not submitted, and deletable.
    const sentOn = optionalDate(formData, "sentOn");
    const dueBack = optionalDate(formData, "dueBack");
    if (sentOn && dueBack && dueBack < sentOn) {
      return fail("The answer-back date can't be before the submittal was sent");
    }
    if (!sentOn && dueBack) {
      return fail("Set the sent date first — a due-back date on an unsent submittal means nothing");
    }

    await prisma.$transaction(async (tx) => {
      const submittal = await tx.submittal.create({
        data: {
          companyId: company.id,
          jobId,
          number: await issueSubmittalNumber(tx, jobId),
          title,
          description: description || null,
          specSection: specSection || null,
          drawingReference: drawingReference || null,
          submittedByUserId: user.id,
        },
      });
      if (sentOn) {
        await tx.submittal.update({
          where: { id: submittal.id },
          data: { lastRevision: { increment: 1 } },
        });
        await tx.submittalRevision.create({
          data: { submittalId: submittal.id, revisionNumber: 1, sentOn, dueBack },
        });
      }
    });

    revalidatePath("/submittals");
    return ok;
  });
}

export async function updateSubmittal(submittalId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const submittal = await findSubmittal(submittalId, company.id);
    if (!submittal) return fail("Submittal not found");

    // Job and number are the identity of the package — the GC has both in
    // writing on a transmittal. Neither is editable; a wrong job means a
    // new submittal.
    await prisma.submittal.update({
      where: { id: submittal.id },
      data: {
        title: required(formData, "title", "Title"),
        description: text(formData, "description") || null,
        specSection: text(formData, "specSection") || null,
        drawingReference: text(formData, "drawingReference") || null,
      },
    });

    revalidatePath("/submittals");
    return ok;
  });
}

/** Sends the next revision (revision 1 is the initial submission). */
export async function sendSubmittalRevision(submittalId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const submittal = await findSubmittal(submittalId, company.id);
    if (!submittal) return fail("Submittal not found");

    const sentOn = requiredDate(formData, "sentOn", "Date sent");
    const dueBack = optionalDate(formData, "dueBack");
    if (dueBack && dueBack < sentOn) {
      return fail("The answer-back date can't be before the revision was sent");
    }

    // The guards read the latest revision INSIDE the transaction. Checked
    // outside, two people resubmitting at the same moment both pass and
    // one of them strands a revision that is never the latest — which no
    // form can ever record a response against.
    await prisma.$transaction(async (tx) => {
      const latest = await tx.submittalRevision.findFirst({
        where: { submittalId: submittal.id },
        orderBy: { revisionNumber: "desc" },
      });
      if (latest && !latest.returnedOn) {
        throw new InputError(
          `The GC still has revision ${latest.revisionNumber} — record what came back before sending another`,
        );
      }
      // History has to stay tellable in order: a resubmission can't
      // predate the response that caused it.
      if (latest?.returnedOn && sentOn < latest.returnedOn) {
        throw new InputError(
          `Revision ${latest.revisionNumber} came back ${latest.returnedOn.toISOString().slice(0, 10)} — the next one can't have been sent before that`,
        );
      }
      const bumped = await tx.submittal.update({
        where: { id: submittal.id },
        data: { lastRevision: { increment: 1 } },
        select: { lastRevision: true },
      });
      await tx.submittalRevision.create({
        data: {
          submittalId: submittal.id,
          revisionNumber: bumped.lastRevision,
          sentOn,
          dueBack,
        },
      });
    });

    revalidatePath("/submittals");
    return ok;
  });
}

/** Records (or corrects) what came back on the latest revision. */
export async function recordSubmittalResponse(submittalId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const submittal = await findSubmittal(submittalId, company.id);
    if (!submittal) return fail("Submittal not found");

    const latest = submittal.revisions[0] ?? null;
    if (!latest) return fail("Send this submittal before recording a response");

    const outcomeRaw = text(formData, "outcome");
    const outcomes = ["APPROVED", "APPROVED_AS_NOTED", "REVISE_AND_RESUBMIT", "REJECTED"] as const;
    if (!outcomes.includes(outcomeRaw as (typeof outcomes)[number])) {
      return fail("Pick what the reviewer's stamp actually said");
    }

    // Entered, not stamped: a response recorded a week late must not read
    // as a week-later response — that overstates the GC's turnaround, and
    // turnaround is the evidence this log exists to hold.
    const returnedOn = optionalDate(formData, "returnedOn") ?? latest.returnedOn;
    if (!returnedOn) return fail("Date the response actually came back is required");
    if (returnedOn < latest.sentOn) {
      return fail("The response can't have come back before the revision was sent");
    }

    await prisma.submittalRevision.update({
      where: { id: latest.id },
      data: {
        returnedOn,
        outcome: outcomeRaw as (typeof outcomes)[number],
        responseNotes: text(formData, "responseNotes") || null,
      },
    });

    revalidatePath("/submittals");
    return ok;
  });
}

export async function deleteSubmittal(submittalId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a submittal");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const submittal = await findSubmittal(submittalId, context.company.id);
    if (!submittal) return fail("Submittal not found");

    // A submitted package is correspondence the GC also holds; deleting it
    // destroys the record of having sent it and frees nothing — the number
    // stays retired either way.
    if (submittal.revisions.length > 0) {
      return fail("This submittal has been sent, so its record stays. Only an unsent one can be deleted.");
    }

    await prisma.submittal.delete({ where: { id: submittal.id } });
    revalidatePath("/submittals");
    return ok;
  });
}

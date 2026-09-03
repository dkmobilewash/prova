"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/** Failures are RETURNED, not thrown — production redacts a thrown Server
 * Action message to a digest. `lib/actions/submittals.ts` is the reference.
 *
 * Kept in its own module rather than appended to closeout.ts: that file is
 * the checklist, the warranty period and the callbacks, and this is the
 * correspondence with the GC about the package. Separate domains, and two
 * sessions editing one file is how a merge conflict becomes a stranded
 * commit. */

class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** UTC midnight, so comparing two dates compares calendar days. A date
 * stamped at wall-clock time compares as later than a same-day date typed
 * by hand, which turns a same-day GC response into a rejected entry. */
function optionalDate(formData: FormData, key: string, label: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError(`${label} is not a valid date`);
  return date;
}

function requiredDate(formData: FormData, key: string, label: string): Date {
  const date = optionalDate(formData, key, label);
  if (!date) throw new InputError(`${label} is required`);
  return date;
}

function utcMidnightToday() {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

async function assertJob(jobId: string, companyId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== companyId) throw new InputError("Job not found");
  return job;
}

async function assertSubmission(id: string, companyId: string) {
  const submission = await prisma.closeoutSubmission.findUnique({ where: { id } });
  if (!submission || submission.companyId !== companyId) {
    throw new InputError("Closeout submission not found");
  }
  return submission;
}

/** Issues the next attempt number for a job's closeout package. Only ever
 * increments, same as RfiCounter and SubmittalCounter — a number derived
 * from the attempts that still exist is freed again by a delete, and then
 * two different packages have both been "attempt 2" in an email. */
async function issueAttemptNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.closeoutSubmissionCounter.upsert({
    where: { jobId },
    create: { jobId, lastAttempt: 1 },
    update: { lastAttempt: { increment: 1 } },
    select: { lastAttempt: true },
  });
  return counter.lastAttempt;
}

/**
 * Records the closeout package going to the GC.
 *
 * Deliberately does NOT check that the checklist is complete. Packages go
 * out short a document all the time — with the missing one promised to
 * follow — and refusing to record that would mean the log stops matching
 * what actually happened, which is the one thing it is for. The /closeout
 * page shows the blockers next to the submission instead, so an incomplete
 * package that went anyway is visible rather than impossible.
 */
export async function submitCloseoutPackage(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const jobId = required(formData, "jobId", "Job");
    await assertJob(jobId, company.id);

    // The date it left our hands, entered rather than stamped — the same
    // rule the RFI and submittal logs follow, and for the same reason:
    // entering last quarter's packages today would make every one of them
    // look sent today and the turnaround evidence fiction.
    const submittedOn = requiredDate(formData, "submittedOn", "Date it went out");

    const outstanding = await prisma.closeoutSubmission.findFirst({
      where: { jobId, status: "SUBMITTED" },
      orderBy: { attempt: "desc" },
    });
    if (outstanding) {
      return fail(
        `The GC still has attempt ${outstanding.attempt}, sent ${isoDay(outstanding.submittedOn)} — record what came back before sending another.`,
      );
    }

    const previous = await prisma.closeoutSubmission.findFirst({
      where: { jobId },
      orderBy: { attempt: "desc" },
    });
    if (previous?.respondedOn && submittedOn < previous.respondedOn) {
      return fail(
        `Attempt ${previous.attempt} came back ${isoDay(previous.respondedOn)} — the next one can't have gone out before that.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.closeoutSubmission.create({
        data: {
          companyId: company.id,
          jobId,
          attempt: await issueAttemptNumber(tx, jobId),
          submittedOn,
          method: text(formData, "method") || null,
          note: text(formData, "note") || null,
          submittedByUserId: user.id,
        },
      });
    });

    revalidatePath("/closeout");
    return ok;
  });
}

/** Records what the GC said. ACCEPTED ends it; REJECTED puts the ball back
 * in our court and is what makes another attempt legitimate. */
export async function recordCloseoutResponse(id: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const submission = await assertSubmission(id, company.id);
    if (submission.status !== "SUBMITTED") {
      return fail("This attempt already has a response recorded. Reopen it to change what came back.");
    }

    const raw = text(formData, "outcome");
    if (raw !== "ACCEPTED" && raw !== "REJECTED") {
      return fail("Say whether the GC accepted it or sent it back.");
    }

    const respondedOn = optionalDate(formData, "respondedOn", "Date they answered") ?? utcMidnightToday();
    if (respondedOn < submission.submittedOn) {
      return fail("They can't have answered before the package went out.");
    }

    // A rejection with no reason is the one that costs a second bounce:
    // whoever assembles the next package has to know what was missing.
    const gcResponse = text(formData, "gcResponse");
    if (raw === "REJECTED" && !gcResponse) {
      return fail("Record what they said was wrong with it — the next attempt depends on it.");
    }

    await prisma.closeoutSubmission.update({
      where: { id: submission.id },
      data: { status: raw, respondedOn, gcResponse: gcResponse || null },
    });

    revalidatePath("/closeout");
    return ok;
  });
}

/** Puts an answered attempt back to SUBMITTED — for a response recorded
 * against the wrong attempt, or an acceptance the GC walked back. The
 * submitted date and attempt number are untouched: they are what the GC
 * also holds. */
export async function reopenCloseoutSubmission(id: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const submission = await assertSubmission(id, company.id);
    if (submission.status === "SUBMITTED") {
      return fail("This attempt is already open with the GC.");
    }

    // Reopening the older of two attempts would leave the job with two
    // packages outstanding at once, and the days-with-the-GC figure would
    // then be measuring whichever one happened to sort first.
    const newer = await prisma.closeoutSubmission.findFirst({
      where: { jobId: submission.jobId, attempt: { gt: submission.attempt } },
    });
    if (newer) {
      return fail(`Attempt ${newer.attempt} was sent after this one — reopen that instead.`);
    }

    await prisma.closeoutSubmission.update({
      where: { id: submission.id },
      data: { status: "SUBMITTED", respondedOn: null, gcResponse: null },
    });

    revalidatePath("/closeout");
    return ok;
  });
}

/**
 * Deletes an attempt logged in error.
 *
 * Owner-only, and only the most recent attempt — deleting an earlier one
 * would leave a gap in the numbering that reads as a package nobody can
 * find. The attempt number is NOT freed by this: the counter only
 * increments, so the next package is the next number, and a GC quoting
 * "the second submission" is never pointed at two different ones.
 */
export async function deleteCloseoutSubmission(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (context.role !== "OWNER") {
      // Returned rather than thrown: assertOwner throws, and production
      // redacts a thrown message, so the sentence explaining why the
      // button did nothing would never arrive.
      return fail("Only the account owner can delete a closeout submission");
    }
    const submission = await assertSubmission(id, context.company.id);

    const newer = await prisma.closeoutSubmission.findFirst({
      where: { jobId: submission.jobId, attempt: { gt: submission.attempt } },
    });
    if (newer) {
      return fail(`Attempt ${newer.attempt} came after this one — delete that first.`);
    }

    await prisma.closeoutSubmission.delete({ where: { id: submission.id } });
    revalidatePath("/closeout");
    return ok;
  });
}

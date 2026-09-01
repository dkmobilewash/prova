"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/** Actions in this module RETURN their failures instead of throwing them.
 * Production redacts a thrown Server Action message to an opaque digest, so
 * a guard written in plain language would never reach the person it was
 * written for. `lib/actions/submittals.ts` is the reference; `ActionResult`
 * and its helpers live in `./shared`. */

class InputError extends Error {}

const CATEGORIES = [
  "CLEANUP",
  "DAMAGE_TO_OTHER_TRADES",
  "COMPLETION_BY_OTHERS",
  "MATERIAL_OR_EQUIPMENT_SUPPLIED",
  "SUPERVISION",
  "SAFETY_VIOLATION",
  "SCHEDULE_DELAY",
  "OTHER",
] as const;

/** The three ways a backcharge ends. Deliberately not the whole
 * BackchargeStatus enum: RECEIVED and DISPUTED are states it passes
 * through, not outcomes anyone resolves it TO. */
const OUTCOMES = ["ACCEPTED", "SETTLED", "WITHDRAWN"] as const;

/** shared.ts's enumFromForm throws a plain Error, which runAction below
 * deliberately does not catch — an unexpected throw SHOULD reach the error
 * boundary. A bad select value is expected input, not a bug, so it gets an
 * InputError and comes back as a sentence. */
function enumFrom<T extends readonly string[]>(formData: FormData, key: string, allowed: T, label: string): T[number] {
  const raw = String(formData.get(key) ?? "");
  if (!allowed.includes(raw as T[number])) throw new InputError(`${label} is required`);
  return raw as T[number];
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Every date here is stored at UTC midnight, so comparing two of them
 * compares calendar days rather than instants — the same rule the RFI log
 * and the safety log follow. A date stamped at wall-clock time compares as
 * LATER than a same-day date entered by hand, which turns a valid
 * same-day response into a rejected one. */
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

function money(formData: FormData, key: string, label: string): string {
  const raw = required(formData, key, label);
  const value = Number(raw);
  if (Number.isNaN(value)) throw new InputError(`${label} must be a number`);
  if (value <= 0) throw new InputError(`${label} has to be more than $0`);
  return value.toFixed(2);
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

async function assertBackcharge(id: string, companyId: string) {
  const backcharge = await prisma.backcharge.findUnique({ where: { id } });
  if (!backcharge || backcharge.companyId !== companyId) {
    throw new InputError("Backcharge not found");
  }
  return backcharge;
}

/**
 * Issues the next backcharge number for a job.
 *
 * Reads nothing from Backcharge on purpose — same reasoning as RfiCounter
 * and SafetyCaseCounter. `max(number) + 1` frees a number again when the
 * highest row is deleted, so the next backcharge reissues it and two
 * different deductions have both been "backcharge 3" in correspondence.
 * Takes the transaction client so the increment and the insert are one
 * step: two people logging a backcharge on the same job at the same moment
 * would otherwise read the same value.
 */
async function issueBackchargeNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.backchargeCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

export async function createBackcharge(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const jobId = required(formData, "jobId", "Job");
    await assertJob(jobId, company.id);

    // The date on the GC's notice, entered rather than stamped. Logging
    // the three backcharges that came in last month must not record all
    // three as issued today — the gap between issue and response is the
    // whole evidentiary value of this record, and stamping it makes that
    // gap fiction.
    const issuedOn = requiredDate(formData, "issuedOn", "Date the GC issued it");
    const receivedOn = optionalDate(formData, "receivedOn", "Date we received it");
    const respondByDate = optionalDate(formData, "respondByDate", "Respond-by date");

    if (receivedOn && receivedOn < issuedOn) {
      throw new InputError("We can't have received it before the GC issued it");
    }
    if (respondByDate && respondByDate < issuedOn) {
      throw new InputError("The deadline to object can't be before the notice was issued");
    }

    await prisma.$transaction(async (tx) => {
      await tx.backcharge.create({
        data: {
          companyId: company.id,
          jobId,
          number: await issueBackchargeNumber(tx, jobId),
          gcReference: text(formData, "gcReference") || null,
          category: enumFrom(formData, "category", CATEGORIES, "Category"),
          description: required(formData, "description", "What it's for"),
          claimedAmount: money(formData, "claimedAmount", "Amount claimed"),
          issuedOn,
          receivedOn,
          respondByDate,
          loggedByUserId: user.id,
        },
      });
    });

    revalidatePath("/backcharges");
    return ok;
  });
}

/**
 * Edits the descriptive half of a backcharge.
 *
 * The claimed amount, the issue date and the GC's reference are the
 * identity of the notice — what they put in writing — and they lock the
 * moment we respond. Without that lock, "we argued them down from $8,000
 * to $2,500" is unprovable from this row: anyone could have moved the
 * $8,000 afterwards, and the savings figure on the page would be reporting
 * a number nobody ever claimed. Before we respond, the row is just our own
 * transcription of a letter and a typo in it is worth fixing.
 */
export async function updateBackcharge(id: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const backcharge = await assertBackcharge(id, company.id);
    const locked = backcharge.status !== "RECEIVED";

    const claimedAmount = locked
      ? backcharge.claimedAmount.toFixed(2)
      : money(formData, "claimedAmount", "Amount claimed");
    const issuedOn = locked
      ? backcharge.issuedOn
      : requiredDate(formData, "issuedOn", "Date the GC issued it");
    const gcReference = locked ? backcharge.gcReference : text(formData, "gcReference") || null;

    // The form renders these as read-only text once locked, so a differing
    // value here means the request didn't come from that form.
    if (locked) {
      const submittedAmount = text(formData, "claimedAmount");
      if (submittedAmount && Number(submittedAmount).toFixed(2) !== claimedAmount) {
        return fail(
          "We've already responded to this backcharge, so the amount the GC claimed can't be changed.",
        );
      }
    }

    const receivedOn = optionalDate(formData, "receivedOn", "Date we received it");
    const respondByDate = optionalDate(formData, "respondByDate", "Respond-by date");
    if (receivedOn && receivedOn < issuedOn) {
      throw new InputError("We can't have received it before the GC issued it");
    }
    if (respondByDate && respondByDate < issuedOn) {
      throw new InputError("The deadline to object can't be before the notice was issued");
    }

    await prisma.backcharge.update({
      where: { id: backcharge.id },
      data: {
        gcReference,
        category: enumFrom(formData, "category", CATEGORIES, "Category"),
        description: required(formData, "description", "What it's for"),
        claimedAmount,
        issuedOn,
        receivedOn,
        respondByDate,
      },
    });

    revalidatePath("/backcharges");
    return ok;
  });
}

/** Records our written objection. The date is the point: "we disputed it"
 * with no date is worth nothing against a GC holding a signed notice with
 * one. */
export async function disputeBackcharge(id: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const backcharge = await assertBackcharge(id, company.id);
    if (backcharge.status !== "RECEIVED") {
      return fail("This backcharge has already been answered.");
    }

    const disputedOn = optionalDate(formData, "disputedOn", "Date we objected") ?? utcMidnightToday();
    if (disputedOn < backcharge.issuedOn) {
      return fail("We can't have objected before the GC issued the backcharge.");
    }

    // Objecting after the contractual deadline is a real thing that
    // happens, and it is recorded rather than refused — a late objection
    // still happened, and hiding it would leave the row looking like we
    // never answered at all. The date says how late it was.
    await prisma.backcharge.update({
      where: { id: backcharge.id },
      data: {
        status: "DISPUTED",
        disputedOn,
        disputeReason: required(formData, "disputeReason", "Grounds for the objection"),
      },
    });

    revalidatePath("/backcharges");
    return ok;
  });
}

/**
 * Closes a backcharge out at one of the three real outcomes.
 *
 * Only SETTLED carries a figure. Accepting concedes exactly what was
 * claimed and a withdrawal concedes nothing — both are computed from the
 * status by concededAmount() in lib/backcharges.ts, so writing either into
 * resolvedAmount would be a second copy of a number this row already
 * holds, free to drift from it.
 */
export async function resolveBackcharge(id: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const backcharge = await assertBackcharge(id, company.id);
    if (backcharge.status !== "RECEIVED" && backcharge.status !== "DISPUTED") {
      return fail("This backcharge is already resolved. Reopen it to change the outcome.");
    }

    const outcome = enumFrom(formData, "outcome", OUTCOMES, "Outcome");
    const resolvedOn = optionalDate(formData, "resolvedOn", "Date it was resolved") ?? utcMidnightToday();

    if (resolvedOn < backcharge.issuedOn) {
      return fail("It can't have been resolved before the GC issued it.");
    }
    if (backcharge.disputedOn && resolvedOn < backcharge.disputedOn) {
      return fail("It can't have been resolved before we objected to it.");
    }

    let resolvedAmount: string | null = null;
    if (outcome === "SETTLED") {
      resolvedAmount = money(formData, "resolvedAmount", "Amount settled at");
      if (Number(resolvedAmount) > Number(backcharge.claimedAmount)) {
        return fail(
          "A settlement above what the GC claimed isn't this backcharge growing — log it as a new one.",
        );
      }
      // Settling at exactly the claim is accepting it, and letting both
      // shapes exist would make "how many did we concede in full" depend
      // on which button someone happened to press.
      if (Number(resolvedAmount) === Number(backcharge.claimedAmount)) {
        return fail(
          `Settling at the full $${Number(backcharge.claimedAmount).toFixed(2)} is accepting it — use "Accept in full".`,
        );
      }
    }

    await prisma.backcharge.update({
      where: { id: backcharge.id },
      data: {
        status: outcome,
        resolvedOn,
        resolvedAmount,
        resolutionNote: text(formData, "resolutionNote") || null,
      },
    });

    revalidatePath("/backcharges");
    return ok;
  });
}

/**
 * Puts a resolved backcharge back in play.
 *
 * GCs reopen these — a settlement falls through, a withdrawal turns out to
 * have been a different backcharge. It returns to DISPUTED when we had
 * objected and to RECEIVED when we hadn't, so the objection we already made
 * (and its date) survives being reopened rather than having to be re-entered
 * with today's date, which would destroy the evidence of when we actually
 * answered.
 */
export async function reopenBackcharge(id: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const backcharge = await assertBackcharge(id, company.id);
    if (backcharge.status === "RECEIVED" || backcharge.status === "DISPUTED") {
      return fail("This backcharge is already open.");
    }

    await prisma.backcharge.update({
      where: { id: backcharge.id },
      data: {
        status: backcharge.disputedOn ? "DISPUTED" : "RECEIVED",
        resolvedOn: null,
        resolvedAmount: null,
        resolutionNote: null,
      },
    });

    revalidatePath("/backcharges");
    return ok;
  });
}

/**
 * Deletes a backcharge we have not answered.
 *
 * Until we respond, this row is only our own transcription of a letter, so
 * a mis-keyed one is worth removing. After that it is half of an exchange
 * the GC also holds, and deleting it leaves a permanent hole in the
 * numbering with nothing to explain it — resolve it as withdrawn instead,
 * which is what actually happened if the GC dropped it.
 */
export async function deleteBackcharge(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (context.role !== "OWNER") {
      // Returned rather than thrown: assertOwner throws, and a thrown
      // Server Action message is redacted to a digest in production, so the
      // sentence explaining WHY the button did nothing would never arrive.
      return fail("Only the account owner can delete a backcharge");
    }
    const backcharge = await assertBackcharge(id, context.company.id);
    if (backcharge.status !== "RECEIVED") {
      return fail(
        "We've already answered this one, so it stays on the record. Resolve it as withdrawn instead.",
      );
    }

    await prisma.backcharge.delete({ where: { id: backcharge.id } });
    revalidatePath("/backcharges");
    return ok;
  });
}

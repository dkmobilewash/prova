"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import {
  actionFail as fail,
  actionOk as ok,
  assertOwner,
  isUniqueConstraintError,
  type ActionResult,
} from "./shared";

/** Every entry point to a closeout package is a page guarded by
 * MANAGE_JOBS, so every write here answers to the same capability.
 *
 * A guarded page in front of an open action is not a guard — the action is
 * its own endpoint and answers whoever posts to it. Before this, an
 * ACCOUNTING or FIELD member could create, edit and SUBMIT a closeout
 * package to the GC through a page that refuses to render for them, which
 * is worse than the page having been open: the two disagreed.
 *
 * Returned rather than thrown, matching this module's contract — production
 * redacts a thrown Server Action message, so the sentence explaining why
 * the button did nothing would never arrive. */
const JOBS_ONLY =
  "Closeout isn't part of your job function. The account owner sets who sees what, on the Team page.";


/** Actions in this module RETURN their failures instead of throwing them.
 * Production redacts thrown Server Action messages to an opaque digest, so
 * a plain-language guard would never reach the user. `ActionResult` and its
 * helpers live in `./shared`; `lib/actions/submittals.ts` is the reference.
 */

class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Stored at UTC midnight so comparisons are calendar-day comparisons. */
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

/** Links rather than uploads, same reason as drawing sets: a Server Action
 * body caps around 1MB. Only http(s) — this string goes into an `href`, so
 * a `javascript:` URL would be an injection vector. */
function optionalLink(formData: FormData, key: string): string | null {
  const raw = text(formData, key);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InputError("The link needs to be a full URL, starting with https://");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InputError("The link needs to start with https://");
  }
  return parsed.toString();
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

/* ---------------------------------------------------------------- closeout */

/** The documents a GC almost always wants before releasing final payment.
 * A starting point, not a rule — every item stays editable and deletable,
 * and the list is per company practice, not per contract. */
const STANDARD_CLOSEOUT_ITEMS: { name: string; isRequired: boolean }[] = [
  { name: "Final unconditional lien waiver", isRequired: true },
  { name: "Final certified payroll", isRequired: true },
  { name: "Warranty letter", isRequired: true },
  { name: "As-built drawings", isRequired: true },
  { name: "O&M manuals", isRequired: false },
  { name: "Punch list sign-off", isRequired: true },
  { name: "Consent of surety", isRequired: false },
];

export async function addStandardCloseoutChecklist(jobId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    await assertJob(jobId, company.id);

    // skipDuplicates so running this twice, or after adding one by hand,
    // tops the list up instead of failing on the unique constraint.
    await prisma.closeoutItem.createMany({
      data: STANDARD_CLOSEOUT_ITEMS.map((i) => ({
        companyId: company.id,
        jobId,
        name: i.name,
        isRequired: i.isRequired,
      })),
      skipDuplicates: true,
    });

    revalidatePath("/closeout");
    return ok;
  });
}

export async function addCloseoutItem(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const jobId = required(formData, "jobId", "Job");
    await assertJob(jobId, company.id);
    const name = required(formData, "name", "Item name");

    try {
      await prisma.closeoutItem.create({
        data: {
          companyId: company.id,
          jobId,
          name,
          isRequired: text(formData, "isRequired") === "on",
          note: text(formData, "note") || null,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail(`"${name}" is already on this job's checklist`);
      }
      throw err;
    }

    revalidatePath("/closeout");
    return ok;
  });
}

export async function updateCloseoutItem(itemId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const item = await prisma.closeoutItem.findUnique({ where: { id: itemId } });
    if (!item || item.companyId !== company.id) return fail("Checklist item not found");

    const name = required(formData, "name", "Item name");

    try {
      await prisma.closeoutItem.update({
        where: { id: item.id },
        data: {
          name,
          isRequired: text(formData, "isRequired") === "on",
          note: text(formData, "note") || null,
          // Entered, not stamped — backfilling a job that closed out in
          // March must not date every item today.
          completedOn: optionalDate(formData, "completedOn"),
          documentUrl: optionalLink(formData, "documentUrl"),
          documentName: text(formData, "documentName") || null,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail(`"${name}" is already on this job's checklist`);
      }
      throw err;
    }

    revalidatePath("/closeout");
    return ok;
  });
}

export async function deleteCloseoutItem(itemId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a checklist item");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const item = await prisma.closeoutItem.findUnique({ where: { id: itemId } });
    if (!item || item.companyId !== context.company.id) return fail("Checklist item not found");

    await prisma.closeoutItem.delete({ where: { id: item.id } });
    revalidatePath("/closeout");
    return ok;
  });
}

/* ---------------------------------------------------------------- warranty */

/** Creates or corrects the warranty clock on a job. One per job, enforced
 * by @@unique on jobId. */
export async function setWarrantyPeriod(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const jobId = required(formData, "jobId", "Job");
    await assertJob(jobId, company.id);

    const startsOn = requiredDate(formData, "startsOn", "Start date");

    const monthsRaw = required(formData, "months", "Length in months");
    const months = Number(monthsRaw);
    if (!Number.isInteger(months) || months < 1) {
      return fail("Length has to be a whole number of months, at least 1");
    }
    // 50 years. Not a real warranty, and a typo like 120 for 12 would
    // otherwise sit there quietly claiming cover we never gave.
    if (months > 600) {
      return fail("That's over 50 years — check the number of months");
    }

    const note = text(formData, "note") || null;

    await prisma.warrantyPeriod.upsert({
      where: { jobId },
      create: { companyId: company.id, jobId, startsOn, months, note },
      update: { startsOn, months, note },
    });

    revalidatePath("/closeout");
    return ok;
  });
}

export async function deleteWarrantyPeriod(jobId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can remove a warranty period");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const period = await prisma.warrantyPeriod.findUnique({ where: { jobId } });
    if (!period || period.companyId !== context.company.id) return fail("Warranty period not found");

    await prisma.warrantyPeriod.delete({ where: { jobId } });
    revalidatePath("/closeout");
    return ok;
  });
}

/* -------------------------------------------------------- service requests */

export async function recordServiceRequest(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const jobId = required(formData, "jobId", "Job");
    await assertJob(jobId, company.id);

    const reportedOn = requiredDate(formData, "reportedOn", "Date reported");
    const description = required(formData, "description", "What was reported");

    await prisma.warrantyServiceRequest.create({
      data: {
        companyId: company.id,
        jobId,
        reportedOn,
        description,
        reportedBy: text(formData, "reportedBy") || null,
        recordedByUserId: user.id,
      },
    });

    revalidatePath("/closeout");
    return ok;
  });
}

export async function updateServiceRequest(requestId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

    const request = await prisma.warrantyServiceRequest.findUnique({ where: { id: requestId } });
    if (!request || request.companyId !== company.id) return fail("Service request not found");

    // The reported date decides whether the call was in warranty, so it is
    // not editable here — moving it could quietly pull a call inside cover
    // it never had. Delete and re-record if it was entered wrong.
    const resolvedOn = optionalDate(formData, "resolvedOn");
    if (resolvedOn && resolvedOn < request.reportedOn) {
      return fail(
        `That's before ${isoDay(request.reportedOn)}, the day it was reported — it can't have been fixed first`,
      );
    }

    const responsibilityRaw = text(formData, "responsibility");
    const allowed = ["OURS", "NOT_OURS", "UNDETERMINED"] as const;
    if (!allowed.includes(responsibilityRaw as (typeof allowed)[number])) {
      return fail("Pick whose responsibility it turned out to be");
    }

    await prisma.warrantyServiceRequest.update({
      where: { id: request.id },
      data: {
        description: required(formData, "description", "What was reported"),
        reportedBy: text(formData, "reportedBy") || null,
        responsibility: responsibilityRaw as (typeof allowed)[number],
        resolvedOn,
        resolutionNote: text(formData, "resolutionNote") || null,
      },
    });

    revalidatePath("/closeout");
    return ok;
  });
}

export async function deleteServiceRequest(requestId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a service request");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const request = await prisma.warrantyServiceRequest.findUnique({ where: { id: requestId } });
    if (!request || request.companyId !== context.company.id) return fail("Service request not found");

    await prisma.warrantyServiceRequest.delete({ where: { id: request.id } });
    revalidatePath("/closeout");
    return ok;
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { LienDeadlineInputError, lienDateFromString } from "@/lib/lien-deadlines";
import type { WaiverCondition, WaiverStage } from "@/lib/lien-waiver";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/**
 * Issuing, correcting and withdrawing the lien waivers this company gives
 * a GC in exchange for payment.
 *
 * THE APP NEVER SAYS A WAIVER IS SAFE TO SIGN, and nothing here refuses a
 * save on the strength of an opinion about lien law. Every warning lives
 * in lib/lien-waiver.ts, is rendered next to the form, and is advisory —
 * see that file's header for why turning any of them into validation
 * would make the app wrong about the world. What IS refused here is the
 * ordinary stuff: a missing job, a date that will not parse, an amount
 * that is not a number.
 *
 * MANAGE_BILLING, matching lienDeadlines.ts and the billing tab this
 * renders on. Asserted in every action as well as on the page, because a
 * Server Action is its own endpoint and answers whoever posts to it
 * (lib/action-capability-guards.test.ts).
 *
 * Every action RETURNS its failure. Production redacts a thrown Server
 * Action message, so a refusal that reads perfectly in `next dev` reaches
 * a real person as a dead button (CLAUDE.md, Errors).
 *
 * THERE IS NO DELETE, ON PURPOSE. A waiver is an evidence record: sent
 * correspondence can close but never delete, the same rule that is why
 * this app has no `deleteInvoice`. A waiver issued in error is REVOKED,
 * which keeps the row and the fact that it once existed. `exceptedAmount`
 * is required on create for the same family of reason — see the schema.
 */

const NO_PERMISSION =
  "Lien waivers are part of billing, which isn't part of your job function. The account owner sets who sees what, on the Team page.";

const NOT_FOUND = "That lien waiver is no longer on your account.";

const SIGNED_IS_FINAL =
  "This waiver has been signed, so what it says is the record of what was given up. A signed waiver is never edited.";

const CONDITIONS: readonly WaiverCondition[] = ["CONDITIONAL", "UNCONDITIONAL"];
const STAGES: readonly WaiverStage[] = ["PROGRESS", "FINAL"];

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Parses an entered date, turning the input error into a sentence. */
function enteredDate(formData: FormData, key: string, what: string): Date | string {
  try {
    return lienDateFromString(formData.get(key), what);
  } catch (err) {
    if (err instanceof LienDeadlineInputError) return err.message;
    throw err;
  }
}

/**
 * A money field, refused rather than coerced.
 *
 * `Number("")` is 0 and `Number("  ")` is 0, which on THIS form is the
 * difference between "I except nothing" and "I did not fill that in" —
 * and the whole point of `exceptedAmount` having no column default is
 * that zero must always be something a person chose. So an empty string
 * is an error here, not a zero.
 */
function moneyFromForm(formData: FormData, key: string, what: string): number | string {
  const raw = text(formData, key);
  if (!raw) return `${what} is needed. Enter 0 if there is nothing to except.`;
  const value = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(value)) return `${what} must be a number.`;
  if (value < 0) return `${what} cannot be negative.`;
  return value;
}

function revalidate(jobId: string) {
  revalidatePath(`/jobs/${jobId}/billing`);
}

export async function createLienWaiver(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);
  const companyId = context.company.id;

  const jobId = text(formData, "jobId");
  if (!jobId) return fail("Pick a job.");

  const condition = text(formData, "condition") as WaiverCondition;
  if (!CONDITIONS.includes(condition)) return fail("Pick conditional or unconditional.");
  const stage = text(formData, "stage") as WaiverStage;
  if (!STAGES.includes(stage)) return fail("Pick progress or final.");

  const throughDate = enteredDate(formData, "throughDate", "The through date");
  if (typeof throughDate === "string") return fail(throughDate);

  const amount = moneyFromForm(formData, "amount", "The amount");
  if (typeof amount === "string") return fail(amount);
  const exceptedAmount = moneyFromForm(formData, "exceptedAmount", "The excepted amount");
  if (typeof exceptedAmount === "string") return fail(exceptedAmount);

  // Re-read through THIS company: a forged id finds no row and is refused
  // in the same words as a typo, with no "belongs to someone else" branch.
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true } });
  if (!job) return fail("That job is not on your account.");

  // Optional, and checked against the same job rather than merely the same
  // company — a waiver pointing at another job's invoice would compute its
  // payment warning against money that has nothing to do with it.
  const invoiceId = text(formData, "invoiceId");
  if (invoiceId) {
    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, jobId: job.id }, select: { id: true } });
    if (!invoice) return fail("That pay application is not on this job.");
  }

  await prisma.lienWaiver.create({
    data: {
      companyId,
      jobId: job.id,
      invoiceId: invoiceId || null,
      condition,
      stage,
      throughDate,
      amount,
      exceptedAmount,
      exceptionsNote: text(formData, "exceptionsNote") || null,
      createdByUserId: context.id,
    },
  });

  revalidate(job.id);
  return ok;
}

/**
 * Corrects a waiver that has not been signed.
 *
 * Job is not editable — it is what the row IS. Condition and stage ARE,
 * because "I picked the wrong form" is the most likely correction anybody
 * makes here, and it is the one worth making before the paper goes out.
 */
export async function updateLienWaiver(id: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);

  const existing = await prisma.lienWaiver.findFirst({
    where: { id, companyId: context.company.id },
    select: { id: true, jobId: true, status: true, revokedAt: true },
  });
  if (!existing) return fail(NOT_FOUND);
  if (existing.status === "SIGNED") return fail(SIGNED_IS_FINAL);
  if (existing.revokedAt) return fail("This waiver was withdrawn. Issue a new one rather than editing it.");

  const condition = text(formData, "condition") as WaiverCondition;
  if (!CONDITIONS.includes(condition)) return fail("Pick conditional or unconditional.");
  const stage = text(formData, "stage") as WaiverStage;
  if (!STAGES.includes(stage)) return fail("Pick progress or final.");

  const throughDate = enteredDate(formData, "throughDate", "The through date");
  if (typeof throughDate === "string") return fail(throughDate);

  const amount = moneyFromForm(formData, "amount", "The amount");
  if (typeof amount === "string") return fail(amount);
  const exceptedAmount = moneyFromForm(formData, "exceptedAmount", "The excepted amount");
  if (typeof exceptedAmount === "string") return fail(exceptedAmount);

  await prisma.lienWaiver.update({
    where: { id: existing.id },
    data: {
      condition,
      stage,
      throughDate,
      amount,
      exceptedAmount,
      exceptionsNote: text(formData, "exceptionsNote") || null,
    },
  });

  revalidate(existing.jobId);
  return ok;
}

/**
 * Withdraws an unsigned waiver, which is this model's answer to delete.
 *
 * The row stays. A waiver that was issued and then pulled is evidence of
 * having been issued, and the link it carries has to stop working — both
 * of which a delete would lose.
 */
export async function revokeLienWaiver(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);

  const existing = await prisma.lienWaiver.findFirst({
    where: { id, companyId: context.company.id },
    select: { id: true, jobId: true, status: true, revokedAt: true },
  });
  if (!existing) return fail(NOT_FOUND);
  if (existing.status === "SIGNED") {
    return fail("This waiver has been signed. A signed waiver is a record of what was given up and stays on the job.");
  }
  if (existing.revokedAt) return ok;

  await prisma.lienWaiver.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  revalidate(existing.jobId);
  return ok;
}

/**
 * Records that the executed waiver came back signed.
 *
 * THE DATE IS ENTERED, not stamped. It is the date on the document the GC
 * holds — which is routinely not the day somebody got round to recording
 * it, and it is the date that would be read out if this were ever argued
 * about. Same rule as `markLienDeadlineServed`, and the same rule the
 * schema states for every date here.
 *
 * Signing is where this row stops being editable: after this, what it
 * says is the record of what was given up.
 */
export async function markLienWaiverSigned(id: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_BILLING")) return fail(NO_PERMISSION);

  const existing = await prisma.lienWaiver.findFirst({
    where: { id, companyId: context.company.id },
    select: { id: true, jobId: true, status: true, revokedAt: true },
  });
  if (!existing) return fail(NOT_FOUND);
  if (existing.status === "SIGNED") return fail("This one is already recorded as signed.");
  if (existing.revokedAt) {
    return fail("This waiver was withdrawn. If it was signed anyway, issue a new one recording what was actually given up.");
  }

  const signedAt = enteredDate(formData, "signedAt", "The signed date");
  if (typeof signedAt === "string") return fail(signedAt);

  await prisma.lienWaiver.update({
    where: { id: existing.id },
    data: { status: "SIGNED", signedAt, signerName: text(formData, "signerName") || null },
  });

  revalidate(existing.jobId);
  return ok;
}

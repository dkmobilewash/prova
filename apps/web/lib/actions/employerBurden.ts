"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  employerBurdenEffectiveDate,
  employerBurdenPercentProblem,
} from "@/lib/employer-burden";
import {
  actionFail as fail,
  actionOk as ok,
  InputError,
  isUniqueConstraintError,
  ownerRefusal,
  runAction,
  type ActionResult,
} from "./shared";

/**
 * The employer burden percentage — RECORDED as the company's accountant
 * worked it out, never computed here.
 *
 * Nothing in this module estimates, defaults or back-fills one. Employer FICA
 * has a wage base per employee per calendar year, FUTA/SUTA is per-state with
 * an experience rating, and workers' comp is a manual rate per class code
 * times the mod times whatever the carrier actually wrote — this app holds
 * none of those inputs, so any figure derived here would be a number the
 * company's CPA has never seen. See employer-burden.prisma.
 *
 * EVERY WRITE IS OWNER-ONLY, AND THAT IS NOT DECORATION. This one number
 * multiplies the labor inside `actualCostToDate` on every job with logged
 * hours, and therefore percent complete, earned revenue, over/under billing
 * and the WIP schedule a surety reads. It belongs to whoever answers for
 * those figures.
 *
 * Actions RETURN their failures rather than throwing: production redacts a
 * thrown Server Action message. `lib/actions/submittals.ts` is the reference,
 * and `lib/actions/emr.ts` is the effective-dated shape this file copies.
 */

const OWNER_ONLY =
  "Only the account owner can change the employer burden percentage — it moves the cost on every job.";

/** /settings is guarded by MANAGE_COMPLIANCE, so every write here answers to
 * the same capability. A Server Action is its own endpoint with a stable id
 * and it answers whoever posts to it, page or no page — the page guard stops
 * a page rendering and nothing else. Checked FIRST, before the owner check
 * and before any query. */
const COMPLIANCE_ONLY =
  "Company settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function percentFromForm(formData: FormData): string {
  const raw = text(formData, "percent");
  const problem = employerBurdenPercentProblem(raw);
  if (problem) throw new InputError(problem);
  return raw;
}

/** ENTERED, stored at UTC midnight — the day the percentage starts applying
 * from, off whatever the accountant worked it out against. Never defaulted to
 * today by the server. */
function effectiveDateFromForm(formData: FormData): Date {
  const date = employerBurdenEffectiveDate(text(formData, "effectiveDate"));
  if (typeof date === "string") throw new InputError(date);
  return date;
}

function duplicateDateMessage(date: Date) {
  return `A burden rate effective ${date.toISOString().slice(0, 10)} is already on file. If the figure has been reworked for that same date, edit that one.`;
}

export async function recordEmployerBurdenRate(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const refusal = ownerRefusal(context, OWNER_ONLY);
    if (refusal) return refusal;

    const effectiveDate = effectiveDateFromForm(formData);
    const percent = percentFromForm(formData);

    try {
      await prisma.employerBurdenRate.create({
        data: {
          companyId: company.id,
          effectiveDate,
          percent,
          note: text(formData, "note") || null,
          createdByUserId: user.id,
        },
      });
    } catch (err) {
      // @@unique([companyId, effectiveDate]): one rate per start date.
      if (isUniqueConstraintError(err)) return fail(duplicateDateMessage(effectiveDate));
      throw err;
    }

    // Every surface that prices logged hours, because every one of them now
    // reads this rate. Listed rather than swept with a layout-level
    // revalidate so that adding a surface means adding a line here and the
    // omission is visible in a diff.
    for (const path of ["/settings", "/jobs", "/dashboard", "/catalog", "/phase-codes", "/reports"]) {
      revalidatePath(path);
    }
    return ok;
  });
}

/** Corrects a recorded percentage — a typo, or the accountant reworking the
 * same period. The effective date is NOT editable: it is the identity of the
 * row and half its unique key, and moving it would silently re-cost hours in
 * a period nobody asked about. A rate recorded against the wrong date is
 * deleted and recorded again. */
export async function updateEmployerBurdenRate(
  rateId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const refusal = ownerRefusal(context, OWNER_ONLY);
    if (refusal) return refusal;

    const existing = await prisma.employerBurdenRate.findFirst({
      where: { id: rateId, companyId: context.company.id },
    });
    if (!existing) return fail("That burden rate isn't on file");

    await prisma.employerBurdenRate.update({
      where: { id: existing.id },
      data: {
        percent: percentFromForm(formData),
        note: text(formData, "note") || null,
      },
    });

    for (const path of ["/settings", "/jobs", "/dashboard", "/catalog", "/phase-codes", "/reports"]) {
      revalidatePath(path);
    }
    return ok;
  });
}

export async function deleteEmployerBurdenRate(rateId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const refusal = ownerRefusal(context, OWNER_ONLY);
    if (refusal) return refusal;

    const existing = await prisma.employerBurdenRate.findFirst({
      where: { id: rateId, companyId: context.company.id },
    });
    if (!existing) return fail("That burden rate isn't on file");

    await prisma.employerBurdenRate.delete({ where: { id: existing.id } });
    for (const path of ["/settings", "/jobs", "/dashboard", "/catalog", "/phase-codes", "/reports"]) {
      revalidatePath(path);
    }
    return ok;
  });
}

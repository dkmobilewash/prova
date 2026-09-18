"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { emrRateProblem } from "@/lib/emr";
import { can } from "@/lib/permissions";
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
 * The experience modification rate, RECORDED as the bureau issued it.
 *
 * Every write here takes the rate from a person reading a worksheet. Nothing
 * in this module computes, estimates or defaults one — see emr.prisma for
 * why a figure derived from the OSHA log would be a number no insurer quoted.
 *
 * Actions RETURN their failures rather than throwing: production redacts a
 * thrown Server Action message. `lib/actions/submittals.ts` is the reference.
 */

/** /compliance is guarded by MANAGE_COMPLIANCE, so every write here answers
 * to the same capability. A Server Action is its own endpoint and answers
 * whoever posts to it, page or no page. Checked FIRST, before the owner check
 * on the delete and before any query. */
const COMPLIANCE_ONLY =
  "Insurance records aren't part of your job function. The account owner sets who sees what, on the Team page.";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function rateFromForm(formData: FormData): string {
  const raw = text(formData, "rate");
  const problem = emrRateProblem(raw);
  if (problem) throw new InputError(problem);
  return raw;
}

/** ENTERED, stored at UTC midnight — the first day of the policy year, off
 * the worksheet. Never defaulted to today by the server. */
function effectiveDateFromForm(formData: FormData): Date {
  const raw = text(formData, "effectiveDate");
  if (!raw) throw new InputError("The effective date is required");
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(date.getTime())) {
    throw new InputError("The effective date is not a valid date");
  }
  return date;
}

function sourceFromForm(formData: FormData): string {
  const source = text(formData, "source");
  if (!source) throw new InputError("Say who issued it — the rating bureau or the carrier");
  return source;
}

/** http(s) only: this string goes straight into an href, so a `javascript:`
 * or `data:` URL would be an injection vector. Same guard as certifications. */
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

function duplicateDateMessage(date: Date) {
  return `A rate effective ${date.toISOString().slice(0, 10)} is already on file. If the bureau revised it, edit that one.`;
}

export async function recordExperienceModRate(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const effectiveDate = effectiveDateFromForm(formData);
    const rate = rateFromForm(formData);
    const source = sourceFromForm(formData);
    const sourceUrl = optionalLink(formData, "sourceUrl");

    try {
      await prisma.experienceModRate.create({
        data: {
          companyId: company.id,
          effectiveDate,
          rate,
          source,
          sourceUrl,
          note: text(formData, "note") || null,
          createdByUserId: user.id,
        },
      });
    } catch (err) {
      // @@unique([companyId, effectiveDate]): one rate per policy year start.
      if (isUniqueConstraintError(err)) return fail(duplicateDateMessage(effectiveDate));
      throw err;
    }

    revalidatePath("/compliance");
    return ok;
  });
}

/** Corrects a recorded rate — a typo, or a bureau revision of the same
 * rating. The effective date is NOT editable: it is the identity of the row
 * and half its unique key. A rate recorded against the wrong year is deleted
 * and recorded again, so no edit can quietly move a rating between years. */
export async function updateExperienceModRate(rateId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const existing = await prisma.experienceModRate.findFirst({
      where: { id: rateId, companyId: context.company.id },
    });
    if (!existing) return fail("That rate isn't on file");

    await prisma.experienceModRate.update({
      where: { id: existing.id },
      data: {
        rate: rateFromForm(formData),
        source: sourceFromForm(formData),
        sourceUrl: optionalLink(formData, "sourceUrl"),
        note: text(formData, "note") || null,
      },
    });

    revalidatePath("/compliance");
    return ok;
  });
}

export async function deleteExperienceModRate(rateId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const refusal = ownerRefusal(context, "Only the account owner can delete a mod rate");
    if (refusal) return refusal;

    const existing = await prisma.experienceModRate.findFirst({
      where: { id: rateId, companyId: context.company.id },
    });
    if (!existing) return fail("That rate isn't on file");

    await prisma.experienceModRate.delete({ where: { id: existing.id } });
    revalidatePath("/compliance");
    return ok;
  });
}

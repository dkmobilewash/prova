"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import {
  actionFail as fail,
  actionOk as ok,
  isUniqueConstraintError,
  type ActionResult,
} from "./shared";
import { can } from "@/lib/permissions";

/** Deleting a filed daily report had NO guard of any kind — not owner,
 * not capability — while every other delete in this folder has at least
 * assertOwner. A daily report is what a delay claim is argued from
 * months later, so it is the last thing that should have been the
 * easiest to remove.
 *
 * MANAGE_FIELD, matching /field-reports. Deliberately NOT applied to
 * create/update in this module yet: those forms also live on
 * /jobs/[id], which stays open on purpose (accounting and
 * payroll/compliance both have to reach a job), so gating them would
 * leave a composer rendering on that page for people it then refuses.
 * Hiding those sections is a change to jobs/[id]/page.tsx, which is the
 * other lane. */
const FIELD_ONLY =
  "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** Actions here RETURN their failures instead of throwing them.
 *
 * They used to throw, and one of those throws was the most user-facing
 * sentence in the module: "A report already exists for that date — edit it
 * instead of adding a second one." Production redacts a thrown Server
 * Action message to an opaque digest, so a foreman filing a second report
 * for the same day got a crash instead of the one sentence that told him
 * what to do. The guard was correct; it just could never be read.
 */

class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Reports are keyed by date with no time component. Everything is written
 * at UTC midnight so the @@unique([jobId, reportDate]) constraint means
 * "one per calendar day" rather than "one per instant". */
function reportDateFromForm(formData: FormData): Date {
  const raw = text(formData, "reportDate");
  if (!raw) throw new InputError("Date is required");
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError("Date is not valid");
  return date;
}

function fieldsFromForm(formData: FormData) {
  const workPerformed = text(formData, "workPerformed");
  if (!workPerformed) throw new InputError("Work performed is required");
  return {
    workPerformed,
    crewPresent: text(formData, "crewPresent") || null,
    weather: text(formData, "weather") || null,
    delays: text(formData, "delays") || null,
  };
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/** Both surfaces that show reports: the job's own page, and the
 * company-wide log. Revalidating only the job page left the log showing a
 * stale week. */
function revalidateBoth(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/field-reports");
}

export async function createDailyFieldReport(
  jobId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== company.id) return fail("Job not found");

    const data = {
      companyId: company.id,
      jobId,
      reportDate: reportDateFromForm(formData),
      filedByUserId: user.id,
      ...fieldsFromForm(formData),
    };

    try {
      await prisma.dailyFieldReport.create({ data });
    } catch (error) {
      // P2002 = the one-per-job-per-day constraint. Checked by `code`, NOT
      // by an instanceof against the Prisma error class — that instanceof
      // is false at runtime here (measured 2026-08-28). See
      // isUniqueConstraintError.
      if (isUniqueConstraintError(error)) {
        return fail("A report already exists for that date — edit it instead of adding a second one");
      }
      throw error;
    }

    revalidateBoth(jobId);
    return ok;
  });
}

export async function updateDailyFieldReport(
  reportId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const report = await prisma.dailyFieldReport.findUnique({ where: { id: reportId } });
    if (!report || report.companyId !== company.id) return fail("Report not found");

    await prisma.dailyFieldReport.update({
      where: { id: reportId },
      data: fieldsFromForm(formData),
    });

    revalidateBoth(report.jobId);
    return ok;
  });
}

/** The date is deliberately not editable: it's the identity of the record.
 * Filed against the wrong day, delete it and file the right one. */
export async function deleteDailyFieldReport(reportId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company } = context;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);
    const report = await prisma.dailyFieldReport.findUnique({ where: { id: reportId } });
    if (!report || report.companyId !== company.id) return fail("Report not found");

    await prisma.dailyFieldReport.delete({ where: { id: reportId } });

    revalidateBoth(report.jobId);
    return ok;
  });
}

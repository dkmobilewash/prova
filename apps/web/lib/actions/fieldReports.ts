"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";
import { can } from "@/lib/permissions";
import {
  createFieldReport,
  fieldReportFields,
  FieldReportInputError,
  FIELD_ONLY,
} from "@/lib/field-reports-core";

/**
 * The Server Action surface for daily field reports: parse FormData, call
 * the shared core in lib/field-reports-core.ts, revalidate, return.
 *
 * The core owns everything that must not differ between the web action and
 * the mobile HTTP API (app/api/v1/field-reports): the job-ownership check,
 * date coercion, field validation, and the P2002 "already exists" catch.
 * This file owns what a Server Action uniquely has — FormData in, server
 * cache out. FIELD_ONLY and its rationale live in the core too, since both
 * surfaces need the same sentence.
 *
 * Actions here RETURN their failures instead of throwing them. They used to
 * throw, and one of those throws was the most user-facing sentence in the
 * module: "A report already exists for that date — edit it instead of
 * adding a second one." Production redacts a thrown Server Action message
 * to an opaque digest, so a foreman filing a second report for the same day
 * got a crash instead of the one sentence that told him what to do. The
 * guard was correct; it just could never be read.
 */

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FieldReportInputError) return fail(err.message);
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
  const result = await createFieldReport(company, user.id, {
    jobId,
    reportDate: text(formData, "reportDate"),
    workPerformed: text(formData, "workPerformed"),
    crewPresent: text(formData, "crewPresent"),
    weather: text(formData, "weather"),
    delays: text(formData, "delays"),
  });
  if (result.ok) revalidateBoth(jobId);
  return result;
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
      data: fieldReportFields({
        workPerformed: text(formData, "workPerformed"),
        crewPresent: text(formData, "crewPresent"),
        weather: text(formData, "weather"),
        delays: text(formData, "delays"),
      }),
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

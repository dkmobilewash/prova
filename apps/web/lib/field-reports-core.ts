// The database-and-ownership core of daily field reports, shared by the
// Server Action (lib/actions/fieldReports.ts) and the mobile HTTP API
// (app/api/v1/field-reports/route.ts).
//
// Deliberately NOT "use server" and deliberately touching neither FormData
// nor revalidatePath: a phone has no server cache to revalidate and no
// FormData to parse. Each caller owns its transport — the action parses
// FormData and revalidates, the route parses JSON and answers HTTP — and
// both call these functions for the part that must not differ between them:
// what a report is allowed to be, and who is allowed to file one.

import { prisma } from "@prova/db";
import {
  actionFail,
  actionOk,
  isUniqueConstraintError,
  type ActionResult,
  type ActionResultWith,
} from "@/lib/actions/shared";

/** Deleting a filed daily report had NO guard of any kind — not owner,
 * not capability — while every other delete in this folder has at least
 * assertOwner. A daily report is what a delay claim is argued from
 * months later, so it is the last thing that should have been the
 * easiest to remove.
 *
 * MANAGE_FIELD, matching /field-reports. Deliberately NOT applied to
 * create/update in the action yet: those forms also live on
 * /jobs/[id], which stays open on purpose (accounting and
 * payroll/compliance both have to reach a job), so gating them would
 * leave a composer rendering on that page for people it then refuses.
 * Hiding those sections is a change to jobs/[id]/page.tsx, which is the
 * other lane.
 *
 * The mobile API DOES gate create on MANAGE_FIELD: a phone has no /jobs
 * page whose sections could be hidden, so there is nothing to protect by
 * leaving it open — see the route. */
export const FIELD_ONLY =
  "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

export class FieldReportInputError extends Error {}

/** Reports are keyed by date with no time component. Everything is written
 * at UTC midnight so the @@unique([jobId, reportDate]) constraint means
 * "one per calendar day" rather than "one per instant". */
export function reportDateFromString(raw: unknown): Date {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new FieldReportInputError("Date is required");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new FieldReportInputError("Date is not valid");
  return date;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type FieldReportFields = {
  workPerformed: string;
  crewPresent: string | null;
  weather: string | null;
  delays: string | null;
};

export function fieldReportFields(input: {
  workPerformed?: unknown;
  crewPresent?: unknown;
  weather?: unknown;
  delays?: unknown;
}): FieldReportFields {
  const workPerformed = asString(input.workPerformed);
  if (!workPerformed) throw new FieldReportInputError("Work performed is required");
  return {
    workPerformed,
    crewPresent: asString(input.crewPresent) || null,
    weather: asString(input.weather) || null,
    delays: asString(input.delays) || null,
  };
}

export type FieldReportInput = {
  jobId: string;
  reportDate?: unknown;
  workPerformed?: unknown;
  crewPresent?: unknown;
  weather?: unknown;
  delays?: unknown;
};

/**
 * Creates one report for a job, on behalf of a signed-in user of `company`.
 *
 * The job must belong to the caller's company — checked here, not in the
 * caller, because it is the difference between a typo'd job id and a
 * cross-tenant read, and a phone posts whatever id its screen shows. The
 * duplicate-date message is the one sentence a foreman has to be able to
 * read: a second report for the same day is an edit, not an add.
 */
export async function createFieldReport(
  company: { id: string },
  filedByUserId: string,
  input: FieldReportInput,
): Promise<ActionResult> {
  try {
    const job = await prisma.job.findUnique({ where: { id: input.jobId } });
    if (!job || job.companyId !== company.id) return actionFail("Job not found");

    const data = {
      companyId: company.id,
      jobId: input.jobId,
      reportDate: reportDateFromString(input.reportDate),
      filedByUserId,
      ...fieldReportFields(input),
    };

    try {
      await prisma.dailyFieldReport.create({ data });
    } catch (error) {
      // P2002 = the one-per-job-per-day constraint. Checked by `code`, NOT
      // by an instanceof against the Prisma error class — that instanceof
      // is false at runtime here (measured 2026-08-28). See
      // isUniqueConstraintError.
      if (isUniqueConstraintError(error)) {
        return actionFail("A report already exists for that date — edit it instead of adding a second one");
      }
      throw error;
    }

    return actionOk;
  } catch (error) {
    if (error instanceof FieldReportInputError) return actionFail(error.message);
    throw error;
  }
}

export type FieldReportRow = {
  id: string;
  jobId: string;
  reportDate: string;
  crewPresent: string | null;
  workPerformed: string;
  weather: string | null;
  delays: string | null;
  filedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The reports for one job, newest first, as plain JSON-ready rows. The job
 * must belong to `company` for the same reason create checks it.
 */
export async function listFieldReportsForJob(
  company: { id: string },
  jobId: string,
): Promise<ActionResultWith<FieldReportRow[]>> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== company.id) return { ok: false, error: "Job not found" };

  const rows = await prisma.dailyFieldReport.findMany({
    where: { companyId: company.id, jobId },
    orderBy: { reportDate: "desc" },
  });

  return {
    ok: true,
    value: rows.map((row) => ({ ...row, reportDate: row.reportDate.toISOString().slice(0, 10) })),
  };
}

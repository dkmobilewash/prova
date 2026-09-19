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
import { isUniqueConstraintError, type ActionResultWith } from "@/lib/actions/shared";
import { refreshReportWeather } from "@/lib/report-weather";
import { liveSignoff, lockedDayMessage } from "@/lib/timesheet-signoff";

/** True for the refusal the DailyFieldReport day-lock trigger raises — a day
 * signed between the app's own check and the write. */
export function isReportDayLockError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("DailyFieldReport day is signed and locked");
}

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

function asNullableString(value: unknown): string | null {
  return asString(value) || null;
}

/** The client's edit clock. Null for web writes (which never send it);
 * parsed to a Date only when a non-empty value arrives, so a phone's ISO
 * string becomes a comparable instant for last-write-wins. */
function clientUpdatedAtFrom(raw: unknown): Date | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new FieldReportInputError("clientUpdatedAt is not valid");
  return date;
}

export type FieldReportFields = {
  workPerformed: string;
  crewPresent: string | null;
  weather: string | null;
  /** Absent unless the caller sent it. The free-text delays box is
   * superseded by DelayEvent and no screen sends it any more; an edit that
   * does not mention it must leave an older report's typed delays alone,
   * not blank them. */
  delays?: string | null;
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
    ...(input.delays !== undefined ? { delays: asString(input.delays) || null } : {}),
  };
}

export type FieldReportInput = {
  jobId: string;
  reportDate?: unknown;
  workPerformed?: unknown;
  crewPresent?: unknown;
  weather?: unknown;
  delays?: unknown;
  clientId?: unknown;
  clientOperationId?: unknown;
  clientUpdatedAt?: unknown;
};

/** The field-name array Prisma puts on a P2002 (`error.meta.target`), e.g.
 * ["companyId", "clientOperationId"]. Tolerates the string form too, and
 * returns null when the shape is unknown so callers fall back safely. */
function uniqueConstraintTarget(error: unknown): string[] | null {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map((t) => String(t));
  if (typeof target === "string") return [target];
  return null;
}

type FieldReportDbRow = {
  id: string;
  jobId: string;
  reportDate: Date;
  crewPresent: string | null;
  workPerformed: string;
  weather: string | null;
  delays: string | null;
  weatherAuto: unknown;
  filedByUserId: string | null;
  clientId: string | null;
  clientUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FieldReportRow = {
  id: string;
  jobId: string;
  reportDate: string;
  crewPresent: string | null;
  workPerformed: string;
  weather: string | null;
  delays: string | null;
  /** The automatic site weather (lib/weather.ts DayWeather), or null. */
  weatherAuto: unknown;
  filedByUserId: string | null;
  clientId: string | null;
  clientUpdatedAt: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** JSON-ready row. clientOperationId is deliberately NOT exposed — it is a
 * create-intent idempotency key, not something a client should render or
 * echo back outside a retry. */
function toFieldReportRow(row: FieldReportDbRow): FieldReportRow {
  return {
    id: row.id,
    jobId: row.jobId,
    reportDate: row.reportDate.toISOString().slice(0, 10),
    crewPresent: row.crewPresent,
    workPerformed: row.workPerformed,
    weather: row.weather,
    delays: row.delays,
    weatherAuto: row.weatherAuto ?? null,
    filedByUserId: row.filedByUserId,
    clientId: row.clientId,
    clientUpdatedAt: row.clientUpdatedAt ? row.clientUpdatedAt.toISOString() : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Creates one report for a job, on behalf of a signed-in user of `company`.
 *
 * The job must belong to the caller's company — checked here, not in the
 * caller, because it is the difference between a typo'd job id and a
 * cross-tenant read, and a phone posts whatever id its screen shows. The
 * duplicate-date message is the one sentence a foreman has to be able to
 * read: a second report for the same day is an edit, not an add.
 *
 * When `clientOperationId` is given (mobile), a retried POST replays
 * instead of double-filing: the same key returns the row it already made,
 * with `created: false`, so the route can answer 200 instead of 201.
 */
export async function createFieldReport(
  company: { id: string },
  filedByUserId: string,
  input: FieldReportInput,
): Promise<ActionResultWith<{ report: FieldReportRow; created: boolean }>> {
  const clientId = asNullableString(input.clientId);
  const clientOperationId = asNullableString(input.clientOperationId);
  const clientUpdatedAt = clientUpdatedAtFrom(input.clientUpdatedAt);

  try {
    const job = await prisma.job.findUnique({ where: { id: input.jobId } });
    if (!job || job.companyId !== company.id) return { ok: false, error: "Job not found" };

    if (clientOperationId) {
      const existing = await prisma.dailyFieldReport.findUnique({
        where: { companyId_clientOperationId: { companyId: company.id, clientOperationId } },
      });
      if (existing) return { ok: true, value: { report: toFieldReportRow(existing), created: false } };
    }

    const reportDate = reportDateFromString(input.reportDate);
    const live = await liveSignoff(input.jobId, reportDate);
    if (live) return { ok: false, error: lockedDayMessage(reportDate, live) };

    const data = {
      companyId: company.id,
      jobId: input.jobId,
      reportDate,
      filedByUserId,
      ...fieldReportFields(input),
      clientId,
      clientOperationId,
      clientUpdatedAt,
    };

    try {
      const created = await prisma.dailyFieldReport.create({ data });
      const weather = await refreshReportWeather(job, [created], 1);
      const row = toFieldReportRow(created);
      if (weather.has(created.id)) row.weatherAuto = weather.get(created.id);
      return { ok: true, value: { report: row, created: true } };
    } catch (error) {
      if (isReportDayLockError(error)) return { ok: false, error: "That day was just signed, so its report is locked." };
      // P2002 = a unique constraint fired. Checked by `code`, NOT by an
      // instanceof against the Prisma error class — that instanceof is
      // false at runtime here (measured 2026-08-28). See
      // isUniqueConstraintError.
      if (isUniqueConstraintError(error)) {
        // Two devices filed the same create-intent concurrently: the
        // (companyId, clientOperationId) unique fired. Re-read the winner
        // and return it — the retry is a replay, not a duplicate.
        if (clientOperationId && uniqueConstraintTarget(error)?.includes("clientOperationId")) {
          const existing = await prisma.dailyFieldReport.findUnique({
            where: { companyId_clientOperationId: { companyId: company.id, clientOperationId } },
          });
          if (existing) return { ok: true, value: { report: toFieldReportRow(existing), created: false } };
        }
        // Otherwise (jobId, reportDate): the one-per-job-per-day sentence.
        return { ok: false, error: "A report already exists for that date — edit it instead of adding a second one" };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof FieldReportInputError) return { ok: false, error: error.message };
    throw error;
  }
}

export type UpdateFieldReportInput = {
  workPerformed?: unknown;
  crewPresent?: unknown;
  weather?: unknown;
  delays?: unknown;
  clientId?: unknown;
  clientUpdatedAt?: unknown;
};

/**
 * Edits one report. Shared by the web action and the mobile PATCH route so
 * they cannot drift.
 *
 * Last-write-wins: a phone replays edits it made while offline, and the
 * client clock decides whose edit survives. A stale edit (older
 * `clientUpdatedAt`) is dropped and the stored row returned with
 * `applied: false` — never blocked, never clobbered. Web edits carry no
 * `clientUpdatedAt`, so they always apply and the server `@updatedAt`
 * stays authoritative for them.
 */
export async function updateFieldReport(
  company: { id: string },
  reportId: string,
  input: UpdateFieldReportInput,
): Promise<ActionResultWith<{ applied: boolean; report: FieldReportRow }>> {
  const clientId = asNullableString(input.clientId);
  const clientUpdatedAt = clientUpdatedAtFrom(input.clientUpdatedAt);

  try {
    const report = await prisma.dailyFieldReport.findUnique({ where: { id: reportId } });
    if (!report || report.companyId !== company.id) return { ok: false, error: "Report not found" };

    if (clientUpdatedAt && report.clientUpdatedAt && clientUpdatedAt < report.clientUpdatedAt) {
      return { ok: true, value: { applied: false, report: toFieldReportRow(report) } };
    }

    const live = await liveSignoff(report.jobId, report.reportDate);
    if (live) return { ok: false, error: lockedDayMessage(report.reportDate, live) };

    let updated;
    try {
      updated = await prisma.dailyFieldReport.update({
        where: { id: reportId },
        data: {
          ...fieldReportFields(input),
          ...(clientId ? { clientId } : {}),
          ...(clientUpdatedAt ? { clientUpdatedAt } : {}),
        },
      });
    } catch (error) {
      if (isReportDayLockError(error)) return { ok: false, error: "That day was just signed, so its report is locked." };
      throw error;
    }

    return { ok: true, value: { applied: true, report: toFieldReportRow(updated) } };
  } catch (error) {
    if (error instanceof FieldReportInputError) return { ok: false, error: error.message };
    throw error;
  }
}

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
  const weather = await refreshReportWeather(job, rows);

  return {
    ok: true,
    value: rows.map((r) => {
      const row = toFieldReportRow(r);
      if (weather.has(r.id)) row.weatherAuto = weather.get(r.id);
      return row;
    }),
  };
}

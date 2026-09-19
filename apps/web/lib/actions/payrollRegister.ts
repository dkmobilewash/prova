"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { certifiedPayrollWeekStart } from "@/lib/certified-payroll-week";
import { dateFromDay, importTooLarge, TOO_LARGE_MESSAGE } from "@/lib/spreadsheet-import";
import {
  planPayrollRegisterImport,
  REGISTER_FIELD_LIST,
  type RegisterField,
  type RegisterOverrides,
} from "@/lib/payroll-register-import";
import { issueWh347PayrollNumber } from "@/lib/wh347-payroll-number";
import { IMPORT_COLLIDED, IMPORT_TX_OPTIONS, isWriteConflict } from "@/lib/import-shared";
import { isUniqueConstraintError, type ActionResultWith } from "./shared";

/**
 * Confirming a payroll-register import, and issuing WH-347 payroll numbers.
 *
 * GATE: MANAGE_COMPLIANCE, deliberately the same capability as the
 * certified-payroll pages this data exists to complete — NOT owner-only
 * like the three bulk importers beside it on /settings/import. Certified
 * payroll is the office manager's weekly chore; the register import is a
 * step of that chore, not company administration. An owner holds every
 * capability, so this refuses nobody the old page admitted.
 *
 * Same shape as lib/actions/spreadsheetImport.ts otherwise: the preview
 * writes nothing, the confirm re-plans from the raw text INSIDE a
 * Serializable transaction against a fresh read, and the browser's rows
 * are never trusted. Re-importing a period UPDATES the same rows
 * (@@unique per person+period), so a corrected register is safe to
 * import twice.
 */

export type RegisterImportSummary = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  last4Recorded: number;
  message: string;
};

type ImportResult = ActionResultWith<RegisterImportSummary>;

function fail(error: string): Extract<ImportResult, { ok: false }> {
  return { ok: false, error };
}

const NOT_YOUR_JOB_FUNCTION =
  "Certified payroll isn't part of your job function. The account owner sets who sees what, on the Team page.";

/** The mapping the preview's dropdowns chose, read back safely: only known
 * fields, only column indexes or null. Anything else is ignored rather
 * than trusted. */
function overridesFrom(formData: FormData): RegisterOverrides {
  const raw = formData.get("mapping");
  if (typeof raw !== "string" || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const overrides: RegisterOverrides = {};
  for (const field of REGISTER_FIELD_LIST) {
    const value = (parsed as Record<string, unknown>)[field];
    if (value === null) overrides[field as RegisterField] = null;
    else if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1000) {
      overrides[field as RegisterField] = value;
    }
  }
  return overrides;
}

export async function importPayrollRegister(formData: FormData): Promise<ImportResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(NOT_YOUR_JOB_FUNCTION);

  const text = String(formData.get("csv") ?? "");
  if (!text.trim()) return fail("Paste your payroll register, or choose a CSV file, before confirming.");
  if (importTooLarge(text)) return fail(TOO_LARGE_MESSAGE);
  const overrides = overridesFrom(formData);
  const companyId = context.company.id;

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const crew = await tx.crewMember.findMany({
        where: { companyId },
        select: {
          id: true,
          legalFirstName: true,
          legalMiddleName: true,
          legalLastName: true,
          employeeNumber: true,
          identifyingNumberLast4: true,
        },
      });
      const held = await tx.payrollRegisterEntry.findMany({
        where: { companyId },
        select: {
          crewMemberId: true,
          periodStart: true,
          periodEnd: true,
          grossCents: true,
          deductionsCents: true,
          netCents: true,
          hours: true,
          payDate: true,
        },
      });
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const plan = planPayrollRegisterImport(
        text,
        crew,
        held.map((entry) => ({
          crewMemberId: entry.crewMemberId,
          periodStart: iso(entry.periodStart),
          periodEnd: iso(entry.periodEnd),
          grossCents: entry.grossCents,
          deductionsCents: entry.deductionsCents,
          netCents: entry.netCents,
          hours: entry.hours === null ? null : String(entry.hours),
          payDate: entry.payDate ? iso(entry.payDate) : null,
        })),
        overrides,
      );

      if (plan.create.length > 0) {
        await tx.payrollRegisterEntry.createMany({
          data: plan.create.map((row) => ({
            companyId,
            crewMemberId: row.crewMemberId,
            periodStart: dateFromDay(row.periodStart),
            periodEnd: dateFromDay(row.periodEnd),
            payDate: row.payDate ? dateFromDay(row.payDate) : null,
            hours: row.hours,
            grossCents: row.grossCents,
            deductionsCents: row.deductionsCents,
            netCents: row.netCents,
            deductionsDetail: row.deductionsDetail ?? undefined,
            source: row.source,
          })),
        });
      }
      for (const row of plan.update) {
        await tx.payrollRegisterEntry.update({
          where: {
            crewMemberId_periodStart_periodEnd: {
              crewMemberId: row.crewMemberId,
              periodStart: dateFromDay(row.periodStart),
              periodEnd: dateFromDay(row.periodEnd),
            },
          },
          data: {
            payDate: row.payDate ? dateFromDay(row.payDate) : null,
            hours: row.hours,
            grossCents: row.grossCents,
            deductionsCents: row.deductionsCents,
            netCents: row.netCents,
            deductionsDetail: row.deductionsDetail ?? undefined,
            source: row.source,
          },
        });
      }
      // The one write outside PayrollRegisterEntry: a last-4 the register
      // carries for a crew member who has none recorded. NULL -> value is
      // the one direction the identity-lock trigger allows.
      let last4Recorded = 0;
      for (const row of [...plan.create, ...plan.update]) {
        if (!row.last4ToRecord) continue;
        await tx.crewMember.update({
          where: { id: row.crewMemberId, companyId },
          data: { identifyingNumberLast4: row.last4ToRecord },
        });
        last4Recorded += 1;
      }

      const parts = [
        plan.create.length > 0
          ? `Added ${plan.create.length} register ${plan.create.length === 1 ? "line" : "lines"}.`
          : "Nothing new to add.",
      ];
      if (plan.update.length > 0) parts.push(`${plan.update.length} updated.`);
      if (plan.unchanged.length > 0) parts.push(`${plan.unchanged.length} already here and unchanged.`);
      if (plan.problems.length > 0)
        parts.push(`${plan.problems.length} ${plan.problems.length === 1 ? "row was" : "rows were"} skipped — see the problems listed.`);
      if (last4Recorded > 0)
        parts.push(
          `Recorded the last 4 of the ID number for ${last4Recorded} crew ${last4Recorded === 1 ? "member" : "members"}.`,
        );
      return {
        created: plan.create.length,
        updated: plan.update.length,
        unchanged: plan.unchanged.length,
        skipped: plan.problems.length,
        last4Recorded,
        message: parts.join(" "),
      };
    }, IMPORT_TX_OPTIONS);

    revalidatePath("/settings/import");
    return { ok: true, value: summary };
  } catch (err) {
    if (isWriteConflict(err)) return fail(IMPORT_COLLIDED);
    if (isUniqueConstraintError(err)) {
      return fail(
        "Another import was saving the same periods at the same moment, so nothing from this one was saved. Check the preview and confirm again.",
      );
    }
    throw err;
  }
}

export type IssuedPayrollNumber = { number: number; alreadyIssued: boolean };

/**
 * Issue the WH-347 payroll number for one job's certified-payroll week.
 *
 * Explicit — a button on the filing view — and idempotent per week: the
 * first click issues the next number in the job's sequence, every later
 * click answers with the same number. Numbers are never reissued and never
 * deleted; there is deliberately no action that changes one.
 */
export async function issuePayrollNumber(
  formData: FormData,
): Promise<ActionResultWith<IssuedPayrollNumber>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) {
    return { ok: false, error: NOT_YOUR_JOB_FUNCTION };
  }
  const jobId = String(formData.get("jobId") ?? "");
  const weekStartRaw = String(formData.get("weekStart") ?? "");
  const parsed = new Date(`${weekStartRaw}T00:00:00.000Z`);
  if (!jobId || Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "That week couldn't be read. Reload the page and try again." };
  }
  const weekStart = certifiedPayrollWeekStart(parsed);

  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { companyId: true } });
  if (!job || job.companyId !== context.company.id) {
    return { ok: false, error: "That job isn't on this account." };
  }

  try {
    const issued = await prisma.$transaction(async (tx) => {
      const held = await tx.wh347PayrollNumber.findUnique({
        where: { jobId_weekStart: { jobId, weekStart } },
        select: { number: true },
      });
      if (held) return { number: held.number, alreadyIssued: true };
      const number = await issueWh347PayrollNumber(tx, jobId);
      await tx.wh347PayrollNumber.create({ data: { jobId, weekStart, number } });
      return { number, alreadyIssued: false };
    }, IMPORT_TX_OPTIONS);
    revalidatePath(`/jobs/${jobId}/certified-payroll/wh-347`);
    return { ok: true, value: issued };
  } catch (err) {
    // Two clicks racing on the same week: the unique on (jobId, weekStart)
    // settles it — read the winner back and answer with it.
    if (isUniqueConstraintError(err) || isWriteConflict(err)) {
      const winner = await prisma.wh347PayrollNumber.findUnique({
        where: { jobId_weekStart: { jobId, weekStart } },
        select: { number: true },
      });
      if (winner) {
        revalidatePath(`/jobs/${jobId}/certified-payroll/wh-347`);
        return { ok: true, value: { number: winner.number, alreadyIssued: true } };
      }
      return { ok: false, error: "Two clicks collided and neither landed. Reload the page and try once." };
    }
    throw err;
  }
}

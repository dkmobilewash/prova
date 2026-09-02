"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/** Failures are RETURNED — production redacts a thrown Server Action
 * message to a digest. `lib/actions/submittals.ts` is the reference. */

class InputError extends Error {}

const AUTHORITIES = ["FEDERAL", "STATE", "COUNTY", "CITY"] as const;
const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"] as const;

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

function enumFrom<T extends readonly string[]>(formData: FormData, key: string, allowed: T, label: string): T[number] {
  const raw = text(formData, key);
  if (!allowed.includes(raw as T[number])) throw new InputError(`${label} is required`);
  return raw as T[number];
}

/** UTC midnight, so comparing two dates compares calendar days. */
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

/**
 * An hours threshold.
 *
 * Empty means NO RULE RECORDED and stays null — the review reports that as
 * unchecked rather than assuming a figure. Zero is accepted and is
 * different: it means the premium applies from the first hour, which is
 * how a seventh-consecutive-day rule is usually written.
 */
function optionalHours(formData: FormData, key: string, label: string): string | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new InputError(`${label} must be a number`);
  if (value < 0) throw new InputError(`${label} can't be negative`);
  if (value > 24) throw new InputError(`${label} can't be more than 24 hours in a day`);
  return value.toFixed(2);
}

function optionalWeeklyHours(formData: FormData, key: string, label: string): string | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new InputError(`${label} must be a number`);
  if (value < 0) throw new InputError(`${label} can't be negative`);
  if (value > 168) throw new InputError(`${label} can't be more than 168 hours in a week`);
  return value.toFixed(2);
}

function optionalDays(formData: FormData, key: string, label: string): number | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new InputError(`${label} must be a whole number of days`);
  if (value < 0 || value > 365) throw new InputError(`${label} has to be between 0 and 365`);
  return value;
}

/** Only http(s): this string goes into an href, so a javascript: URL would
 * be an injection vector. Same rule as closeout document links. */
function optionalLink(formData: FormData, key: string, label: string): string | null {
  const raw = text(formData, key);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InputError(`${label} needs to be a full URL, starting with https://`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InputError(`${label} needs to start with https://`);
  }
  return parsed.toString();
}

/**
 * True for the database-level non-overlap constraint on rule sets.
 *
 * Prisma Client does not know that constraint exists — it is raw SQL in
 * the migration, because Prisma's DSL cannot express a Postgres exclusion
 * constraint. So a violation arrives as P2010 with the constraint name in
 * the message rather than as a typed error, exactly as
 * ARCHITECTURE.md warns for FringeRateSchedule. Matching on the constraint
 * name rather than the word "exclusion" keeps this from swallowing an
 * unrelated raw error and reporting the wrong cause.
 */
function isOverlapError(err: unknown): boolean {
  const message = typeof err === "object" && err !== null ? String((err as { message?: unknown }).message ?? "") : "";
  return message.includes("PrevailingWageRuleSet_no_overlapping_rules");
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    if (isOverlapError(err)) {
      return fail(
        "Another rule set already covers this jurisdiction over part of those dates. End that one first — two sets of rules in force at once would make a timesheet review depend on which row was read.",
      );
    }
    throw err;
  }
}

function ruleSetDataFrom(formData: FormData) {
  const effectiveFrom = requiredDate(formData, "effectiveFrom", "In force from");
  const effectiveTo = optionalDate(formData, "effectiveTo", "In force until");
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new InputError("The end date can't be before the start date");
  }

  return {
    name: required(formData, "name", "Name"),
    jurisdiction: required(formData, "jurisdiction", "Jurisdiction"),
    authority: enumFrom(formData, "authority", AUTHORITIES, "Authority"),
    dailyOvertimeAfterHours: optionalHours(formData, "dailyOvertimeAfterHours", "Daily overtime after"),
    dailyDoubleTimeAfterHours: optionalHours(formData, "dailyDoubleTimeAfterHours", "Daily double time after"),
    weeklyOvertimeAfterHours: optionalWeeklyHours(formData, "weeklyOvertimeAfterHours", "Weekly overtime after"),
    seventhDayOvertimeAfterHours: optionalHours(formData, "seventhDayOvertimeAfterHours", "Seventh-day overtime after"),
    seventhDayDoubleTimeAfterHours: optionalHours(
      formData,
      "seventhDayDoubleTimeAfterHours",
      "Seventh-day double time after",
    ),
    filingFrequency: enumFrom(formData, "filingFrequency", FREQUENCIES, "Filing frequency"),
    filingDueDays: optionalDays(formData, "filingDueDays", "Filing due"),
    formName: text(formData, "formName") || null,
    portalUrl: optionalLink(formData, "portalUrl", "Filing portal"),
    sourceUrl: optionalLink(formData, "sourceUrl", "Source"),
    note: text(formData, "note") || null,
    effectiveFrom,
    effectiveTo,
  };
}

export async function createPrevailingWageRuleSet(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    await prisma.prevailingWageRuleSet.create({
      data: { companyId: company.id, ...ruleSetDataFrom(formData) },
    });
    revalidatePath("/prevailing-wage");
    return ok;
  });
}

export async function updatePrevailingWageRuleSet(id: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const existing = await prisma.prevailingWageRuleSet.findUnique({ where: { id } });
    if (!existing || existing.companyId !== company.id) {
      return fail("Rule set not found");
    }

    await prisma.prevailingWageRuleSet.update({
      where: { id: existing.id },
      data: ruleSetDataFrom(formData),
    });
    revalidatePath("/prevailing-wage");
    return ok;
  });
}

/**
 * Deletes a rule set.
 *
 * Owner-only. The determinations pointing at it are NOT deleted — the FK
 * is ON DELETE SET NULL, so a job keeps its wage determination and simply
 * stops having rules attached. Cascading would destroy the wage document
 * itself, which is the one thing on that record that came from the
 * awarding body.
 */
export async function deletePrevailingWageRuleSet(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (context.role !== "OWNER") {
      return fail("Only the account owner can delete a prevailing wage rule set");
    }
    const existing = await prisma.prevailingWageRuleSet.findUnique({ where: { id } });
    if (!existing || existing.companyId !== context.company.id) {
      return fail("Rule set not found");
    }

    await prisma.prevailingWageRuleSet.delete({ where: { id: existing.id } });
    revalidatePath("/prevailing-wage");
    return ok;
  });
}

/** Attaches a rule set to a job's wage determination, or clears it.
 *
 * The determination is where this belongs: it is already the per-job
 * record saying "this job is prevailing wage in jurisdiction X", so
 * nothing new has to be joined and a job without one raises nothing. */
export async function setDeterminationRuleSet(
  determinationId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const determination = await prisma.prevailingWageDetermination.findUnique({
      where: { id: determinationId },
      include: { job: { select: { companyId: true } } },
    });
    if (!determination || determination.job.companyId !== company.id) {
      return fail("Wage determination not found");
    }

    const ruleSetId = text(formData, "ruleSetId");
    if (!ruleSetId) {
      await prisma.prevailingWageDetermination.update({
        where: { id: determination.id },
        data: { ruleSetId: null },
      });
      revalidatePath("/prevailing-wage");
      return ok;
    }

    const ruleSet = await prisma.prevailingWageRuleSet.findUnique({ where: { id: ruleSetId } });
    if (!ruleSet || ruleSet.companyId !== company.id) {
      return fail("Rule set not found");
    }

    await prisma.prevailingWageDetermination.update({
      where: { id: determination.id },
      data: { ruleSetId: ruleSet.id },
    });
    revalidatePath("/prevailing-wage");
    return ok;
  });
}

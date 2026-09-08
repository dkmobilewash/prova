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

/** Failures are RETURNED — production redacts a thrown Server Action
 * message to a digest. */

const TIERS = ["JOURNEYMAN", "APPRENTICE", "FOREMAN"] as const;

/**
 * Records whether a craft classification is journeyman-side or
 * apprentice-side.
 *
 * `CraftClassification` used to be a GLOBAL reference table shared by
 * every company working under the same local, gated only by holding a
 * self-asserted `CompanyUnionAgreement` — that sharing was #136 finding 1.
 * As of the companyId migration each company holds its own classification
 * row, so this is a direct ownership check now.
 */
export async function setCraftTier(craftId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const craft = await prisma.craftClassification.findFirst({
    where: { id: craftId, companyId: company.id },
  });
  if (!craft) {
    return fail("That classification isn't under a local you hold an agreement with");
  }

  const raw = String(formData.get("tier") ?? "").trim();
  const periodRaw = String(formData.get("apprenticePeriod") ?? "").trim();

  // Empty is a real value: nobody has said. The ratio check reports those
  // hours as unclassified rather than counting them as journeyman hours,
  // so clearing a tier makes a job read INCOMPLETE — never compliant.
  if (raw === "") {
    await prisma.craftClassification.update({
      where: { id: craft.id },
      data: { tier: null, apprenticePeriod: null },
    });
    revalidatePath("/union-compliance");
    return ok;
  }

  if (!TIERS.includes(raw as (typeof TIERS)[number])) {
    return fail("That isn't one of the classification tiers");
  }

  let apprenticePeriod: number | null = null;
  if (raw === "APPRENTICE" && periodRaw) {
    const value = Number(periodRaw);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      return fail("An apprentice period is a whole number between 1 and 10");
    }
    apprenticePeriod = value;
  }

  await prisma.craftClassification.update({
    where: { id: craft.id },
    // A period only means anything on an apprentice; moving a
    // classification to journeyman clears it rather than leaving a stale
    // "period 3" hanging off a journeyman row.
    data: { tier: raw as (typeof TIERS)[number], apprenticePeriod },
  });

  revalidatePath("/union-compliance");
  return ok;
}

/* ============================================================ setup CRUD */
/*
 * The data-entry half of /union-compliance.
 *
 * It was missing entirely: UnionLocal, CompanyUnionAgreement,
 * CraftClassification, FringeRateSchedule and ApprenticeRatioRule had no
 * create action anywhere in the app, so the remittance and ratio reports
 * built on top of them rendered empty on any real account and there was no
 * way in through the UI. The engines were verified against a database that
 * only a test could populate — which is the "a control that looks like it
 * works and cannot" shape this codebase keeps catching.
 *
 * UnionLocal, CraftClassification, FringeRateSchedule and
 * ApprenticeRatioRule were GLOBAL (not company-scoped) until the #136
 * finding 1 fix: the same real local applies to every contractor working
 * under it, so they were shared rows, gated only on holding a
 * CompanyUnionAgreement — which was self-asserted (createUnionLocalAndAgreement
 * adopted any existing local by name+number, both public information), so
 * typing a real union's details was enough to read another company's wage
 * rates and destructively edit its shared rows. All four now carry their
 * own companyId; each company records its own copy of the local it works
 * under, exactly like it records its own copy of a GC as a Contact.
 */

class SetupError extends Error {}

/** "1 time entry" / "2 time entries". This message is the one an
 * inspector-facing user reads carefully, and it read "1 time entries". */
function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function setupText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function setupRequired(formData: FormData, key: string, label: string) {
  const value = setupText(formData, key);
  if (!value) throw new SetupError(`${label} is required`);
  return value;
}

/** UTC midnight, so date comparisons are calendar-day comparisons. */
function setupDate(formData: FormData, key: string, label: string): Date | null {
  const raw = setupText(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new SetupError(`${label} is not a valid date`);
  return date;
}

function setupRequiredDate(formData: FormData, key: string, label: string): Date {
  const date = setupDate(formData, key, label);
  if (!date) throw new SetupError(`${label} is required`);
  return date;
}

/** A money rate. Empty means the fund is not contributed to, which is a
 * real state and different from zero being unknown — buildRemittanceReport
 * treats a missing rate as nothing owed to that fund. */
function setupRate(formData: FormData, key: string, label: string): string | null {
  const raw = setupText(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new SetupError(`${label} must be a number`);
  if (value < 0) throw new SetupError(`${label} can't be negative`);
  return value.toFixed(2);
}

function setupCount(formData: FormData, key: string, label: string): number {
  const raw = setupRequired(formData, key, label);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new SetupError(`${label} has to be a whole number between 1 and 99`);
  }
  return value;
}

/**
 * True for FringeRateSchedule's database-level non-overlap constraint.
 *
 * Prisma Client does not know that constraint exists — it is hand-written
 * raw SQL in 20260824171704 because Prisma's DSL cannot express a Postgres
 * exclusion constraint — so a violation arrives as an untyped P2010 with
 * the constraint name in the message. ARCHITECTURE.md warned that whatever
 * action eventually wrote to this table would have to catch and translate
 * it; this is that action. Matching the constraint NAME rather than the
 * word "exclusion" keeps it from swallowing an unrelated raw error.
 */
function isFringeOverlapError(err: unknown): boolean {
  const message =
    typeof err === "object" && err !== null ? String((err as { message?: unknown }).message ?? "") : "";
  return message.includes("FringeRateSchedule_no_overlapping_rates");
}

async function runSetup(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SetupError) return fail(err.message);
    if (isFringeOverlapError(err)) {
      return fail(
        "A rate schedule for this classification already covers part of those dates. End that one first — two rates in force at once would make a historical payroll depend on which row was read.",
      );
    }
    throw err;
  }
}

/** The local must be one this company owns. `UnionLocal.companyId` is a
 * direct ownership check as of the #136 fix — no join through the
 * agreement table needed, and no other company's local can ever match. */
async function assertLocalUnderAgreement(unionLocalId: string, companyId: string) {
  const local = await prisma.unionLocal.findFirst({
    where: { id: unionLocalId, companyId },
  });
  if (!local) throw new SetupError("That local isn't one you hold an agreement with");
  return local;
}

/**
 * Records a union local and this company's agreement with it, together.
 *
 * Together on purpose: a local with no agreement is invisible to the
 * company that just typed it in, which would read as the save having
 * failed.
 *
 * Each company holds its OWN UnionLocal row (companyId, parentInternational,
 * localNumber) as of #136 finding 1. It used to be a single global row
 * ADOPTED by whichever company typed the same name+number second — which is
 * exactly the vulnerability: an agreement with a global row was
 * self-asserted, so typing a real local's public name and number was
 * enough to gain access to another company's classifications and rate
 * schedules. Two companies signatory to the same real Carpenters Local 300
 * now each get their own row, the same way they each get their own Contact
 * row for a shared GC — a duplicate isn't a collision to resolve, it's the
 * correct shape.
 */
export async function createUnionLocalAndAgreement(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runSetup(async () => {
    const parentInternational = setupRequired(formData, "parentInternational", "International");
    const localNumber = setupRequired(formData, "localNumber", "Local number");
    const jurisdictionName = setupRequired(formData, "jurisdictionName", "Jurisdiction");
    const tradeJurisdiction = setupText(formData, "tradeJurisdiction") || null;
    const effectiveFrom = setupRequiredDate(formData, "effectiveFrom", "Agreement in force from");
    const effectiveTo = setupDate(formData, "effectiveTo", "Agreement in force until");
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new SetupError("The agreement's end date can't be before its start date");
    }

    await prisma.$transaction(async (tx) => {
      // Scoped to THIS company — re-recording the same local you already
      // hold (e.g. re-entering after ending a prior agreement) reuses your
      // own row rather than creating a second one.
      const existing = await tx.unionLocal.findFirst({
        where: { companyId: company.id, parentInternational, localNumber },
      });

      const local =
        existing ??
        (await tx.unionLocal.create({
          data: { companyId: company.id, parentInternational, localNumber, jurisdictionName, tradeJurisdiction },
        }));

      const alreadyAgreed = await tx.companyUnionAgreement.findFirst({
        where: { companyId: company.id, unionLocalId: local.id, effectiveTo: null },
      });
      if (alreadyAgreed) {
        throw new SetupError("You already hold a current agreement with that local");
      }

      await tx.companyUnionAgreement.create({
        data: { companyId: company.id, unionLocalId: local.id, effectiveFrom, effectiveTo },
      });
    });

    revalidatePath("/union-compliance");
    return ok;
  });
}

/** Ends an agreement rather than deleting it. The CBA was in force for
 * those years and the certified payroll filed under it says so; removing
 * the row would make that history unexplainable. */
export async function endUnionAgreement(agreementId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runSetup(async () => {
    const agreement = await prisma.companyUnionAgreement.findUnique({ where: { id: agreementId } });
    if (!agreement || agreement.companyId !== company.id) return fail("Agreement not found");

    const effectiveTo = setupRequiredDate(formData, "effectiveTo", "In force until");
    if (effectiveTo < agreement.effectiveFrom) {
      return fail("The agreement can't end before it started.");
    }

    await prisma.companyUnionAgreement.update({
      where: { id: agreement.id },
      data: { effectiveTo },
    });
    revalidatePath("/union-compliance");
    return ok;
  });
}

export async function createCraftClassification(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runSetup(async () => {
    const unionLocalId = setupRequired(formData, "unionLocalId", "Local");
    await assertLocalUnderAgreement(unionLocalId, company.id);
    const name = setupRequired(formData, "name", "Classification name");

    const tierRaw = setupText(formData, "tier");
    if (tierRaw && !TIERS.includes(tierRaw as (typeof TIERS)[number])) {
      return fail("That isn't one of the classification tiers");
    }
    let apprenticePeriod: number | null = null;
    const periodRaw = setupText(formData, "apprenticePeriod");
    if (tierRaw === "APPRENTICE" && periodRaw) {
      const value = Number(periodRaw);
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        return fail("An apprentice period is a whole number between 1 and 10");
      }
      apprenticePeriod = value;
    }

    try {
      await prisma.craftClassification.create({
        data: {
          companyId: company.id,
          unionLocalId,
          name,
          tier: (tierRaw || null) as (typeof TIERS)[number] | null,
          apprenticePeriod,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail(`"${name}" already exists under that local`);
      }
      throw err;
    }

    revalidatePath("/union-compliance");
    return ok;
  });
}

/**
 * Deletes a classification nothing has been logged against.
 *
 * Checked explicitly rather than left to the foreign key. The FK would
 * throw a raw Postgres error that production redacts to a digest, and the
 * person would be told nothing at all — whereas "12 time entries are
 * logged against it" tells them exactly why and what to do.
 *
 * SIMPLER THAN IT USED TO BE. Before the #136 companyId fix,
 * CraftClassification was a global row shared by every contractor
 * signatory to the same hall, so this guard had to count usage GLOBALLY —
 * scoping it to this company alone would have let one contractor delete a
 * classification another had already costed work against. Now that every
 * company holds its own classification row, that cross-company case is
 * structurally impossible: there is no other company's data to reach
 * through this row at all, so the usage check only ever needs to look at
 * this company's own records.
 */
export async function deleteCraftClassification(craftId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runSetup(async () => {
    if (context.role !== "OWNER") {
      return fail("Only the account owner can delete a craft classification");
    }
    const companyId = context.company.id;
    const craft = await prisma.craftClassification.findFirst({
      where: { id: craftId, companyId },
    });
    if (!craft) return fail("That classification isn't under a local you hold an agreement with");

    const [timeEntries, lineItems, catalogEntries, dispatchSlips] = await Promise.all([
      prisma.timeEntry.count({
        where: { craftClassificationId: craft.id, job: { companyId } },
      }),
      prisma.jobLineItem.count({
        where: { craftClassificationId: craft.id, job: { companyId } },
      }),
      prisma.lineItemCatalogEntry.count({
        where: { craftClassificationId: craft.id, companyId },
      }),
      prisma.dispatchSlip.count({
        where: { craftClassificationId: craft.id, job: { companyId } },
      }),
    ]);
    const used = timeEntries + lineItems + catalogEntries + dispatchSlips;
    if (used > 0) {
      return fail(
        `${used} of your records ${used === 1 ? "is" : "are"} tagged with this classification (${plural(timeEntries, "time entry", "time entries")}, ${plural(lineItems, "line item", "line items")}, ${plural(catalogEntries, "catalog entry", "catalog entries")}, ${plural(dispatchSlips, "dispatch slip", "dispatch slips")}). Deleting it would strip the craft off work that has already been costed.`,
      );
    }

    // Rate schedules belong to the classification and mean nothing without
    // it, so they go with it. Nothing else references them.
    await prisma.$transaction([
      prisma.fringeRateSchedule.deleteMany({ where: { craftClassificationId: craft.id } }),
      prisma.craftClassification.delete({ where: { id: craft.id } }),
    ]);

    revalidatePath("/union-compliance");
    return ok;
  });
}

/**
 * Sets the apprentice ratio for a local — replacing any existing rule
 * rather than adding a second.
 *
 * The schema permits several rows per local, and lib/union-compliance-query.ts
 * builds a Map keyed on unionLocalId, so a second rule would silently
 * decide the ratio by whichever row happened to sort last. A ratio check
 * whose answer depends on row order is worse than no ratio check. One rule
 * per local is enforced here, and the query orders deterministically as
 * well.
 *
 * The `deleteMany` below is exactly the destructive path #136 finding 1
 * named directly: with a global UnionLocal, this wiped whichever company
 * last held a self-asserted agreement's rule, with no ownership check at
 * all. Scoping both the delete and the create to `companyId` closes it —
 * `unionLocalId` alone now already resolves to one company, but this
 * checks its own column directly rather than relying on that indirectly.
 */
export async function setApprenticeRatioRule(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runSetup(async () => {
    const unionLocalId = setupRequired(formData, "unionLocalId", "Local");
    await assertLocalUnderAgreement(unionLocalId, company.id);

    const apprenticeCount = setupCount(formData, "apprenticeCount", "Apprentices");
    const journeymenCount = setupCount(formData, "journeymenCount", "Journeymen");
    const programStandardReference = setupText(formData, "programStandardReference") || null;

    await prisma.$transaction(async (tx) => {
      await tx.apprenticeRatioRule.deleteMany({ where: { unionLocalId, companyId: company.id } });
      await tx.apprenticeRatioRule.create({
        data: { companyId: company.id, unionLocalId, apprenticeCount, journeymenCount, programStandardReference },
      });
    });

    revalidatePath("/union-compliance");
    return ok;
  });
}

export async function createFringeRateSchedule(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runSetup(async () => {
    const craftClassificationId = setupRequired(formData, "craftClassificationId", "Classification");
    const craft = await prisma.craftClassification.findFirst({
      where: { id: craftClassificationId, companyId: company.id },
    });
    if (!craft) return fail("That classification isn't under a local you hold an agreement with");

    const baseWage = setupRate(formData, "baseWage", "Base wage");
    if (baseWage === null) throw new SetupError("Base wage is required");

    const effectiveFrom = setupRequiredDate(formData, "effectiveFrom", "In force from");
    const effectiveTo = setupDate(formData, "effectiveTo", "In force until");
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return fail("The end date can't be before the start date.");
    }

    await prisma.fringeRateSchedule.create({
      data: {
        companyId: company.id,
        craftClassificationId: craft.id,
        baseWage,
        pensionRate: setupRate(formData, "pensionRate", "Pension"),
        vacationRate: setupRate(formData, "vacationRate", "Vacation"),
        healthWelfareRate: setupRate(formData, "healthWelfareRate", "Health & welfare"),
        trainingRate: setupRate(formData, "trainingRate", "Training"),
        effectiveFrom,
        effectiveTo,
      },
    });

    revalidatePath("/union-compliance");
    return ok;
  });
}

/** Ends a rate schedule, which is what makes room for the next one. The
 * old rate stays: certified payroll and remittances already filed under it
 * have to keep computing to the same figures. */
export async function endFringeRateSchedule(scheduleId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runSetup(async () => {
    const schedule = await prisma.fringeRateSchedule.findFirst({
      where: { id: scheduleId, companyId: company.id },
    });
    if (!schedule) return fail("Rate schedule not found");

    const effectiveTo = setupRequiredDate(formData, "effectiveTo", "In force until");
    if (effectiveTo < schedule.effectiveFrom) {
      return fail("A rate can't end before it started.");
    }

    await prisma.fringeRateSchedule.update({ where: { id: schedule.id }, data: { effectiveTo } });
    revalidatePath("/union-compliance");
    return ok;
  });
}

/**
 * #136 finding 1's other named destructive path — this used to reach any
 * company's shared rate schedule by holding a self-asserted agreement with
 * a global local, with no ownership check and no usage check either. Now
 * scoped directly to `companyId`, a company can only ever delete its own
 * schedule; the cross-tenant reach is gone.
 *
 * NOT ALSO GIVEN A USAGE CHECK here, unlike deleteCraftClassification —
 * FringeRateSchedule has no stored foreign key from TimeEntry (the
 * effective rate is looked up live by date range, never persisted onto a
 * row), so there is no cheap, honest count of "how much of your own
 * certified payroll depends on this" to quote back. `endFringeRateSchedule`
 * above is the intended way to retire a schedule without disturbing
 * history; this stays a plain, OWNER-gated delete for correcting a genuine
 * data-entry mistake. Filed as a follow-up rather than guessed at here.
 */
export async function deleteFringeRateSchedule(scheduleId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runSetup(async () => {
    if (context.role !== "OWNER") {
      return fail("Only the account owner can delete a rate schedule");
    }
    const schedule = await prisma.fringeRateSchedule.findFirst({
      where: { id: scheduleId, companyId: context.company.id },
    });
    if (!schedule) return fail("Rate schedule not found");

    await prisma.fringeRateSchedule.delete({ where: { id: schedule.id } });
    revalidatePath("/union-compliance");
    return ok;
  });
}

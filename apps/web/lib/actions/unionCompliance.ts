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
 * `CraftClassification` is a GLOBAL reference table, so this edit is
 * visible to every company working under the same local. That is
 * deliberate and correct: whether "Drywall Finisher Apprentice Period 3"
 * is an apprentice classification is a fact about the classification, not
 * an opinion one company holds about it — the same reasoning that makes
 * `name` global. Access is gated by the company actually holding an
 * agreement with that local, which is the same join
 * craftClassificationIdFromForm already uses as its access check.
 */
export async function setCraftTier(craftId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  const craft = await prisma.craftClassification.findFirst({
    where: { id: craftId, unionLocal: { companyAgreements: { some: { companyId: company.id } } } },
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
 * Three of these tables are GLOBAL (not company-scoped): UnionLocal,
 * CraftClassification and ApprenticeRatioRule describe the union, not the
 * company, and the same local applies to every contractor working under
 * it. Access is therefore gated on holding a CompanyUnionAgreement with
 * the local, which is the same join craftClassificationIdFromForm already
 * uses as its access check.
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

/** The local must be one this company holds an agreement with. That join
 * IS the access check for these global tables. */
async function assertLocalUnderAgreement(unionLocalId: string, companyId: string) {
  const local = await prisma.unionLocal.findFirst({
    where: { id: unionLocalId, companyAgreements: { some: { companyId } } },
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
 * If the local already exists globally — another contractor under the same
 * hall recorded it first — it is ADOPTED rather than rejected. The unique
 * key is (parentInternational, localNumber), and two companies working
 * under Carpenters Local 300 are working under the same real local. A
 * duplicate-key error here would be the app telling someone a true fact is
 * already taken.
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
      const existing = await tx.unionLocal.findUnique({
        where: { parentInternational_localNumber: { parentInternational, localNumber } },
      });

      const local =
        existing ??
        (await tx.unionLocal.create({
          data: { parentInternational, localNumber, jurisdictionName, tradeJurisdiction },
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
 */
export async function deleteCraftClassification(craftId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runSetup(async () => {
    if (context.role !== "OWNER") {
      return fail("Only the account owner can delete a craft classification");
    }
    const craft = await prisma.craftClassification.findFirst({
      where: {
        id: craftId,
        unionLocal: { companyAgreements: { some: { companyId: context.company.id } } },
      },
    });
    if (!craft) return fail("That classification isn't under a local you hold an agreement with");

    const [timeEntries, lineItems, catalogEntries, dispatchSlips] = await Promise.all([
      prisma.timeEntry.count({ where: { craftClassificationId: craft.id } }),
      prisma.jobLineItem.count({ where: { craftClassificationId: craft.id } }),
      prisma.lineItemCatalogEntry.count({ where: { craftClassificationId: craft.id } }),
      prisma.dispatchSlip.count({ where: { craftClassificationId: craft.id } }),
    ]);
    const used = timeEntries + lineItems + catalogEntries + dispatchSlips;
    if (used > 0) {
      return fail(
        `${used} record${used === 1 ? " is" : "s are"} tagged with this classification (${plural(timeEntries, "time entry", "time entries")}, ${plural(lineItems, "line item", "line items")}, ${plural(catalogEntries, "catalog entry", "catalog entries")}, ${plural(dispatchSlips, "dispatch slip", "dispatch slips")}). Deleting it would strip the craft off work that has already been costed.`,
      );
    }

    // The classification is GLOBAL and the rates hanging off it are not.
    // This deleteMany was scoped by the classification alone, so deleting
    // a classification under a shared hall took ANOTHER CONTRACTOR'S rate
    // schedules with it (issue #136). Refused rather than scoped-and-
    // proceeded: the classification itself is shared too, so removing it
    // while someone else is still pricing work against it is not ours to
    // do. The count is deliberately all that is said about their rows.
    // `{ companyId: null }` is spelled out alongside the inequality on
    // purpose. In SQL `companyId <> 'x'` is NULL — not true — for a NULL
    // row, so an inequality alone would miss exactly the unattributed
    // rows the migration's backfill leaves behind. Missing them would let
    // the delete proceed and then fail on the foreign key, which
    // production redacts to a digest: the person would be told nothing.
    const othersRates = await prisma.fringeRateSchedule.count({
      where: {
        craftClassificationId: craft.id,
        OR: [{ companyId: null }, { companyId: { not: context.company.id } }],
      },
    });
    if (othersRates > 0) {
      return fail(
        `${plural(othersRates, "rate schedule is", "rate schedules are")} recorded against this classification and not attributed to you. Classifications are shared with every contractor under this local, so deleting it would take those rates with it.`,
      );
    }

    // Your own rate schedules belong to the classification and mean
    // nothing without it, so they go with it. Nothing else references them.
    await prisma.$transaction([
      prisma.fringeRateSchedule.deleteMany({
        where: { craftClassificationId: craft.id, companyId: context.company.id },
      }),
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
 */
export async function setApprenticeRatioRule(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runSetup(async () => {
    const unionLocalId = setupRequired(formData, "unionLocalId", "Local");
    await assertLocalUnderAgreement(unionLocalId, company.id);

    const apprenticeCount = setupCount(formData, "apprenticeCount", "Apprentices");
    const journeymenCount = setupCount(formData, "journeymenCount", "Journeymen");
    const programStandardReference = setupText(formData, "programStandardReference") || null;

    // BOTH halves carry companyId. The deleteMany was scoped by the local
    // alone, and the local is GLOBAL — so setting your own ratio under a
    // hall you share with another contractor DELETED THEIR RULE, silently,
    // as a side effect of saving yours (issue #136). "One rule per local"
    // was always meant to be one rule per local PER COMPANY; there was no
    // column to say so until now.
    await prisma.$transaction(async (tx) => {
      await tx.apprenticeRatioRule.deleteMany({
        where: { unionLocalId },
      });
      await tx.apprenticeRatioRule.create({
        data: {
          unionLocalId,
          companyId: company.id,
          apprenticeCount,
          journeymenCount,
          programStandardReference,
        },
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
      where: {
        id: craftClassificationId,
        unionLocal: { companyAgreements: { some: { companyId: company.id } } },
      },
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
        craftClassificationId: craft.id,
        // Whose rates these are. The classification is global; this is
        // not. Without it the row is an orphan nobody can read back.
        companyId: company.id,
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
    // `companyId`, not the agreement join. The join reached through a
    // GLOBAL classification and local, so it matched every rate schedule
    // under a shared hall — this action could end another contractor's
    // rate (issue #136). A NULL-companyId orphan matches nobody, which is
    // the intended failure: it cannot be edited by the wrong person.
    const schedule = await prisma.fringeRateSchedule.findFirst({
      where: { id: scheduleId, craftClassification: { unionLocal: { companyAgreements: { some: { companyId: company.id } } } } },
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

export async function deleteFringeRateSchedule(scheduleId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runSetup(async () => {
    if (context.role !== "OWNER") {
      return fail("Only the account owner can delete a rate schedule");
    }
    // The destructive half of the same leak. Scoped by the agreement join
    // this DELETED another contractor's rate schedule outright, from a
    // page that had just shown it to you as though it were yours.
    const schedule = await prisma.fringeRateSchedule.findFirst({
      where: { id: scheduleId, craftClassification: { unionLocal: { companyAgreements: { some: { companyId: context.company.id } } } } },
    });
    if (!schedule) return fail("Rate schedule not found");

    await prisma.fringeRateSchedule.delete({ where: { id: schedule.id } });
    revalidatePath("/union-compliance");
    return ok;
  });
}

import { prisma } from "@prova/db";
import {
  reviewRatioByDay,
  summarizeRatio,
  type CraftTier,
  type DayRatio,
  type RatioEntryInput,
  type RatioRuleInput,
  type RatioSummary,
} from "@/lib/apprentice-ratio";
import {
  buildRemittanceReport,
  periodIsFiled,
  type RemittanceReport,
} from "@/lib/fringe-remittance";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";

/**
 * Fetching and normalising for the union compliance page.
 *
 * Fetches here, decides in lib/apprentice-ratio.ts and
 * lib/fringe-remittance.ts. Same split as every other pair in this
 * codebase, for the same reason: the deciding half is where the bugs live
 * and has to be testable without a database.
 */

const iso = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);
const numberOrNull = (value: unknown) => (value == null ? null : Number(value));

/** First and last day of a yyyy-mm month, as ISO dates. */
export function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1));
  const end = new Date(Date.UTC(year, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export type CraftRow = {
  id: string;
  name: string;
  tier: CraftTier | null;
  apprenticePeriod: number | null;
  unionLocalId: string;
  unionLocalLabel: string;
};

/**
 * Craft classifications for the locals this company actually works under.
 *
 * CraftClassification carries no companyId — it is a global reference
 * table — so this join IS the access check, the same one
 * craftClassificationIdFromForm in lib/actions/shared.ts already uses.
 */
export async function loadCrafts(companyId: string): Promise<CraftRow[]> {
  const crafts = await prisma.craftClassification.findMany({
    where: { unionLocal: { companyAgreements: { some: { companyId } } } },
    include: { unionLocal: true },
    orderBy: [{ unionLocalId: "asc" }, { name: "asc" }],
  });

  return crafts.map((craft) => ({
    id: craft.id,
    name: craft.name,
    tier: (craft.tier as CraftTier | null) ?? null,
    apprenticePeriod: craft.apprenticePeriod,
    unionLocalId: craft.unionLocalId,
    unionLocalLabel: localLabel(craft.unionLocal),
  }));
}

/** "Local 300 — Carpenters, Northern California". Built from the fields
 * UnionLocal actually has, in one place, so every section of the page
 * names the same local the same way. */
function localLabel(
  local: {
    localNumber: string;
    parentInternational: string;
    jurisdictionName: string;
  } | null,
): string {
  if (!local) return "Unnamed local";
  const head = [local.parentInternational, `Local ${local.localNumber}`].filter(Boolean).join(" ");
  return local.jurisdictionName ? `${head} — ${local.jurisdictionName}` : head || "Unnamed local";
}

export async function loadRemittance(companyId: string, month: string): Promise<
  RemittanceReport & { filed: boolean }
> {
  const { start, end } = monthBounds(month);

  const entries = await prisma.timeEntry.findMany({
    where: {
      job: { companyId },
      date: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T00:00:00.000Z`) },
    },
    select: {
      date: true,
      hours: true,
      craftClassificationId: true,
      craftClassification: { select: { name: true, unionLocalId: true, unionLocal: true } },
      employeeUser: { select: { name: true, email: true } },
      job: { select: { name: true } },
    },
  });

  const craftIds = [...new Set(entries.map((e) => e.craftClassificationId).filter(Boolean))] as string[];
  const schedules = await prisma.fringeRateSchedule.findMany({
    where: { craftClassificationId: { in: craftIds } },
    orderBy: { effectiveFrom: "desc" },
  });

  const byCraft = new Map<string, FringeRateScheduleInput[]>();
  for (const s of schedules) {
    const list = byCraft.get(s.craftClassificationId) ?? [];
    list.push({
      baseWage: Number(s.baseWage),
      pensionRate: numberOrNull(s.pensionRate),
      vacationRate: numberOrNull(s.vacationRate),
      healthWelfareRate: numberOrNull(s.healthWelfareRate),
      trainingRate: numberOrNull(s.trainingRate),
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
    });
    byCraft.set(s.craftClassificationId, list);
  }

  const report = buildRemittanceReport(
    entries.map((e) => ({
      date: e.date,
      hours: Number(e.hours),
      craftClassificationId: e.craftClassificationId,
      craftLabel: e.craftClassification?.name ?? null,
      unionLocalId: e.craftClassification?.unionLocalId ?? null,
      unionLocalLabel: e.craftClassification ? localLabel(e.craftClassification.unionLocal) : null,
      employeeName: e.employeeUser.name ?? e.employeeUser.email,
      jobName: e.job.name,
    })),
    byCraft,
    start,
    end,
  );

  const filings = await prisma.complianceDocument.findMany({
    where: { companyId, type: "UNION_FRINGE_BENEFIT_FILING" },
    select: { periodStart: true, periodEnd: true },
  });

  return {
    ...report,
    filed: periodIsFiled(
      filings.map((f) => ({ periodStart: iso(f.periodStart), periodEnd: iso(f.periodEnd) })),
      start,
      end,
    ),
  };
}

export type JobRatioReview = {
  jobId: string;
  jobName: string;
  unionLocalId: string;
  unionLocalLabel: string;
  rule: RatioRuleInput | null;
  days: DayRatio[];
  summary: RatioSummary;
};

/**
 * The ratio for every job with hours in a month, per union local.
 *
 * Per local because the rule is per local. Hours logged against a craft
 * with no classification at all cannot be attributed to any local, so they
 * are folded into EVERY local's review as unclassified — a day cannot
 * honestly be certified compliant while somebody on site is unaccounted
 * for. On a job running two locals that means both reviews read
 * INCOMPLETE, which is the conservative answer and the correct one: the
 * fix is to tag the entry, not to pick a local for it.
 */
export async function loadRatioReviews(companyId: string, month: string): Promise<JobRatioReview[]> {
  const { start, end } = monthBounds(month);

  const entries = await prisma.timeEntry.findMany({
    where: {
      job: { companyId },
      date: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T00:00:00.000Z`) },
    },
    select: {
      date: true,
      hours: true,
      jobId: true,
      job: { select: { name: true } },
      craftClassification: {
        select: { tier: true, unionLocalId: true, unionLocal: true },
      },
      employeeUser: { select: { name: true, email: true } },
    },
  });

  // Ordered oldest first so the Map below ends up holding the NEWEST rule
  // for each local. The schema permits several rows per local and this Map
  // keys on unionLocalId, so without an explicit order the ratio would be
  // decided by whichever row the database happened to return last — an
  // answer that could change between reads with nothing to explain it.
  // setApprenticeRatioRule now replaces rather than adds, so in practice
  // there is one; this makes the read safe regardless.
  const rules = await prisma.apprenticeRatioRule.findMany({
    where: { unionLocal: { companyAgreements: { some: { companyId } } } },
    orderBy: { createdAt: "asc" },
  });
  const ruleByLocal = new Map<string, RatioRuleInput>(
    rules.map((r) => [
      r.unionLocalId,
      {
        apprenticeCount: r.apprenticeCount,
        journeymenCount: r.journeymenCount,
        programStandardReference: r.programStandardReference,
      },
    ]),
  );

  type LocalBucket = { label: string; entries: RatioEntryInput[] };
  type Bucket = { jobName: string; locals: Map<string, LocalBucket>; untagged: RatioEntryInput[] };
  const jobs = new Map<string, Bucket>();

  for (const e of entries) {
    const bucket = jobs.get(e.jobId) ?? { jobName: e.job.name, locals: new Map<string, LocalBucket>(), untagged: [] };
    const row: RatioEntryInput = {
      date: iso(e.date) as string,
      hours: Number(e.hours),
      tier: (e.craftClassification?.tier as CraftTier | null) ?? null,
      employeeName: e.employeeUser.name ?? e.employeeUser.email,
    };

    if (e.craftClassification) {
      const localId = e.craftClassification.unionLocalId;
      const local = bucket.locals.get(localId) ?? {
        label: localLabel(e.craftClassification.unionLocal),
        entries: [],
      };
      local.entries.push(row);
      bucket.locals.set(localId, local);
    } else {
      bucket.untagged.push(row);
    }
    jobs.set(e.jobId, bucket);
  }

  const reviews: JobRatioReview[] = [];
  for (const [jobId, bucket] of jobs) {
    for (const [unionLocalId, local] of bucket.locals) {
      const days = reviewRatioByDay(
        [...local.entries, ...bucket.untagged],
        ruleByLocal.get(unionLocalId) ?? null,
      );
      reviews.push({
        jobId,
        jobName: bucket.jobName,
        unionLocalId,
        unionLocalLabel: local.label,
        rule: ruleByLocal.get(unionLocalId) ?? null,
        days,
        summary: summarizeRatio(days),
      });
    }
  }

  return reviews.sort(
    (a, b) => b.summary.daysOver - a.summary.daysOver || a.jobName.localeCompare(b.jobName),
  );
}

export type FringeScheduleRow = {
  id: string;
  baseWage: number;
  pensionRate: number | null;
  vacationRate: number | null;
  healthWelfareRate: number | null;
  trainingRate: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type SetupCraftRow = CraftRow & {
  schedules: FringeScheduleRow[];
  /** Records tagged with this craft. Deleting it is refused when non-zero,
   * and the count is what makes that refusal explain itself. */
  usageCount: number;
};

export type SetupLocalRow = {
  unionLocalId: string;
  label: string;
  parentInternational: string;
  localNumber: string;
  jurisdictionName: string;
  tradeJurisdiction: string | null;
  agreementId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  ratio: { apprenticeCount: number; journeymenCount: number; programStandardReference: string | null } | null;
  crafts: SetupCraftRow[];
};

/**
 * Everything behind the setup section: the locals this company holds an
 * agreement with, and under each one its ratio rule, classifications and
 * their rate schedules.
 *
 * Driven from the AGREEMENT rather than from UnionLocal, because the local
 * table is global — listing locals directly would show this company every
 * hall every other contractor has ever recorded.
 */
export async function loadUnionSetup(companyId: string): Promise<SetupLocalRow[]> {
  const agreements = await prisma.companyUnionAgreement.findMany({
    where: { companyId },
    orderBy: { effectiveFrom: "desc" },
    include: {
      unionLocal: {
        include: {
          apprenticeRatioRules: { orderBy: { createdAt: "desc" }, take: 1 },
          craftClassifications: {
            orderBy: { name: "asc" },
            include: {
              fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } },
              _count: {
                select: {
                  timeEntries: true,
                  jobLineItems: true,
                  catalogEntries: true,
                  dispatchSlips: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return agreements.map((agreement) => {
    const local = agreement.unionLocal;
    const rule = local.apprenticeRatioRules[0] ?? null;

    return {
      unionLocalId: local.id,
      label: localLabel(local),
      parentInternational: local.parentInternational,
      localNumber: local.localNumber,
      jurisdictionName: local.jurisdictionName,
      tradeJurisdiction: local.tradeJurisdiction,
      agreementId: agreement.id,
      effectiveFrom: iso(agreement.effectiveFrom) as string,
      effectiveTo: iso(agreement.effectiveTo),
      ratio: rule
        ? {
            apprenticeCount: rule.apprenticeCount,
            journeymenCount: rule.journeymenCount,
            programStandardReference: rule.programStandardReference,
          }
        : null,
      crafts: local.craftClassifications.map((craft) => ({
        id: craft.id,
        name: craft.name,
        tier: (craft.tier as CraftTier | null) ?? null,
        apprenticePeriod: craft.apprenticePeriod,
        unionLocalId: craft.unionLocalId,
        unionLocalLabel: localLabel(local),
        usageCount:
          craft._count.timeEntries +
          craft._count.jobLineItems +
          craft._count.catalogEntries +
          craft._count.dispatchSlips,
        schedules: craft.fringeRateSchedules.map((schedule) => ({
          id: schedule.id,
          baseWage: Number(schedule.baseWage),
          pensionRate: numberOrNull(schedule.pensionRate),
          vacationRate: numberOrNull(schedule.vacationRate),
          healthWelfareRate: numberOrNull(schedule.healthWelfareRate),
          trainingRate: numberOrNull(schedule.trainingRate),
          effectiveFrom: iso(schedule.effectiveFrom) as string,
          effectiveTo: iso(schedule.effectiveTo),
        })),
      })),
    };
  });
}

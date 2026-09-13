import { prisma } from "@prova/db";
import {
  findEffectiveRuleSet,
  reviewDays,
  type DayEntryInput,
  type PayType,
  type PrevailingWageRuleSetInput,
  type WeekReview,
} from "@/lib/prevailing-wage";
import { weekStart } from "@/components/fieldReportWeeks";
import { payrollWorkerName } from "@/lib/worker-name";

/**
 * Fetching and normalising for the prevailing wage page.
 *
 * This module fetches; lib/prevailing-wage.ts decides. Same split as
 * renewals.ts/compliance-expiry.ts and alerts-query.ts/alerts.ts, and for
 * the same reason: the deciding half is where the bugs live and it has to
 * be testable without a database.
 */

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

const numberOrNull = (value: unknown) => (value == null ? null : Number(value));

export type RuleSetRow = PrevailingWageRuleSetInput & {
  authority: string;
  filingFrequency: string;
  formName: string | null;
  portalUrl: string | null;
  sourceUrl: string | null;
  note: string | null;
  /** Jobs whose wage determination points at this rule set. */
  jobNames: string[];
};

export async function loadRuleSets(companyId: string): Promise<RuleSetRow[]> {
  const rows = await prisma.prevailingWageRuleSet.findMany({
    where: { companyId },
    orderBy: [{ jurisdiction: "asc" }, { effectiveFrom: "desc" }],
    include: { determinations: { select: { job: { select: { name: true } } } } },
  });

  return rows.map((rs) => ({
    id: rs.id,
    name: rs.name,
    jurisdiction: rs.jurisdiction,
    authority: rs.authority as string,
    dailyOvertimeAfterHours: numberOrNull(rs.dailyOvertimeAfterHours),
    dailyDoubleTimeAfterHours: numberOrNull(rs.dailyDoubleTimeAfterHours),
    weeklyOvertimeAfterHours: numberOrNull(rs.weeklyOvertimeAfterHours),
    seventhDayOvertimeAfterHours: numberOrNull(rs.seventhDayOvertimeAfterHours),
    seventhDayDoubleTimeAfterHours: numberOrNull(rs.seventhDayDoubleTimeAfterHours),
    filingFrequency: rs.filingFrequency as string,
    filingDueDays: rs.filingDueDays,
    formName: rs.formName,
    portalUrl: rs.portalUrl,
    sourceUrl: rs.sourceUrl,
    note: rs.note,
    effectiveFrom: isoDate(rs.effectiveFrom) as string,
    effectiveTo: isoDate(rs.effectiveTo),
    jobNames: rs.determinations.map((d) => d.job.name),
  }));
}

export type DeterminationRow = {
  id: string;
  jobId: string;
  jobName: string;
  jurisdiction: string;
  ruleSetId: string | null;
  ruleSetName: string | null;
};

export async function loadDeterminations(companyId: string): Promise<DeterminationRow[]> {
  const rows = await prisma.prevailingWageDetermination.findMany({
    where: { job: { companyId } },
    orderBy: { createdAt: "desc" },
    include: {
      job: { select: { id: true, name: true } },
      ruleSet: { select: { id: true, name: true } },
    },
  });

  return rows.map((d) => ({
    id: d.id,
    jobId: d.job.id,
    jobName: d.job.name,
    jurisdiction: d.jurisdiction,
    ruleSetId: d.ruleSet?.id ?? null,
    ruleSetName: d.ruleSet?.name ?? null,
  }));
}

export type WeekOption = { weekStart: string; jobId: string; jobName: string; totalHours: number };

/**
 * Weeks with hours logged on jobs that carry a wage determination.
 *
 * Only those jobs. A week on private work has nothing to review against —
 * the same gate the certified-payroll alert uses, and for the same reason:
 * offering to review every week would bury the ones that matter.
 */
export async function loadReviewableWeeks(companyId: string): Promise<WeekOption[]> {
  const entries = await prisma.timeEntry.findMany({
    where: { job: { companyId, prevailingWageDeterminations: { some: {} } } },
    select: { date: true, hours: true, jobId: true, job: { select: { name: true } } },
  });

  const weeks = new Map<string, WeekOption>();
  for (const entry of entries) {
    const start = weekStart(isoDate(entry.date) as string);
    const key = `${entry.jobId}::${start}`;
    const existing = weeks.get(key);
    if (existing) {
      existing.totalHours += Number(entry.hours);
    } else {
      weeks.set(key, {
        weekStart: start,
        jobId: entry.jobId,
        jobName: entry.job.name,
        totalHours: Number(entry.hours),
      });
    }
  }

  return [...weeks.values()].sort(
    (a, b) => b.weekStart.localeCompare(a.weekStart) || a.jobName.localeCompare(b.jobName),
  );
}

export type EmployeeWeekReview = {
  employeeUserId: string;
  employeeName: string;
  review: WeekReview;
};

/**
 * One job-week, reviewed per employee.
 *
 * Per employee rather than per job, because overtime is a property of one
 * person's day. Two people each working eight hours is not a sixteen-hour
 * day, and pooling them would manufacture overtime that nobody worked —
 * the single most damaging thing this feature could get wrong.
 */
function toRuleSetInput(raw: {
  id: string;
  name: string;
  jurisdiction: string;
  dailyOvertimeAfterHours: unknown;
  dailyDoubleTimeAfterHours: unknown;
  weeklyOvertimeAfterHours: unknown;
  seventhDayOvertimeAfterHours: unknown;
  seventhDayDoubleTimeAfterHours: unknown;
  filingDueDays: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}): PrevailingWageRuleSetInput {
  return {
    id: raw.id,
    name: raw.name,
    jurisdiction: raw.jurisdiction,
    dailyOvertimeAfterHours: numberOrNull(raw.dailyOvertimeAfterHours),
    dailyDoubleTimeAfterHours: numberOrNull(raw.dailyDoubleTimeAfterHours),
    weeklyOvertimeAfterHours: numberOrNull(raw.weeklyOvertimeAfterHours),
    seventhDayOvertimeAfterHours: numberOrNull(raw.seventhDayOvertimeAfterHours),
    seventhDayDoubleTimeAfterHours: numberOrNull(raw.seventhDayDoubleTimeAfterHours),
    filingDueDays: raw.filingDueDays,
    effectiveFrom: isoDate(raw.effectiveFrom) as string,
    effectiveTo: isoDate(raw.effectiveTo),
  };
}

export async function reviewJobWeek(
  companyId: string,
  jobId: string,
  weekStartIso: string,
): Promise<{ jobName: string | null; ruleSetName: string | null; employees: EmployeeWeekReview[] }> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      name: true,
      prevailingWageDeterminations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { jurisdiction: true, ruleSet: true },
      },
    },
  });
  if (!job) return { jobName: null, ruleSetName: null, employees: [] };

  // #104 finding 5: findEffectiveRuleSet existed, was documented, and had
  // zero call sites. This used to trust the determination's `ruleSetId`
  // FK directly — a single snapshot a person points at whatever rule set
  // is CURRENT when they call setDeterminationRuleSet. When a jurisdiction
  // updates its rates, the company records a NEW PrevailingWageRuleSet row
  // (its own effective dates, exclusion-constraint-protected against
  // overlapping the old one) and repoints the determination at it — at
  // which point every review of a week from BEFORE that change silently
  // started checking hours against the NEW thresholds, because nothing
  // here ever asked whether the linked rule set was in force during the
  // week being reviewed.
  //
  // The fix reads every rule set this company has recorded for the
  // determination's own jurisdiction (not only the one the FK happens to
  // point at) and lets findEffectiveRuleSet pick the one actually in force
  // on `weekStartIso` — the same "which one applied back then" question
  // FringeRateSchedule already answers for wages via
  // findEffectiveFringeRateSchedule.
  const determination = job.prevailingWageDeterminations[0] ?? null;
  const candidates = determination
    ? await prisma.prevailingWageRuleSet.findMany({
        where: { companyId, jurisdiction: determination.jurisdiction },
      })
    : [];

  const ruleSet: PrevailingWageRuleSetInput | null =
    candidates.length > 0
      ? findEffectiveRuleSet(candidates.map(toRuleSetInput), weekStartIso)
      : determination?.ruleSet
        ? toRuleSetInput(determination.ruleSet)
        : null;

  const weekEnd = new Date(Date.parse(`${weekStartIso}T00:00:00.000Z`) + 6 * 86_400_000);
  const entries = await prisma.timeEntry.findMany({
    where: {
      jobId,
      date: { gte: new Date(`${weekStartIso}T00:00:00.000Z`), lte: weekEnd },
    },
    select: {
      date: true,
      hours: true,
      payType: true,
      employeeUserId: true,
      employeeUser: { select: { name: true, email: true } },
    },
    orderBy: { date: "asc" },
  });

  const byEmployee = new Map<string, { name: string; entries: DayEntryInput[] }>();
  for (const entry of entries) {
    const bucket = byEmployee.get(entry.employeeUserId) ?? {
      // Prevailing-wage review feeds a certified payroll filing, so the
      // email fallback is not available here. See lib/worker-name.ts.
      name: payrollWorkerName(entry.employeeUser).label,
      entries: [],
    };
    bucket.entries.push({
      date: isoDate(entry.date) as string,
      hours: Number(entry.hours),
      payType: entry.payType as PayType,
    });
    byEmployee.set(entry.employeeUserId, bucket);
  }

  const employees = [...byEmployee.entries()]
    .map(([employeeUserId, bucket]) => ({
      employeeUserId,
      employeeName: bucket.name,
      review: reviewDays(bucket.entries, ruleSet),
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return { jobName: job.name, ruleSetName: ruleSet?.name ?? null, employees };
}

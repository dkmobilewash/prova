import { prisma } from "@prova/db";
import {
  buildCertifiedPayrollSummary,
  type CertifiedPayrollEmployeeSummary,
  type CertifiedPayrollTimeEntryInput,
} from "./certified-payroll";
import { loadCertifiedPayrollWeekEntries } from "./certified-payroll-query";
import type { FringeRateScheduleInput } from "./labor-cost";
import { timeEntryWorkerId, timeEntryWorkerName } from "./worker-name";

/**
 * ONE WEEK OF CERTIFIED PAYROLL, ASSEMBLED ONCE.
 *
 * This was fifty-odd lines inside the certified-payroll page. It is lifted
 * because the payroll EXPORT needs exactly the same figures, and a payroll
 * file that disagrees with the screen it was downloaded from is worse than
 * no export at all — somebody runs pay off one and reconciles against the
 * other. The page renders this; `/api/payroll-export` formats it. Neither
 * computes an hour.
 *
 * Returns the raw entries too: the page needs them to work out who has no
 * name on their account, and that identity is gone once the summary has
 * grouped by `employeeUserId`.
 */
export async function loadCertifiedPayrollWeekSummary(
  companyId: string,
  jobId: string,
  weekStart: Date,
): Promise<{
  entries: Awaited<ReturnType<typeof loadCertifiedPayrollWeekEntries>>;
  summaries: CertifiedPayrollEmployeeSummary[];
}> {
  const [entries, craftClassifications] = await Promise.all([
    loadCertifiedPayrollWeekEntries(companyId, jobId, weekStart),
    prisma.craftClassification.findMany({
      where: { companyId },
      include: { fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } } },
    }),
  ]);

  const fringeSchedulesByCraft = new Map<string, FringeRateScheduleInput[]>(
    craftClassifications.map((craft) => [
      craft.id,
      craft.fringeRateSchedules.map((s) => ({
        baseWage: Number(s.baseWage),
        pensionRate: s.pensionRate != null ? Number(s.pensionRate) : null,
        vacationRate: s.vacationRate != null ? Number(s.vacationRate) : null,
        healthWelfareRate: s.healthWelfareRate != null ? Number(s.healthWelfareRate) : null,
        trainingRate: s.trainingRate != null ? Number(s.trainingRate) : null,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      })),
    ]),
  );

  const summaryInputs: CertifiedPayrollTimeEntryInput[] = entries.map((entry) => ({
    employeeUserId: timeEntryWorkerId(entry),
    // NOT `name ?? email`. See lib/worker-name.ts — this column is a
    // statement to a government agency about who did the work.
    employeeName: timeEntryWorkerName(entry).label,
    craftClassificationId: entry.craftClassificationId,
    craftLabel: entry.craftClassification
      ? `${entry.craftClassification.unionLocal.parentInternational} ${entry.craftClassification.unionLocal.localNumber} — ${entry.craftClassification.name}`
      : null,
    date: entry.date,
    hours: Number(entry.hours),
    payType: entry.payType,
    perDiemAmount: entry.perDiemAmount != null ? Number(entry.perDiemAmount) : null,
    travelPayAmount: entry.travelPayAmount != null ? Number(entry.travelPayAmount) : null,
  }));

  return { entries, summaries: buildCertifiedPayrollSummary(summaryInputs, fringeSchedulesByCraft) };
}

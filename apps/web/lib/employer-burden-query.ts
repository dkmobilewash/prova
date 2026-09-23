import { cache } from "react";
import { prisma } from "@prova/db";
import type { EmployerBurdenRateRecord } from "@/lib/employer-burden";

/**
 * Every employer-burden rate a company has recorded, as the settings page and
 * every job-cost surface read them — one loader, so a job's cost and the
 * screen that explains it cannot disagree about which rows exist.
 *
 * Scoped by `companyId` in the `where`, so the scope cannot be dropped in a
 * later edit without deleting the predicate that finds the rows.
 *
 * ORDER IS FOR A HUMAN, NOT FOR CORRECTNESS. `employerBurdenPercentOn` scans
 * for the latest effective date at or before the day it is asked about and
 * does not depend on the array's order — same rule, and the same reason, as
 * `findEffectiveFringeRateSchedule` (#104 finding 3).
 *
 * ONE READ PER RENDER, like `loadFringeSchedulesByCraft`: the (app) layout
 * asks several loaders for this inside one render (the metric bar, the alert
 * bell, the page itself), and React's `cache()` scopes the memo to a single
 * server request. Outside a React server render — tests, scripts — it simply
 * calls through.
 */
async function readEmployerBurdenRates(companyId: string): Promise<EmployerBurdenRateRecord[]> {
  const rows = await prisma.employerBurdenRate.findMany({
    where: { companyId },
    orderBy: { effectiveDate: "desc" },
    select: { id: true, effectiveDate: true, percent: true, note: true },
  });
  return rows.map((row) => ({
    id: row.id,
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    // toFixed(3) keeps the column's own precision. NOT toString(), which
    // drops trailing zeros and would turn a recorded 15.000 into "15" — the
    // exact rendering bug emr-query.ts documents for the mod rate.
    percent: row.percent.toFixed(3),
    note: row.note,
  }));
}

export const loadEmployerBurdenRates = cache(readEmployerBurdenRates);

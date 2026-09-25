import { prisma } from "@prova/db";

import { benchmarkFromHistory, type Benchmark, type HistoricalJob } from "./conceptual-estimate";
import { JOB_WIP_SELECT, loadJobWipRates, wipFromJobRows } from "./job-wip-rows";

/**
 * What this company's own finished work says a square foot is worth.
 *
 * Only COMPLETE jobs, and only ones carrying a gross area. Both are filtered
 * again inside `benchmarkFromHistory`, deliberately: a benchmark gets quoted
 * long after anybody remembers where it came from, so the rule lives with the
 * arithmetic as well as with the query.
 *
 * COMPLETE rather than "percent complete >= 1", which is `bid-outcome.ts`'s
 * call and the right one — that percentage is derived from cost forecasts an
 * estimator may never have filled in, and a job can read 100% while work
 * continues. The status is a person's statement; the percentage is an
 * inference.
 */
export async function loadConceptualBenchmark(companyId: string): Promise<Benchmark> {
  const [jobs, rates] = await Promise.all([
    prisma.job.findMany({
      where: { companyId, status: "COMPLETE", grossAreaSqFt: { not: null } },
      select: { id: true, name: true, grossAreaSqFt: true, ...JOB_WIP_SELECT },
      // A ceiling rather than everything: a company with hundreds of finished
      // jobs does not get a better benchmark from all of them, and this runs
      // on a page load.
      take: 200,
      orderBy: { updatedAt: "desc" },
    }),
    loadJobWipRates(companyId),
  ]);

  const history: HistoricalJob[] = jobs.map((job) => {
    const wip = wipFromJobRows(job, rates);
    return {
      jobId: job.id,
      jobName: job.name,
      grossAreaSqFt: job.grossAreaSqFt === null ? null : Number(job.grossAreaSqFt),
      contractValue: wip.contractValue,
      actualCostToDate: wip.actualCostToDate,
      // The query already asked for COMPLETE. Stated rather than assumed, so
      // the pure module's own filter has something real to check.
      settled: true,
    };
  });

  return benchmarkFromHistory(history);
}

/**
 * How many finished jobs have no area on them.
 *
 * Needed for the "nothing to compare against" sentence to distinguish "you
 * have not finished anything" from "you have finished plenty and recorded no
 * areas" — the second is a prompt to go and fill some in, the first is not.
 */
export async function countFinishedJobsWithoutArea(companyId: string): Promise<number> {
  return prisma.job.count({ where: { companyId, status: "COMPLETE", grossAreaSqFt: null } });
}

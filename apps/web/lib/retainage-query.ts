import { prisma } from "@prova/db";

/**
 * The company-wide "retainage held" figure. THE query, not a query.
 *
 * ---------------------------------------------------------------------
 * Why this file exists at all — issue #97, which is issue #46 again.
 * ---------------------------------------------------------------------
 *
 * #46 was "the retainage card could never show a number". The fix
 * extracted the SUMMING rule into a pure helper and left the POPULATION
 * rule — which jobs the sum runs over — copied into each call site as
 * prose. Three days later the copy in company-financials-query.ts was
 * still filtering `status IN (CONTRACTED, IN_PROGRESS)`, so the metric bar
 * and the dashboard card showed two different numbers under the same
 * label, on the same screen, eighteen inches apart. Seeded demo data made
 * it $2,500.00 against $15,920.00.
 *
 * The lesson is the inversion: the arithmetic was never the fragile part.
 * `withheld − released` had eight tests and never broke. What broke twice
 * was the answer to "over which rows", and that answer lived in two
 * places. So this file owns the population, and anything that needs the
 * company-wide figure calls `loadRetainageHeld` rather than assembling its
 * own read.
 *
 * ---------------------------------------------------------------------
 * Why there is no status filter, and no date filter either.
 * ---------------------------------------------------------------------
 *
 * Four filters have been tried on this figure and three were wrong.
 *
 * JOB STATUS was the original bug (#46) and the reintroduced one (#97).
 * Retainage is released at the END of a job, by which point the job is
 * normally COMPLETE — the exact status an "active jobs" filter excludes.
 * A card about money that comes back at closeout, drawn from jobs that
 * have not reached closeout, is structurally incapable of showing it.
 *
 * A CALENDAR MONTH was the first fix's mistake. Retainage is chased for
 * months; a figure that resets on the 1st reports nothing owed on the day
 * it is most owed.
 *
 * SUBSTANTIAL COMPLETION was the second, and it is the subtle one.
 * `Job.substantialCompletionDate` is the date a job is EXPECTED to reach
 * substantial completion — a forecasting anchor, not a record that it
 * happened. Requiring it dropped real money held on jobs nobody had
 * forecast yet, and the caption built on it ("past substantial
 * completion") described an event the column does not record.
 *
 * So: no filter. Withheld minus released is money the GC is holding,
 * whatever stage the job is at and whether or not anyone has estimated
 * when it comes back. WHEN it is expected is a different question, and
 * /cash-flow answers it using that date for what it is — a forecast.
 */

/**
 * The population, as a value rather than as prose.
 *
 * Both aggregates below scope through the job relation and nothing else.
 * Exported so `retainage-single-source.test.ts` can assert the whole
 * object with `toEqual` — which fails on ANY added narrowing, however it
 * is spelled. A grep for the string "CONTRACTED" would not: `status: {
 * not: "ESTIMATE" }`, `status: { notIn: [...] }` and an imported constant
 * all reintroduce #97 while reading clean.
 */
export const companyRetainageScope = (companyId: string) => ({ job: { companyId } });

/**
 * Retainage withheld and not yet released, across the whole company.
 *
 * Two indexed aggregates rather than a `findMany` over every job with its
 * invoices and releases attached. This is called from the app layout, so
 * it runs on every authenticated navigation — and twice on /dashboard,
 * once for the metric bar and once for the card, since nothing in this
 * codebase dedupes server reads within a render. Two SUMs can afford that;
 * a whole-company row scan for a sub with hundreds of jobs could not.
 *
 * The aggregate form is arithmetically identical to summing each job's
 * balance: there is no per-job clamp at zero anywhere in this figure
 * (`calculateRetainageSummary` returns `withheld − released` signed), so a
 * sum of differences is the difference of sums. That property is
 * load-bearing here — introducing a per-job floor would silently make
 * these two formulations disagree.
 *
 * A job with no retainage contributes null, not 0, and `_sum` is null when
 * no rows match at all. Both collapse to 0 only at the very end, where
 * "nothing withheld" and "zero withheld" genuinely mean the same thing for
 * a total.
 */
export async function loadRetainageHeld(companyId: string): Promise<number> {
  const [withheld, released] = await Promise.all([
    prisma.invoice.aggregate({
      where: companyRetainageScope(companyId),
      _sum: { retainageWithheld: true },
    }),
    prisma.retainageRelease.aggregate({
      where: companyRetainageScope(companyId),
      _sum: { amount: true },
    }),
  ]);

  return Number(withheld._sum.retainageWithheld ?? 0) - Number(released._sum.amount ?? 0);
}

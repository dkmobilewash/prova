/** The seven days a certified payroll covers.
 *
 * Pure — no database, no Prisma — so the window that decides which hours
 * end up on a document filed with a government agency can be executed in
 * the unit suite. It could not be, before: the window lived inline in an
 * async server component, and an EIGHT-day window
 * (`lte: addDays(weekEnd, 1)`) shipped from 08664d5 until it was found by
 * reading rather than by a test. That window certified every Sunday's
 * hours TWICE — once on its own week and once on the week before it.
 */

/** Sunday of the week containing `date`, at UTC midnight.
 *
 * DELIBERATELY NOT `components/fieldReportWeeks.weekStart`, which is
 * MONDAY-based and carries its own written rationale. Certified payroll
 * keeps the Sunday-to-Saturday workweek this page has always printed and
 * that its `?weekStart=` links encode; moving it would silently shift
 * every already-filed week by a day, which is a bigger change to a filed
 * document than the overlap fix it would have ridden along with.
 *
 * The consequence is real and is written down here so the next caller
 * does not reuse this by accident: the certified-payroll ALERT
 * (`lib/alerts-query.ts`) and the prevailing-wage week review
 * (`lib/prevailing-wage-query.ts`) both group by MONDAY. So the alert's
 * "week of Mon 8/24 – Sun 8/30" and this page's "Aug 23 – Aug 29" are
 * different seven-day spans with hours in common. Anyone reconciling the
 * two sees a one-day offset. Whether the product should have one workweek
 * everywhere is an open decision — not one this module gets to make
 * silently. If you need the compliance week, import fieldReportWeeks; if
 * you need the week THIS PAGE PRINTS, import this.
 */
export function certifiedPayrollWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back up to Sunday
  return d;
}

/** Sunday through Saturday, both bounds inclusive.
 *
 * Inclusive on Saturday is EXACT, not merely tolerant: every writer of
 * `TimeEntry.date` stores UTC midnight (`lib/actions/labor.ts`,
 * `packages/db/scripts/seed-demo.mjs`) and there is no update path for
 * that column. Same shape as `lib/prevailing-wage-query.ts`.
 *
 * The property that matters: consecutive weeks MUST NOT overlap. If
 * `week(n).lte >= week(n+1).gte`, a day is certified on two filings.
 */
export function certifiedPayrollWeekWindow(weekStart: Date): { gte: Date; lte: Date } {
  const gte = certifiedPayrollWeekStart(weekStart);
  const lte = new Date(gte);
  lte.setUTCDate(lte.getUTCDate() + 6);
  return { gte, lte };
}

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
 * The certified-payroll ALERT (`lib/alerts-query.ts`) used to group by
 * MONDAY, from `components/fieldReportWeeks`, so the alert's "week of Mon
 * 8/24 – Sun 8/30" and this page's "Aug 23 – Aug 29" were different
 * seven-day spans with hours in common, and nothing on either page could
 * reveal it (#104 item 7). The alert imports THIS module now, so the span
 * it names is the span the sheet prints. Two consequences worth stating:
 * an alert dismissed under its old Monday key reappears once under the
 * Sunday one, and there is now exactly one definition of the certified
 * payroll week rather than two that agreed on six days out of seven.
 *
 * The prevailing-wage week review (`lib/prevailing-wage-query.ts`) is
 * still MONDAY-based, deliberately and unchanged: its `?weekStart=` links
 * and its database tests all encode Mondays, and re-basing a REVIEW screen
 * is a different change from making an alert agree with the document it is
 * about. If you need the compliance week, import fieldReportWeeks; if you
 * need the week a certified payroll covers, import this.
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

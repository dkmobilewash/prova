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
 * CORRECTED 2026-09-13, and the correction is the point. This paragraph
 * said "the certified-payroll ALERT (`lib/alerts-query.ts`) and the
 * prevailing-wage week review (`lib/prevailing-wage-query.ts`) both group
 * by MONDAY", and that HALF STOPPED BEING TRUE when #244 (e18e1f5) moved
 * `alerts-query.ts` onto `certifiedPayrollWeekStart` — this very function,
 * which backs up to SUNDAY. The sentence a reader would check the next
 * week-alignment question against was false for four days, in the file
 * that exists to warn about exactly this.
 *
 * Where the three workweeks actually stand:
 *   - THIS function (Sunday-start) — the certified-payroll sheet, and
 *     since #244 the certified-payroll ALERT as well. Those two now
 *     describe the same seven days, which was the whole point of that fix.
 *   - `lib/prevailing-wage-query.ts` — still MONDAY-start, for weekly
 *     overtime and the seventh-consecutive-day review.
 *   - `fieldReportWeeks` — deliberately not Sunday; see its own header.
 *
 * So the offset did not go away, it MOVED: the alert and the sheet agree
 * now, and the alert and the prevailing-wage OT review no longer do.
 * Anyone reconciling a week's hours against a week's overtime still sees a
 * one-day offset. Whether the product should have one workweek everywhere
 * is an open decision — not one this module gets to make silently. If you
 * need the overtime week, import from prevailing-wage-query; if you need
 * the week THIS PAGE PRINTS, import this.
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

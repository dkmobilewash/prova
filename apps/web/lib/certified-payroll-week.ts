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

/** A period somebody filed a certified-payroll document against, as ISO
 * dates. Both bounds inclusive, like the week window above. */
export type FiledPayrollPeriod = { start: string; end: string };

/**
 * Whether a filed certified-payroll document covers a whole week.
 *
 * COVERS means the document's period CONTAINS the week end to end. A period
 * that merely clips the week is not evidence the week was filed, and
 * treating it as such hides a real gap on a document whose certification is
 * criminal — so the containment is deliberate and the direction of the
 * error matters more than the convenience.
 *
 * Lifted out of `lib/alerts-query.ts` on 2026-09-26, where it was one
 * inline `covered.some(...)`, when `certified_payroll` (lib/ask/handlers.ts)
 * needed the same answer. It is here rather than copied because this file
 * already owns what a certified-payroll week IS, and because one tool in the
 * Ask box refusing what another tool in the same box reports was the defect
 * that sent anybody looking: two surfaces deriving "is this week covered"
 * separately is how they come to disagree.
 *
 * Nothing about this says a document was SUBMITTED to anybody. It answers
 * "is a document on record against this period" and no more; this app holds
 * no submission, no send date and no receipt. Every caller has to keep those
 * two sentences apart.
 */
export function certifiedPayrollWeekIsCovered(
  periods: readonly FiledPayrollPeriod[],
  weekStart: string,
  weekEnd: string,
): boolean {
  return periods.some((period) => period.start <= weekStart && period.end >= weekEnd);
}

/** The week the certified-payroll page opens on.
 *
 * A `?weekStart=` the reader asked for always wins. WITHOUT one, the page
 * used to open on the CURRENT week — and a contractor's hours are almost
 * always last week's, because payroll is run after the week closes. So the
 * first thing a new user saw was "No time entries logged on this job for
 * this week." with the hours one click away behind "← Previous week" and
 * nothing saying so. Found by clicking a demo job whose 35.3 hours sat in
 * the week before.
 *
 * So with no request it opens on the week of the job's LATEST logged hours,
 * falling back to the current week only when the job has none.
 * `latestEntryDate` is expected to be capped at the end of the current week
 * by the caller, so a mistyped future date cannot become the default.
 */
export function openingCertifiedPayrollWeek(input: {
  requested: string | undefined;
  latestEntryDate: Date | null;
  now: Date;
}): Date {
  if (input.requested) {
    const requested = new Date(`${input.requested}T00:00:00.000Z`);
    if (!Number.isNaN(requested.getTime())) return certifiedPayrollWeekStart(requested);
  }
  return certifiedPayrollWeekStart(input.latestEntryDate ?? input.now);
}

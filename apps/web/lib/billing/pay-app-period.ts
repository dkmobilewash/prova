// The G702 PERIOD TO date: parsing what the person typed, and deciding
// what the printed document says when nothing was ever typed.
//
// Split out of the action and the report page for the reason
// pay-application-query.ts was split out of that page: the rules that
// decide what a document leaving this company SAYS were living inside an
// async server component and a "use server" module, where nothing could
// execute them. Both halves here are pure, so both are tested with no
// database and no React.
//
// WHY THIS FIELD EXISTS AT ALL. A G702 states PERIOD TO at the top and a
// GC's accounting department keys on it. Until now the pay application
// printed `Invoice.issuedAt` — `@default(now())`, the moment somebody
// clicked Submit. An application covering August, typed up on 4 September,
// headlined 4 September. That is a rejected pay application and another
// billing cycle of waiting on a job worth hundreds of thousands.

import { formatCalendarDate, formatInstant } from "@/lib/render-date";

/** What the report prints when the invoice has no period recorded.
 *
 * Every pay application submitted before `Invoice.periodTo` existed is
 * null, and it is deliberately not backfilled — nothing in those rows
 * records what period they covered, so any backfill is a guess printed on
 * a document a GC keys on. Saying so out loud is the honest answer; the
 * dishonest one is `periodTo ?? issuedAt`, which prints a confident wrong
 * date and is the exact defect this column was added to end. */
export const PERIOD_NOT_RECORDED = "Not recorded";

/** Refusal shown when the submit form sends no period. Same sentence
 * whether the field was blank or unparseable — from the person's side
 * there is one thing to do about either. */
export const PERIOD_REQUIRED =
  "Enter the period ending date — a pay application's PERIOD TO is what the GC's accounting department keys on.";

/** A `<input type="date">` value, parsed to the UTC midnight this app
 * stores calendar days at.
 *
 * `new Date("2026-08-31")` already lands on UTC midnight, but only for
 * exactly that shape: `new Date("8/31/2026")` and `new Date("2026-08-31
 * 00:00")` both parse in the RUNNING zone, which west of UTC is the
 * previous day once stored. So the shape is asserted rather than assumed,
 * and anything else is refused instead of silently shifted.
 *
 * Refuses blank. The period is the point of the document; an optional one
 * would be null on new applications too, and "Not recorded" would stop
 * meaning "this predates the column".
 */
export function parsePayAppPeriodTo(raw: string): { ok: true; value: Date } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { ok: false, error: PERIOD_REQUIRED };
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: PERIOD_REQUIRED };
  }
  // A well-formed but impossible date ("2026-02-31") rolls forward in JS
  // rather than failing, so round-trip it and refuse the ones that moved.
  if (parsed.toISOString().slice(0, 10) !== trimmed) {
    return { ok: false, error: PERIOD_REQUIRED };
  }
  return { ok: true, value: parsed };
}

/** The two dates a G702 header carries, each named.
 *
 * They are genuinely different dates and the document has always shown
 * only one of them, unlabelled. `periodTo` is the billing period; the
 * application date is when it was submitted. Neither substitutes for the
 * other, which is why they are returned as two strings and there is no
 * code path where one becomes the other.
 */
export interface PayAppHeaderDates {
  /** When the application was submitted — a real moment, so it renders on
   * the reader's calendar (see lib/render-date.ts). */
  applicationDate: string;
  /** The end of the billing period, or PERIOD_NOT_RECORDED. A plain
   * calendar day: "period to the 31st" means the 31st wherever you are
   * standing, so it renders in UTC for everybody. */
  periodTo: string;
  /** False when the invoice predates the column. Lets a caller style the
   * gap as missing rather than as a date. */
  periodRecorded: boolean;
}

export function payAppHeaderDates(
  invoice: { issuedAt: Date; periodTo: Date | null },
  timeZone: string,
): PayAppHeaderDates {
  return {
    applicationDate: formatInstant(invoice.issuedAt, timeZone),
    periodTo: invoice.periodTo ? formatCalendarDate(invoice.periodTo) : PERIOD_NOT_RECORDED,
    periodRecorded: invoice.periodTo != null,
  };
}

/** The end of the month BEFORE the given local calendar date, as an
 * `<input type="date">` value — the usual convention for a pay
 * application's period, since one is typically prepared in the first days
 * of the following month for the month just finished.
 *
 * Takes the day as a string rather than reading the clock, so the form's
 * default is `localToday()`'s answer (the USER'S calendar date) and this
 * function stays pure and testable. Arithmetic in UTC throughout: building
 * a Date from local parts here would put a Los Angeles user's default a
 * month out on the 1st.
 */
export function previousMonthEnd(today: string): string {
  const [year, month] = today.split("-").map(Number);
  // Day 0 of month `month` is the last day of month `month - 1`, and
  // Date.UTC normalises January back into the previous December.
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}

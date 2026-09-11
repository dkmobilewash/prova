/** Rendering a stored date, where the timezone is always stated out loud.
 *
 * Issue #101. Nineteen date renders in this app called
 * `toLocaleDateString` with no `timeZone`, which formats in whatever zone
 * the JavaScript happens to be running in. That is two different bugs
 * wearing the same line of code, and which one you get depends only on
 * whether the component is a server or a client one:
 *
 *   - in a SERVER component it is the server's clock, UTC on Vercel, so a
 *     UTC-midnight column renders correctly by accident. Nothing in this
 *     repo pins `TZ` — no vercel.json, no next.config setting — so that is
 *     an environment's default doing the work of a decision, and one `TZ`
 *     variable or one differently-configured host silently moves nine
 *     dates at once;
 *   - in a CLIENT component it is the reader's own zone, and a UTC-midnight
 *     column is then a day early for everyone west of UTC. Measured, not
 *     argued: `new Date("2026-09-15T00:00:00.000Z")` formats as "Sep 14,
 *     2026" in America/Los_Angeles and America/New_York, "Sep 15" in UTC
 *     and Asia/Tokyo.
 *
 * So the fix is not "add timeZone to nine call sites" — that is the same
 * edit this class has already survived twice, in components/fieldReportWeeks.ts
 * and components/equipmentDeployment.ts, both of which got it right and
 * neither of which stopped the next one. The fix is that there is nowhere
 * left to write a bare one: every render goes through a function that
 * cannot be called without answering the question, and
 * `dateRenderCensus.test.ts` fails the build if a bare call comes back.
 *
 * WHICH FUNCTION, and this is the whole decision:
 *
 *   `formatCalendarDate` — for a PLAIN CALENDAR DAY. The column was
 *   written by `new Date(`${raw}T00:00:00.000Z`)` or by `new Date(raw)`
 *   over a `<input type="date">` value, both of which land on UTC
 *   midnight. "Due the 15th" means the fifteenth wherever you are
 *   standing, so it renders in UTC everywhere and the reader's zone is
 *   not a factor. Invoice due dates, bid due dates, time entry dates,
 *   dispatch dates, substantial completion, policy and COI expiry.
 *
 *   `formatInstant` — for a REAL MOMENT. The column has
 *   `@default(now())` and records when something actually happened.
 *   Rendering one of these in UTC is its own day-early bug in the other
 *   direction: a payment recorded at 18:00 in Los Angeles is already
 *   tomorrow in UTC. These take the reader's zone, resolved server-side
 *   by `lib/viewerToday.ts`. Payments received, documents created,
 *   invoices issued, QuickBooks connected.
 *
 * The distinction is not in the schema — Prisma spells both `DateTime`
 * and has no opinion — so it lives here, in which function a call site
 * picks, and in the census that makes picking one compulsory.
 */

/** The three shapes this app actually renders dates in.
 *
 * Deliberately a closed set rather than passthrough `Intl` options: the
 * point of this module is that a caller states the zone, and an options
 * bag a caller can fill in freely is one `{ timeZone: undefined }` away
 * from being the bare call again.
 *
 * `numeric` exists to preserve the output of the bare
 * `date.toLocaleDateString()` calls this replaced — those inherited the
 * runtime's default locale, which is en-US here, so "9/15/2026" is what
 * was on screen and is what stays on screen.
 */
export type DateStyle = "medium" | "dayMonth" | "numeric";

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  medium: { month: "short", day: "numeric", year: "numeric" },
  dayMonth: { month: "short", day: "numeric" },
  numeric: { month: "numeric", day: "numeric", year: "numeric" },
};

/** A plain calendar day, stored at UTC midnight, rendered in UTC. */
export function formatCalendarDate(date: Date, style: DateStyle = "medium"): string {
  return date.toLocaleDateString("en-US", { ...STYLES[style], timeZone: "UTC" });
}

/** A real moment, rendered on the calendar of the person reading it.
 *
 * `timeZone` comes from `viewerTimeZone()` in lib/viewerToday.ts, which
 * falls back to UTC when there is no cookie and no header — so the floor
 * of this is the behaviour these call sites already had.
 */
export function formatInstant(date: Date, timeZone: string, style: DateStyle = "medium"): string {
  return date.toLocaleDateString("en-US", { ...STYLES[style], timeZone });
}

import { isJobStatus, JOB_STATUS_LABELS } from "@/lib/job-status-transitions";

/**
 * One job as a picker sees it.
 *
 * THE TWO NULLABLE FIELDS ARE REQUIRED, WHICH IS THE POINT. Until issue #65
 * this type was `{ id, name }` and it was declared three times over
 * (RfiFields, PunchListForm, SafetyIncidentFields), so every new picker
 * copied whichever declaration was nearest and none of them ever asked for
 * anything a person could tell two jobs apart by. Making `clientName` and
 * `status` non-optional means a page that selects only id and name does not
 * compile — the compiler does the remembering instead of a convention.
 *
 * `clientName` is `Job.contact.name` — the GC or owner the job is for.
 * Nullable rather than required-string because a picker may hold a job whose
 * contact row has an empty name; `Job.contactId` itself is not nullable, so
 * in practice this is always a real GC.
 *
 * `status` is `Job.status`, typed as a plain string rather than the Prisma
 * enum so that a value the schema gains later arrives here without a build
 * break. `jobPickerLabel` drops anything it does not recognise; see below.
 */
export type JobOption = {
  id: string;
  name: string;
  clientName: string | null;
  status: string | null;
};

/**
 * A `Job` row as Prisma hands it over, turned into what a picker needs.
 *
 * Every field here is REQUIRED in the parameter type, which is the guard: a
 * page that queries `select: { id: true, name: true }` and passes the result
 * to this does not compile, so the reminder to fetch the GC is the build
 * rather than a convention somebody has to have read. Add
 * `status: true, contact: { select: { name: true } }` to the select.
 */
export function toJobOption(job: {
  id: string;
  name: string;
  status: string | null;
  contact: { name: string | null } | null;
}): JobOption {
  return {
    id: job.id,
    name: job.name,
    clientName: job.contact?.name ?? null,
    status: job.status,
  };
}

/** What stands in for a GC name that did not come through. Not "—": a dash
 * in a `<select>` option reads as a separator, not as an absence. */
export const NO_CLIENT_LABEL = "client not recorded";

/** A job with no name at all. Shouldn't happen — `/jobs/new` requires one —
 * but an empty option is a row you cannot click with any confidence. */
export const UNTITLED_JOB_LABEL = "Untitled job";

/**
 * The one line every job picker shows: `name — GC · status`.
 *
 * WHY THESE THREE, which is the whole decision in this file.
 *
 * Issue #65 found fifteen jobs of which seven were called "Smith kitchen
 * remodel" — the placeholder from `/jobs/new`. Every `<select>` in the app
 * rendered seven identical rows, and what gets filed through those pickers is
 * certified payroll, a pay application, a backcharge, an RFI. Those are
 * evidence records: identity fields lock on creation and sent correspondence
 * closes rather than deletes, so the wrong row is not a mistake anyone takes
 * back cheaply.
 *
 * THE GC IS THE STRONGEST DISCRIMINATOR AVAILABLE, and it is not a guess:
 * the dashboard's job list — the only real job list in the app — already
 * prints the contact name on its own line under each job name, and has since
 * before this issue. A sub's jobs cluster by GC (several buildings for one
 * builder, several builders with similar building names), and the expensive
 * filing error is the one that crosses a GC boundary, because that is the one
 * that reaches a stranger's paperwork.
 *
 * STATUS IS SECOND BECAUSE THE GC ALONE DOES NOT COVER THE ISSUE'S OWN
 * EXAMPLE: "a sub running two phases for the same GC, or two buildings on one
 * site". The demo seed is exactly that shape — Riverside and Lakeshore are
 * both Brackett Construction, Northgate and Cedar Park are both Halvorsen —
 * and status separates each pair. It is also independently worth seeing: an
 * RFI filed against an ESTIMATE, or a backcharge against a job marked
 * COMPLETE, is usually the wrong row rather than an unusual one.
 *
 * WHAT WAS CONSIDERED AND LEFT OUT:
 *
 *   - Job number. There isn't one. `Job` has no number column, and adding a
 *     sequence to fifteen existing jobs is a migration and a counter row, not
 *     a label change.
 *   - City. Also not a field. `Contact.address` is free text belonging to the
 *     GC, not the site, so it would say the same thing for every job with
 *     that builder — no discrimination at all where it is needed most.
 *   - Start date. Null on every ESTIMATE, which is precisely the state a
 *     placeholder-named job sits in, so it would be blank on the rows most
 *     likely to collide.
 *   - Contract value. Real discrimination, but money on a picker is a
 *     permissions question (`VIEW_COMPANY_FINANCIALS`), and a label a foreman
 *     and an owner see differently is two labels.
 *
 * WHAT THIS STILL CANNOT DO, stated rather than glossed: two jobs with the
 * same name, the same GC and the same status are still identical here. That
 * is a naming problem, and issue #65 says explicitly not to solve it with a
 * uniqueness constraint — two jobs may legitimately share a name.
 *
 * Pure: no clock, no database, no React. A label that changed between the
 * server render and the client's would be a hydration error rather than a
 * cosmetic one, so nothing in here may read `new Date()`.
 */
export function jobPickerLabel(job: JobOption): string {
  const name = job.name.trim() || UNTITLED_JOB_LABEL;
  const client = job.clientName?.trim() || NO_CLIENT_LABEL;
  // An unrecognised status is DROPPED, not printed. A raw "WARRANTY" in a
  // dropdown is noise a contractor has to decode, and an `undefined` in it is
  // the bug this file exists to stop being visible.
  const status = isJobStatus(job.status) ? JOB_STATUS_LABELS[job.status] : null;

  return status ? `${name} — ${client} · ${status}` : `${name} — ${client}`;
}

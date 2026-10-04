/**
 * WHERE A JOB IS, for a form a government body receives.
 *
 * One rule, in one place, because three forms ask the question and the schema
 * holds two answers to it:
 *
 *   - `Job.siteAddress` — a real street address, geocoded when it is saved
 *     (`jobs.prisma:84-95`). Specific, and the one a person would put on a
 *     document.
 *   - `Job.projectLocation` — free text, "in the person's words"
 *     ("Portland, OR", "SE 13th and Tacoma"), typed when the bid was started
 *     (`jobs.prisma:56-60`).
 *
 * The street address first, the looser one as a fallback, and that is not a
 * new decision: `lib/das-print.ts` has resolved it exactly this way since the
 * DAS forms were written. This module exists so the rule has a name and a
 * test rather than being a `??` chain each form repeats — and so a fourth
 * form cannot pick a different order. Two government documents for one job
 * disagreeing about where the job is would be the two-computations-disagreeing
 * shape this repo keeps paying for, on paper somebody signs.
 *
 * WHY IT WAS WORTH EXTRACTING RATHER THAN COPYING. The WH-347 did not resolve
 * it at all: its page passed `job: { name: job.name }` and nothing else, so
 * `projectLocation` was always null and always blocking, while the message on
 * screen said "Record the job's site address on the job page" — an
 * instruction that could not work. The reason is in `Wh347JobInput`'s own
 * comment, which read "Neither is on the Job model yet; both are accepted so
 * the caller that gains them does not change this module's shape." True when
 * it was written. Both columns exist now, and the stale sentence is what
 * stopped anybody wiring them up — the `InvoiceCounter` shape from CLAUDE.md,
 * where a claim about what the app does NOT hold perished exactly as fast as
 * a claim about what it does, and the "not yet" direction is the one that
 * stops people looking.
 *
 * (It is STILL true for `contractNumber`: there is no such column anywhere in
 * `packages/db/prisma/schema`, which is why that field keeps its honest
 * message and is not part of this.)
 *
 * BLANK COUNTS AS ABSENT, which `??` alone does not do. A form field a person
 * cleared leaves `""` behind, and `job.siteAddress ?? job.projectLocation`
 * returns that empty string — so the looser location that IS recorded gets
 * skipped, and `das-print`'s `project.location === null` check then calls the
 * empty box filled in. Same rule, same reason, as `committeeDeliverability`
 * in `das-forms.ts`: "a blank-but-present string counts as absent, because a
 * space is what a form field leaves behind." On a document a state receives,
 * a box that LOOKS filled is worse than an empty one, because nobody
 * re-checks a filled box.
 */

/** Exactly the two nullable columns, nothing derived and nothing defaulted. */
export interface JobLocationSource {
  siteAddress: string | null;
  projectLocation: string | null;
}

export function jobFormLocation(job: JobLocationSource): string | null {
  const address = job.siteAddress?.trim();
  if (address) return address;
  const location = job.projectLocation?.trim();
  if (location) return location;
  return null;
}

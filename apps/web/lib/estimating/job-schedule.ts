import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { formatCalendarDate } from "@/lib/render-date";

/**
 * The body of "move the job's dates", lifted out of the Server Action so
 * two callers can share it: `updateJobSchedule` (the job page's form,
 * which keeps its throw and its operating-location field) and the Ask
 * command `reschedule_job` — the first command that rewrites a row to
 * values the person stated rather than adding one or stamping today, and
 * which needs its refusals as sentences, because production redacts a
 * thrown Server Action message.
 *
 * Same arrangement as create-job.ts beside it: a plain object in, a plain
 * result out. No FormData, no `requireCompanyContext`, no
 * `revalidatePath`. The caller supplies the company it already verified
 * and does its own revalidation, so this can also run from a database
 * test. The job is asserted in-company HERE, in the write itself, because
 * this is the boundary a card's server-held payload crosses.
 *
 * WHAT MAKES A MODIFY DIFFERENT FROM A CREATE, and the reason `expected`
 * exists: a card was made from the dates the row held at that moment, and
 * somebody may have edited them on the job page in the half hour before
 * the tap. Overwriting silently would throw away an edit the person
 * tapping never saw. So the write is a compare-and-set — one UPDATE whose
 * WHERE names the dates the card showed — and a row that has moved
 * matches nothing, writes nothing, and comes back as a sentence naming
 * what it holds now. Atomic in Postgres, which a read-then-write is not.
 */
export const END_BEFORE_START = "End date can't be before the start date";

/** A calendar day at UTC midnight, or unset. Never an instant. */
export type ScheduleDates = { startDate: Date | null; endDate: Date | null };

export type SetJobScheduleDatesInput = ScheduleDates & {
  /** The dates the caller last saw on the row. The write applies only
   * while the row still holds exactly these, nulls included. */
  expected: ScheduleDates;
};

/** "runs Oct 1, 2026 to Nov 13, 2026", for the sentence a stale card gets. */
export function describeScheduleDates(dates: ScheduleDates): string {
  const start = dates.startDate ? formatCalendarDate(dates.startDate) : null;
  const end = dates.endDate ? formatCalendarDate(dates.endDate) : null;
  if (start && end) return `runs ${start} to ${end}`;
  if (start) return `starts ${start} with no end date set`;
  if (end) return `has no start date set and ends ${end}`;
  return "has no dates set";
}

export async function setJobScheduleDates(
  companyId: string,
  jobId: string,
  input: SetJobScheduleDatesInput,
): Promise<ActionResultWith<ScheduleDates>> {
  // The action's own rule, in the action's own words, before any write.
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return { ok: false, error: END_BEFORE_START };
  }

  const written = await prisma.job.updateMany({
    where: {
      id: jobId,
      companyId,
      startDate: input.expected.startDate,
      endDate: input.expected.endDate,
    },
    data: { startDate: input.startDate, endDate: input.endDate },
  });
  if (written.count === 1) {
    return { ok: true, value: { startDate: input.startDate, endDate: input.endDate } };
  }

  // Nothing matched: either the job is not this company's, or its dates
  // are no longer the ones the caller saw. Say which, and say what the
  // row holds now, so the next card is made from the truth.
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: { name: true, startDate: true, endDate: true },
  });
  if (!job) return { ok: false, error: "Job not found" };
  return {
    ok: false,
    error: `${job.name}'s dates have changed since you last saw them — it now ${describeScheduleDates(job)}. Ask again to see the current dates before moving them.`,
  };
}

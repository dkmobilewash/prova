import { isJobStatus } from "@/lib/job-status-transitions";

/**
 * Which job a daily field report is filed against — the default in the
 * composer, and the filter on the log.
 *
 * Pure: no database, no clock, no React. Both halves decide the same thing
 * from two directions ("which job is this about"), which is why they share a
 * file rather than being duplicated at the two call sites.
 *
 * THE BUG THIS EXISTS TO END. `/field-reports` fetched every job
 * `orderBy: { name: "asc" }` and the composer defaulted to `jobs[0]`, so the
 * default job was the ALPHABETICALLY FIRST job of ANY status — an estimate
 * nobody has won, a job closed out last spring. Work performed is the only
 * field a foreman actually types; everything else on that form is already
 * filled in for him. So the one field he fills gets filed against whichever
 * job happens to sort first, and a daily report is the document a schedule
 * dispute is argued from months later.
 */

/**
 * The statuses a job can be in and still have work happening on it.
 *
 * CONTRACTED is in here alongside IN_PROGRESS deliberately. A signed job
 * that nobody has flipped to IN_PROGRESS yet is exactly the job a crew
 * mobilises onto, and the status column is set by hand
 * (`lib/job-status-transitions.ts` — nothing derives it), so it lags reality
 * by however long it takes somebody in the office to press a button.
 * Counting it as active makes the "exactly one" test below harder to
 * satisfy, which is the direction this should err in: one job too many in
 * the candidate set means the form ASKS, and asking is never the wrong
 * answer.
 *
 * ESTIMATE and COMPLETE are out. There is no crew on an estimate, and a
 * report filed against a closed job is the one that reaches a GC's
 * closeout package.
 */
export const ACTIVE_FIELD_JOB_STATUSES = ["CONTRACTED", "IN_PROGRESS"] as const;

/** The job shape any of this needs. Deliberately smaller than `JobOption` —
 * these functions decide from the status alone, so nothing here can start
 * depending on a name or a GC. */
export type FieldJob = { id: string; status: string | null };

/**
 * An unrecognised status is NOT active.
 *
 * `jobLabels.ts` types status as a plain string so a status the schema gains
 * later arrives without a build break. That tolerance has a direction here:
 * a future "WARRANTY" or "ON_HOLD" must not silently become the job a
 * foreman's report lands on. It can still be CHOSEN — it is only barred from
 * being chosen FOR him.
 */
export function isActiveFieldJob(job: FieldJob): boolean {
  return (
    isJobStatus(job.status) &&
    (ACTIVE_FIELD_JOB_STATUSES as readonly string[]).includes(job.status)
  );
}

export function activeFieldJobs<T extends FieldJob>(jobs: readonly T[]): T[] {
  return jobs.filter(isActiveFieldJob);
}

/**
 * The job the composer starts on, or `""` for "you have to say".
 *
 * THE RULE: guess only when there is nothing to guess between.
 *
 *   1. An explicitly chosen job wins — the page's own `?job=` filter. That
 *      is a person's stated choice, so it is honoured whatever its status:
 *      a late report against a job that just closed is a real errand, and
 *      the foreman said which job by filtering to it.
 *   2. Otherwise, if EXACTLY ONE job is active, that is the answer. One
 *      running job and one possible report are the same thing.
 *   3. Otherwise `""`. Two active jobs means the form cannot know, and an
 *      unchosen default that is silently wrong is worse than no default:
 *      a blank select stops the submit and costs a tap, a wrong one costs a
 *      day's record on somebody else's job and nothing on screen says so.
 *
 * Note what rule 3 does NOT do: it does not pick the single IN_PROGRESS job
 * out of four CONTRACTED ones. That would be the same guess in a better
 * disguise, and the status column is hand-set, so the disguise is thin.
 */
export function defaultFieldReportJobId(
  jobs: readonly FieldJob[],
  chosenJobId?: string | null,
): string {
  if (chosenJobId && jobs.some((job) => job.id === chosenJobId)) return chosenJobId;
  const active = activeFieldJobs(jobs);
  return active.length === 1 ? active[0].id : "";
}

/**
 * `?job=` turned into a job id this company actually has, or null.
 *
 * Same shape as `/punch-lists`: an id that is not in the page's own job list
 * is treated as no filter at all, so a stale link or a hand-typed id shows
 * the whole log rather than an empty page that looks like a company with no
 * reports in it.
 */
export function resolveFieldReportJobFilter(
  jobs: readonly { id: string }[],
  raw: string | undefined | null,
): string | null {
  return raw && jobs.some((job) => job.id === raw) ? raw : null;
}

/** The `where` fragment to spread into the report query. Empty object for
 * "every job", which is what an unrecognised `?job=` collapses to. */
export function fieldReportJobWhere(activeJob: string | null): { jobId?: string } {
  return activeJob ? { jobId: activeJob } : {};
}

/** The chip hrefs. One parameter today; built with URLSearchParams anyway so
 * that adding a second one cannot accidentally drop the first, which is the
 * failure `/photos` documents at length. */
export function fieldReportsFilterHref(job: string | null): string {
  const params = new URLSearchParams();
  if (job) params.set("job", job);
  const query = params.toString();
  return query ? `/field-reports?${query}` : "/field-reports";
}

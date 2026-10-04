import { prisma } from "@prova/db";
import {
  MAX_ATTEMPTS,
  ingestProgress,
  type ClaimedTask,
  type IngestView,
  type RunnerPorts,
} from "./runner";

/**
 * The claim port: the run loop's `claim`/`finish`/`fail` against Postgres.
 *
 * THIS FILE IS WHERE THE ATOMICITY LIVES, and everything else in the runner
 * rests on it being right. The loop is pure policy and cannot tell whether two
 * workers took the same page; only this query can prevent it.
 *
 * WHY IT IS TWO STATEMENTS AND NOT ONE. Postgres can do this in a single
 * `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`, which is
 * the textbook answer and better than what is below. Prisma's `updateMany`
 * cannot RETURNING, so the choice is raw SQL or select-then-guarded-update. The
 * guarded update is chosen because the guard is the same expression as the
 * select, so a lost race is indistinguishable from a row that was never
 * eligible — both yield count 0 and both mean "try the next one". Raw SQL would
 * be faster and would put the eligibility rules in a string that no typecheck
 * reads, which is how the rules and the comment describing them drift apart.
 *
 * WHAT MAKES THE GUARD SUFFICIENT: `updateMany` compiles to a single UPDATE
 * with a WHERE, and Postgres evaluates that WHERE against the row it is about
 * to lock. Two workers issuing it for the same id produce one count 1 and one
 * count 0 — the loser's WHERE no longer matches, because the winner has already
 * set `claimedAt`. No advisory lock, no transaction, no serialisation level
 * needed for this specific shape.
 */

/** How many candidates to try before giving up this tick.
 *
 * A LOST RACE IS NOT AN EMPTY QUEUE, which is the reason this is a loop rather
 * than one attempt: returning null after one lost race would end the run early
 * and report `drained` on a job with work left — a job that looks finished and
 * is not. Five is enough for any plausible number of concurrent invocations
 * (the cron is one, plus a person clicking Retry), and it is bounded because an
 * unbounded retry against a genuinely empty queue is a spin. */
const CLAIM_ATTEMPTS = 5;

/** The eligibility rules, in one place, used as BOTH the candidate search and
 *  the update's guard.
 *
 * One expression rather than two, deliberately: if the search were wider than
 * the guard, every extra row would be a lost race that looked like contention;
 * if it were narrower, eligible work would be invisible. Sharing it makes the
 * two impossible to disagree. */
function claimable(jobId: string, now: Date, maxAttempts: number) {
  return {
    jobId,
    // Never re-do finished work, whatever the claim says.
    finishedAt: null,
    // Attempts increments ON CLAIM, so a task at the ceiling has already had
    // its last attempt. `lt` rather than `lte` for that reason.
    attempts: { lt: maxAttempts },
    // Available means: never claimed, or claimed by a worker whose lease has
    // lapsed. The second half is the stuck-lease reclaim.
    OR: [{ claimedAt: null }, { claimExpiresAt: { lt: now } }],
    // Inside a backoff window means not yet. Null means no wait was set.
    AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
  };
}

/**
 * Ports bound to one job.
 *
 * `now` is injected here too, and for a reason beyond testability: the loop and
 * the port must agree about the time, or a lease computed from one clock and
 * compared against another can expire early. One clock per run.
 */
export function claimPorts(options: {
  jobId: string;
  /** Does one page's work. The stage, injected — this file knows nothing about
   *  pages or PDFs, which is what lets a second stage reuse all of it. */
  work: RunnerPorts["work"];
  now?: () => number;
  maxAttempts?: number;
}): RunnerPorts {
  const now = options.now ?? (() => Date.now());
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;

  return {
    // Passed straight through. This file deliberately knows nothing about what
    // a page's work IS, which is what lets a second stage reuse every line of
    // the claim logic without touching it.
    work: options.work,

    claim: async (deadline) => {
      for (let tries = 0; tries < CLAIM_ATTEMPTS; tries += 1) {
        const at = new Date(now());
        const where = claimable(options.jobId, at, maxAttempts);

        // LOWEST PAGE NUMBER FIRST, and the order has to be TOTAL or a
        // budget-truncated run cuts the list in a different place every tick
        // and the same tail is never reached — the starvation
        // `orderRecipients` documents for the digest. `pageNumber` is unique
        // per (job, stage) by constraint, so it is already total; `id` is the
        // tie-break for the impossible case, because an ordering that depends
        // on a constraint is one schema change from being partial.
        const candidate = await prisma.planIngestTask.findFirst({
          where,
          orderBy: [{ pageNumber: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (!candidate) return null;

        const won = await prisma.planIngestTask.updateMany({
          // The SAME predicate, plus the id. This is the whole race: the
          // loser's `claimedAt: null` no longer holds.
          where: { ...where, id: candidate.id },
          data: {
            claimedAt: at,
            claimExpiresAt: deadline,
            attempts: { increment: 1 },
            // Cleared on claim so a previous failure's message does not sit
            // beside a page that is currently being retried — a person looking
            // at the screen would read a stale error as the current state.
            error: null,
            nextAttemptAt: null,
          },
        });
        if (won.count !== 1) continue;

        // READ BACK rather than computing `candidate.attempts + 1`. The guard
        // does not pin `attempts`, so in principle it can have moved between
        // the find and the update; the row is the only thing that knows what it
        // now says, and `attempts` decides whether this is the last try.
        const task = await prisma.planIngestTask.findUnique({
          where: { id: candidate.id },
          select: { id: true, pageNumber: true, stage: true, attempts: true },
        });
        // Vanished between the update and the read: the plan set was deleted
        // under us, which CASCADEs. Not an error — there is simply no work.
        if (!task) return null;
        return task satisfies ClaimedTask;
      }
      // Every candidate was taken by somebody else. Reported as no work, which
      // makes this tick end early — correct, because another worker is
      // demonstrably making progress on this job right now.
      return null;
    },

    finish: async (task, at) => {
      await prisma.planIngestTask.update({
        where: { id: task.id },
        // The claim is RELEASED as well as the work recorded. A finished task is
        // never re-claimed (the predicate excludes `finishedAt`), so leaving
        // `claimedAt` set would only mislead whoever reads the row.
        data: { finishedAt: at, claimedAt: null, claimExpiresAt: null, error: null, nextAttemptAt: null },
      });
    },

    fail: async (task, error, retryAt, exhausted) => {
      await prisma.planIngestTask.update({
        where: { id: task.id },
        data: {
          error,
          // RELEASED EITHER WAY. On a retryable failure the release plus
          // `nextAttemptAt` is what lets another tick pick it up; on an
          // exhausted one the release matters for a different reason — a row
          // left claimed forever reads as "in progress" on the screen, and this
          // page is not in progress, it is finished failing.
          claimedAt: null,
          claimExpiresAt: null,
          // Null when exhausted, so no tick ever claims it again. The ceiling
          // is enforced by `attempts` in the predicate too; this is the second
          // of the two, and belt-and-braces is right here because a page that
          // retries forever is a bill.
          nextAttemptAt: exhausted ? null : retryAt,
        },
      });
    },
  };
}

/** What a job's tasks add up to — the numbers `ingestProgress` turns into a
 *  percentage, and the only source of truth about how far a run got. */
export async function ingestCounts(jobId: string): Promise<{
  total: number;
  finished: number;
  exhausted: number;
  /** Failed but still retryable — the difference between a job that is done
   *  and one that is waiting. */
  pending: number;
  /** Claimed right now by a worker whose lease has not lapsed. */
  inFlight: number;
}> {
  const at = new Date();
  const [total, finished, exhausted, inFlight] = await Promise.all([
    prisma.planIngestTask.count({ where: { jobId } }),
    prisma.planIngestTask.count({ where: { jobId, finishedAt: { not: null } } }),
    // EXHAUSTED IS "unfinished AND at the ceiling", not "has an error". A page
    // that failed once and is waiting also has an error, and counting it here
    // would report a job as settled while it still has work to do — the
    // progress bar reaching 100% before the work stops.
    prisma.planIngestTask.count({
      where: { jobId, finishedAt: null, attempts: { gte: MAX_ATTEMPTS } },
    }),
    prisma.planIngestTask.count({
      where: { jobId, finishedAt: null, claimedAt: { not: null }, claimExpiresAt: { gte: at } },
    }),
  ]);
  return { total, finished, exhausted, pending: total - finished - exhausted, inFlight };
}

/**
 * Close the job when nothing is left to do, and say whether it closed.
 *
 * SEPARATE FROM THE LOOP on purpose: the loop knows what IT did, not what every
 * other invocation did, so only a query over the rows can decide that a job is
 * complete. A loop that closed the job when its own queue ran dry would close it
 * while another worker was still mid-page.
 *
 * Guarded on `finishedAt: null` so two workers finishing the last two pages at
 * once write it once, and the timestamp is the first one's rather than
 * whichever happened to be last.
 */
export async function closeIfSettled(jobId: string, at: Date = new Date()): Promise<boolean> {
  const counts = await ingestCounts(jobId);
  if (counts.total === 0) {
    // A job with no tasks is complete, not stuck at nothing — the same
    // judgement `ingestProgress` makes, and a zero-page upload is reachable.
    const closed = await prisma.planIngestJob.updateMany({
      where: { id: jobId, finishedAt: null },
      data: { finishedAt: at },
    });
    return closed.count === 1;
  }
  if (counts.finished + counts.exhausted < counts.total) return false;
  const closed = await prisma.planIngestJob.updateMany({
    where: { id: jobId, finishedAt: null },
    data: { finishedAt: at },
  });
  return closed.count === 1;
}

/**
 * Whether unclaimable-but-not-finished work remains, i.e. everything left is
 * inside its backoff window.
 *
 * This is what turns the loop's `drained` into `blocked`. The distinction is
 * not cosmetic: "nothing to do" ends a job and "nothing to do YET" must not,
 * and a runner that could not tell them apart would close a job whose pages
 * are all waiting thirty seconds to be retried.
 */
export async function hasWaitingWork(jobId: string, at: Date = new Date()): Promise<boolean> {
  const waiting = await prisma.planIngestTask.count({
    where: {
      jobId,
      finishedAt: null,
      attempts: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { gt: at },
    },
  });
  return waiting > 0;
}

/**
 * A run's view, assembled from the counts — the ONE place that shape is built,
 * so a screen, a log line and an action cannot disagree about a job's progress.
 *
 * SERVER ONLY. The TYPE lives in `runner.ts` precisely so a client component can
 * name it without importing this file's prisma.
 */
export async function ingestViewOf(jobId: string, stage: IngestView["stage"]): Promise<IngestView> {
  const counts = await ingestCounts(jobId);
  const progress = ingestProgress(counts);
  return {
    jobId,
    stage,
    ...counts,
    percent: progress.percent,
    complete: progress.complete,
    waiting: progress.complete ? false : await hasWaitingWork(jobId),
  };
}

/**
 * THE NEWEST RUN over this plan set, finished or not — what a page hands the
 * panel so a reload shows where the set actually got to.
 *
 * ── WHAT THIS REPLACED, AND WHY IT WAS WRONG TWICE ──
 *
 * It was `unfinishedIngestFor(planId, stage)`, called as
 * `unfinishedIngestFor(plan.id, "PAGE_INVENTORY")`, and it could only ever
 * restore an IN-PROGRESS run of the FIRST stage.
 *
 * So a finished pass was forgotten on reload: the panel fell back to its
 * untouched state and offered "Read the sheets" again, directly above a sheet
 * index that plainly knew all five sheets and which of them was a scan. Two
 * parts of one screen disagreeing about whether anything had been read.
 *
 * And it made the second stage unreachable in the normal case. The control that
 * starts `TITLE_BLOCK` is offered when a COMPLETED free pass is in view — which
 * this could never return. Read the sheets, close the page, come back, and there
 * was no way forward at all. The fix for the missing stage control was real and
 * still only worked inside the one page load that started it.
 *
 * ── WHY NEWEST-WINS NEEDS NO STAGE ORDER ──
 *
 * The obvious version of this asks for the FURTHEST stage, which means keeping a
 * stage ordering here and remembering to extend it. It is not needed: the flow is
 * sequential, so the most recently created run IS the furthest along. And when
 * somebody deliberately re-runs an earlier stage, the newest run is that one —
 * which is also what they should be looking at.
 */
export async function latestIngestFor(planId: string): Promise<IngestView | null> {
  const job = await prisma.planIngestJob.findFirst({
    where: { planId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, stage: true },
  });
  if (!job) return null;
  return ingestViewOf(job.id, job.stage);
}

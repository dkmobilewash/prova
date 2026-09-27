import type { PlanIngestStage } from "@prova/db";

/**
 * The plan-ingestion run loop, with no database and no clock of its own.
 *
 * WHAT THIS FILE IS FOR. A 300-sheet plan set is 300 units of work and a Vercel
 * function has 60 seconds, so ingestion is many invocations by construction.
 * Everything hard about that is in two questions — what happens when an
 * invocation dies mid-page, and how does a person see where it got to — and
 * both are answered by policy rather than by the work itself. So the policy
 * lives here, pure, and the work is injected.
 *
 * WHY IT TAKES `now` AND `claim` AS ARGUMENTS. `notification-run.ts` settled
 * this pattern for the digest and the reasoning transfers exactly: a budget
 * that reads `Date.now()` can only be tested by waiting for it, so the budget
 * goes untested and the one behaviour that matters under load is the one
 * nothing checks. Injected, a 45-second budget is a test that runs in a
 * millisecond.
 *
 * WHAT IS DELIBERATELY NOT HERE: any knowledge of pages, PDFs, models or
 * prompts. This loop cannot tell `PAGE_INVENTORY` from `CLASSIFY`; it asks for
 * a unit of work and is told whether it succeeded. That is what lets the
 * runner ship and be proved before any ingestion exists to ride on it.
 */

/**
 * How long a run may work before stopping itself.
 *
 * 45 seconds under the route's `maxDuration = 60`, the same numbers the digest
 * run uses, and for the same reason it states: stopping ourselves beats being
 * stopped. The dangerous state is between doing a page's work and recording
 * that it was done — the platform killing us there spends an attempt on work
 * that already succeeded. Leaving 15 seconds means the page in flight finishes
 * and the response gets written.
 */
export const DEFAULT_RUN_BUDGET_MS = 45_000;

/**
 * How long a claim is good for before another worker may take the task.
 *
 * Longer than the run budget ON PURPOSE, and this is the subtle one. If a lease
 * were shorter than a run, a worker still legitimately working on a page would
 * have its claim expire underneath it and a second worker would start the same
 * page — the double-spend the claim column exists to prevent. Ninety seconds is
 * two run budgets, so a lease can only lapse if the invocation holding it is
 * genuinely gone.
 */
export const CLAIM_LEASE_MS = 90_000;

/**
 * How many times one page may be attempted before it is left failed.
 *
 * Three, and the ceiling exists because the alternative is unbounded spend on a
 * page that cannot succeed. A malformed sheet in a 300-page set must cost three
 * attempts and then report itself, not retry until somebody notices the bill.
 *
 * The count increments ON CLAIM rather than on failure — see the schema comment
 * on `attempts`. An attempt that dies before it can write anything is exactly
 * what a page that kills its worker produces, and counting failures would
 * retry that one forever.
 */
export const MAX_ATTEMPTS = 3;

/**
 * How long to wait before a failed page may be tried again, by attempt number.
 *
 * Index is the attempt that just failed, so a first failure waits 30s and a
 * second waits five minutes. Exponential in shape but written out, because
 * three values are clearer as three values than as a formula plus a cap, and
 * the numbers are a judgement rather than a derivation.
 *
 * WHAT BACKOFF IS ACTUALLY FOR HERE, since the cron's own interval already
 * spaces retries: it stops a single invocation's loop from spending all three
 * attempts on one page inside one 45-second run, and it stops the per-page
 * Retry button from doing the same at whatever rate a person can click. Without
 * it, "three attempts" against a transient fault can be spent in three seconds.
 */
export const BACKOFF_MS = [30_000, 300_000, 900_000] as const;

export function backoffFor(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
}

/** What a worker is handed when it wins a claim. */
export type ClaimedTask = {
  id: string;
  pageNumber: number;
  stage: PlanIngestStage;
  attempts: number;
};

/** What doing one page came to. A SENTENCE on failure, never an error object:
 *  it is stored and rendered beside a Retry button for a person to read. */
export type WorkOutcome = { ok: true } | { ok: false; error: string };

export type RunnerPorts = {
  /**
   * Take one available task, or null when there is none.
   *
   * ATOMIC, and the loop depends on it: the implementation claims with an
   * `updateMany` guarded on the row still being unclaimed, so two workers
   * racing produce one winner and one zero-count update. A port that merely
   * SELECTed the next row would hand the same page to both.
   */
  claim: (deadline: Date) => Promise<ClaimedTask | null>;
  /** Do the page's work. Never throws — a throw is converted by `runIngest`,
   *  because a port that throws past the loop kills the whole run over one
   *  page. */
  work: (task: ClaimedTask) => Promise<WorkOutcome>;
  /** Record success. */
  finish: (task: ClaimedTask, at: Date) => Promise<void>;
  /**
   * Record failure, releasing the claim so it can be retried after `retryAt`,
   * or leaving it failed for good once attempts are spent.
   *
   * `exhausted` is computed HERE rather than by the port, so the ceiling is one
   * decision in one place and a second caller cannot pick a different one.
   */
  fail: (task: ClaimedTask, error: string, retryAt: Date | null, exhausted: boolean) => Promise<void>;
};

export type RunReport = {
  /** Pages finished successfully in this invocation. */
  done: number;
  /** Pages that failed and may be retried later. */
  retryable: number;
  /** Pages that failed for the last time. */
  exhausted: number;
  /**
   * Why the loop stopped, and all three are normal.
   *
   * `drained` — no work was available, so the job may be complete.
   * `budget`  — time ran out with work left; the next invocation continues.
   * `blocked` — work exists but nothing is claimable yet, because every
   *             remaining task is inside its backoff window. Distinct from
   *             `drained` on purpose: "nothing to do" and "nothing to do YET"
   *             are the difference between finishing a job and hanging it.
   */
  stopped: "drained" | "budget" | "blocked";
};

/**
 * Work until there is nothing claimable or the budget runs out.
 *
 * THE CONTRACT WITH THE CALLER: this returns rather than throws. A page that
 * fails is recorded and the loop moves on, because one bad sheet must not
 * abandon the other 299 — which is the same judgement `runDigests` makes about
 * one bad recipient, and for the same reason.
 */
export async function runIngest(options: {
  ports: RunnerPorts;
  now?: () => number;
  budgetMs?: number;
  leaseMs?: number;
  maxAttempts?: number;
}): Promise<RunReport> {
  const { ports } = options;
  const now = options.now ?? (() => Date.now());
  const budgetMs = options.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const leaseMs = options.leaseMs ?? CLAIM_LEASE_MS;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;

  const startedAt = now();
  const report: RunReport = { done: 0, retryable: 0, exhausted: 0, stopped: "drained" };

  for (;;) {
    // CHECKED BEFORE CLAIMING, never after. Claiming and then discovering the
    // budget is gone leaves a task claimed by a worker that will not do it —
    // which the lease eventually reclaims, but only after 90 seconds of a job
    // looking stuck for no reason.
    if (now() - startedAt >= budgetMs) {
      report.stopped = "budget";
      return report;
    }

    const claimed = await ports.claim(new Date(now() + leaseMs));
    if (!claimed) {
      // `drained` is the default and stays: whether unclaimable work remains is
      // the caller's question, answered from the task rows rather than guessed
      // at here. See `blocked` on RunReport for why the distinction matters.
      return report;
    }

    // The port increments `attempts` as it claims, so `claimed.attempts`
    // already counts THIS attempt. Exhausted means this was the last one.
    const exhausted = claimed.attempts >= maxAttempts;

    let outcome: WorkOutcome;
    try {
      outcome = await ports.work(claimed);
    } catch (err) {
      // A THROWN error is a bug in the stage, not a failed page, and it must
      // still be recorded against the page rather than taking the run down.
      // The message is deliberately generic: a thrown error's own text can
      // carry a connection string, and this string is rendered on a screen.
      outcome = {
        ok: false,
        error: "This page could not be read. Nothing about it was saved. Retry it, and tell C Stream if it keeps failing.",
      };
      console.error("[plan-ingest] stage threw", {
        taskId: claimed.id,
        pageNumber: claimed.pageNumber,
        stage: claimed.stage,
        attempts: claimed.attempts,
        err,
      });
    }

    if (outcome.ok) {
      await ports.finish(claimed, new Date(now()));
      report.done += 1;
      continue;
    }

    const retryAt = exhausted ? null : new Date(now() + backoffFor(claimed.attempts));
    await ports.fail(claimed, outcome.error, retryAt, exhausted);
    if (exhausted) report.exhausted += 1;
    else report.retryable += 1;
  }
}

/**
 * The progress figure, derived from counts and never stored.
 *
 * `settled` is finished plus permanently failed, because a job whose last page
 * has exhausted its attempts is DONE — it is not 99% forever. A progress bar
 * that can never reach its end is a support call, and the failures are visible
 * per page for the person who wants them.
 */
export function ingestProgress(counts: {
  total: number;
  finished: number;
  exhausted: number;
}): { settled: number; percent: number; complete: boolean } {
  const settled = counts.finished + counts.exhausted;
  // A job with no tasks is COMPLETE rather than 0%, and that is the honest
  // answer: there was nothing to do. Guarding the division also stops a
  // zero-page upload rendering NaN% on a screen, which is the shape #526 paid
  // for on a bid total.
  if (counts.total <= 0) return { settled: 0, percent: 100, complete: true };
  return {
    settled,
    percent: Math.floor((settled / counts.total) * 100),
    complete: settled >= counts.total,
  };
}

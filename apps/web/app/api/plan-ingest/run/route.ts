import crypto from "node:crypto";
import { prisma } from "@prova/db";
import { closeIfSettled, claimPorts, hasWaitingWork, ingestCounts } from "@/lib/plan-ingest/claim";
import { DEFAULT_RUN_BUDGET_MS, runIngest, type RunReport } from "@/lib/plan-ingest/runner";
import { stageWork } from "@/lib/plan-ingest/stages";

/**
 * The plan-ingestion worker: the thing that moves a 300-page run along while
 * nobody is looking.
 *
 * WHY A SECOND CRON rather than a branch inside the notifications digest, which
 * is the obvious saving: they have opposite failure modes and opposite budgets.
 * The digest sends irreversible email and its whole design is that a run which
 * dies halfway must not re-send; this one does idempotent work and WANTS to be
 * re-invoked as often as possible. Sharing an invocation would mean one
 * `maxDuration` split between them, so a long ingest would eat the window the
 * digest needs — and a bug in either would take the other down.
 *
 * NOT protected by Clerk — see the note in middleware.ts. A scheduler has no
 * session and never will. It authenticates the request itself, below, the same
 * way `/api/notifications/digest` does.
 *
 * **A GET WITH SIDE EFFECTS**, for the same reason the digest is one: Vercel
 * Cron issues GET and nothing else, so the alternative is no schedule. What
 * makes it defensible here is stronger than it is there — every unit of work is
 * claimed before it is done and recorded when it succeeds, so a second GET a
 * millisecond later finds the claimed rows and does nothing. Re-invocation is
 * not merely safe, it is the mechanism.
 *
 * FAILS CLOSED on a missing `CRON_SECRET`: unset must never mean "the schedule
 * works for everybody". Unlike the digest it needs no base URL, because it sends
 * nothing and links to nothing.
 *
 * **THIS RUNS ONCE A DAY, AND IT IS NOT THE THING THAT MOVES A RUN ALONG.**
 * Measured rather than assumed: a `*​/5 * * * *` schedule FAILED THE DEPLOYMENT,
 * and Vercel's own error link resolves to its cron usage-and-pricing page —
 * Hobby accounts are limited to cron jobs that run once per day, and more
 * frequent expressions fail at deploy time. So this endpoint advances an
 * abandoned run by one slice per day, which is a sweep, not a worker.
 *
 * The work is driven by the OPEN PAGE calling `advancePlanIngest` in a loop
 * (`lib/actions/planIngest.ts` argues it in full), which is what makes ingestion
 * possible at all here. This exists for the one case a browser cannot cover: a
 * run whose tab was closed and which nobody reopens. If that case ever needs to
 * be minutes rather than a day, the fix is a Pro plan and one line in
 * `vercel.json`, not a redesign — the claim column already lets any number of
 * workers advance the same job at once.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sixty seconds is the platform floor across plans. The run's own budget sits
 *  below it — see DEFAULT_RUN_BUDGET_MS for why stopping ourselves beats being
 *  stopped. */
export const maxDuration = 60;

/**
 * How many jobs one invocation will touch.
 *
 * ONE, and the ceiling is deliberate rather than lazy. The run budget is spent
 * per invocation, not per job, so visiting several jobs would split it — and the
 * split is unfair in the worst way: the first job gets most of the window and
 * the last gets whatever is left, every single tick, so a second uploader's plan
 * set is always behind the first one's. One job per tick with oldest-unfinished
 * first is FIFO, which is the fairness people expect from a queue and the only
 * one that does not starve.
 */
const JOBS_PER_RUN = 1;

/**
 * The scheduler proving it is the scheduler.
 *
 * Timing-safe, copied from the digest route and the Resend webhook: a plain
 * `===` on a secret leaks how much of it was right one byte at a time, and this
 * endpoint can be hit as often as anyone likes.
 */
function authorized(request: Request, secret: string): boolean {
  const offered = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return offered.length === expected.length && crypto.timingSafeEqual(offered, expected);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // 503 rather than 500, matching the digest: a configuration state is not a
    // fault, and the scheduler should keep trying once it is set.
    return json({ ok: false, error: "CRON_SECRET is not configured" }, 503);
  }
  if (!authorized(request, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // OLDEST UNFINISHED FIRST, which is what makes this FIFO rather than
  // whichever-row-Postgres-felt-like. `createdAt` then `id`, so the order is
  // TOTAL: two jobs created in the same millisecond must not swap places
  // between ticks, or a budget-truncated sequence visits a different one each
  // time and neither finishes.
  const job = await prisma.planIngestJob.findFirst({
    where: { finishedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, stage: true, companyId: true, planId: true, startedAt: true },
  });

  if (!job) {
    // Nothing to do is the normal state. Reported explicitly rather than as an
    // empty 200, because "the cron ran and there was no work" and "the cron did
    // not run" must not look the same in a log — this repo's own
    // absence-is-not-a-pass rule, applied to an endpoint.
    return json({ ok: true, jobs: 0, note: "no unfinished ingest jobs" });
  }

  // `startedAt` means a worker began, not that a row was written, so it is set
  // HERE on the first tick that picks the job up. Guarded, so a second worker
  // does not move it.
  if (!job.startedAt) {
    await prisma.planIngestJob.updateMany({
      where: { id: job.id, startedAt: null },
      data: { startedAt: new Date() },
    });
  }

  let report: RunReport;
  try {
    report = await runIngest({
      ports: claimPorts({ jobId: job.id, work: stageWork(job.stage) }),
      budgetMs: DEFAULT_RUN_BUDGET_MS,
    });
  } catch (err) {
    // The loop itself failing is a bug rather than a failed page — a page's
    // failure is caught inside `runIngest` and recorded against the row. This
    // arm exists so such a bug reports itself instead of returning a 500 with
    // an empty body, and so the NEXT tick still runs: nothing here is left
    // claimed beyond its lease.
    console.error("[plan-ingest] run threw", { jobId: job.id, stage: job.stage, err });
    return json({ ok: false, error: "the ingest run failed", jobId: job.id }, 500);
  }

  // CLOSED FROM THE ROWS, not from what this invocation happened to do. A loop
  // that closed the job when its own queue ran dry would close it while another
  // worker was still mid-page — see `closeIfSettled`.
  const closed = await closeIfSettled(job.id);
  const counts = await ingestCounts(job.id);

  // `drained` from the loop means "nothing claimable", which is two different
  // facts. Distinguishing them is the difference between a finished job and one
  // whose every remaining page is inside its backoff window.
  const stopped = report.stopped === "drained" && !closed && (await hasWaitingWork(job.id)) ? "blocked" : report.stopped;

  // Ids and counts. Never a file name, never a sheet title, never a company
  // name — the rule every log line in this app follows.
  console.log("[plan-ingest] run", {
    jobId: job.id,
    companyId: job.companyId,
    stage: job.stage,
    ...report,
    stopped,
    closed,
    total: counts.total,
    finished: counts.finished,
    exhausted: counts.exhausted,
  });

  return json({
    ok: true,
    jobs: JOBS_PER_RUN,
    jobId: job.id,
    stage: job.stage,
    ...report,
    stopped,
    closed,
    counts,
  });
}

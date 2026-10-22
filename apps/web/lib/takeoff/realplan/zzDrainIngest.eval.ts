import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { claimPorts } from "@/lib/plan-ingest/claim";
import { DEFAULT_RUN_BUDGET_MS, runIngest } from "@/lib/plan-ingest/runner";
import { stageWork } from "@/lib/plan-ingest/stages";

/**
 * ── DRAINING THE INGEST QUEUE WITHOUT THE HTTP ROUTE ──
 *
 * `POST /api/plan-ingest/run` is how a deployment does this, and it cannot be
 * used here: it is a GET behind `CRON_SECRET`, that secret is not in this
 * machine's `.env`, and the route FAILS CLOSED without it — correctly, since
 * an unset secret must never mean "the schedule is open". Setting it would
 * mean editing `.env` and restarting the server, and the server is in use.
 *
 * So this calls the same `runIngest` with the same ports the route builds, in
 * a loop until nothing is left. It is a local operator's tool, not a test: it
 * only runs when `DRAIN_INGEST=1` is set, so a full suite run never touches
 * the queue.
 *
 *     DATABASE_URL=…local… TAKEOFF_LOCAL_PLAN_DIR=… DRAIN_INGEST=1 \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzDrainIngest.eval.ts
 */
const RUN = process.env.DRAIN_INGEST === "1";
const MAX_ROUNDS = Number(process.env.DRAIN_ROUNDS ?? "400");

describe.skipIf(!RUN)("draining the ingest queue", () => {
  it("runs every pending job to completion", { timeout: 7_200_000 }, async () => {
    const url = process.env.DATABASE_URL ?? "";
    // The same guard every script here carries: this writes, and it has no
    // business doing that to anything but a local database.
    expect(/127\.0\.0\.1|localhost/.test(url), "DATABASE_URL is not local").toBe(true);

    let rounds = 0;
    let drained = 0;
    const started = Date.now();
    for (; rounds < MAX_ROUNDS; rounds += 1) {
      // ── PICK A JOB THAT STILL HAS WORK, NOT ONE THAT IS MERELY UNFINISHED ──
      //
      // Selecting on `finishedAt: null` returns the same job for ever: its
      // tasks all complete, nothing marks the JOB finished, and `runIngest`
      // then reports zero done — which the loop below reads as "nothing left"
      // and stops on, after one set of twelve. Asking for a job with a
      // PENDING TASK is the question that was meant.
      const job = await prisma.planIngestJob.findFirst({
        where: { tasks: { some: { finishedAt: null } } },
        orderBy: { createdAt: "asc" },
        include: { plan: { select: { jobId: true } } },
      });
      if (job === null) break;
      const report = await runIngest({
        ports: claimPorts({
          jobId: job.id,
          work: stageWork(job.stage, {
            planId: job.planId,
            companyId: job.companyId,
            ingestJobId: job.id,
            jobId: job.plan.jobId,
            startedByUserId: job.startedByUserId,
          }),
        }),
        budgetMs: DEFAULT_RUN_BUDGET_MS,
      });
      drained += report.done;
      if (rounds % 10 === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `  round ${rounds}: job ${job.id.slice(0, 8)} stage ${job.stage}, ` +
            `${report.done} done, ${report.retryable} retry, ${report.exhausted} exhausted, ${drained} total ` +
            `(${Math.round((Date.now() - started) / 1000)}s)`,
        );
      }
      // A round that moved nothing means every remaining task is leased,
      // failed past its attempts, or waiting on something this loop cannot
      // provide. Spinning on it would be a silent infinite loop.
      if (report.done === 0 && report.retryable === 0 && report.exhausted === 0) break;
    }

    const left = await prisma.planIngestTask.count({ where: { finishedAt: null } });
    // eslint-disable-next-line no-console
    console.log(
      `\n${drained} tasks completed over ${rounds} rounds, ${left} tasks still pending`,
    );
    // The input resolved: a run against a database with nothing queued did no
    // work, and reporting that as a clean drain is how twelve sets looked
    // ingested while none of them had been.
    const jobs = await prisma.planIngestJob.findMany({ select: { id: true } });
    expect(jobs.length, "no ingest job exists at all — nothing was ever queued").toBeGreaterThan(0);
    expect(rounds, "the loop never ran — there was nothing left to do").toBeGreaterThan(0);
  });
});

"use server";

import { prisma, type PlanIngestStage } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { pdfPageCount } from "@/lib/ask/pageCount";
import { claimPorts, closeIfSettled, ingestViewOf } from "@/lib/plan-ingest/claim";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { runIngest, MAX_ATTEMPTS, type IngestView } from "@/lib/plan-ingest/runner";
import { isRunnableStage, stageWork, STAGE_SPENDS } from "@/lib/plan-ingest/stages";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "./shared";

/**
 * Starting, advancing and retrying a plan-ingestion run.
 *
 * WHY THE BROWSER DRIVES THIS AND THE CRON IS ONLY A SAFETY NET — the decision
 * worth reading, because it is the opposite of how the notifications digest
 * works and the reason is not obvious.
 *
 * A cron's interval bounds throughput, and on THIS project the interval is once
 * per day. That is not a guess and not a preference — it is measured: pushing a
 * `*​/5 * * * *` schedule failed the deployment outright, and Vercel's own error
 * link resolves to its cron usage-and-pricing page, which says Hobby accounts
 * "are limited to cron jobs that run once per day" and that more frequent
 * expressions "will fail during deployment". 100 jobs per project, minimum
 * interval once per day.
 *
 * So a cron-driven runner would advance a 300-page plan set by one 45-second
 * slice per DAY. The design below is not an optimisation; it is the only version
 * of this feature that works on the plan this product is on.
 *
 * So `advancePlanIngest` is a Server Action the OPEN PAGE calls in a loop. The
 * work happens while somebody is watching it, at whatever rate the work allows,
 * on any plan. The cron then exists for the one thing the browser cannot do:
 * finish a run whose page was closed halfway.
 *
 * WHAT MAKES THAT SAFE IS THE CLAIM COLUMN, and this is where it earns its keep
 * twice over. The browser, a second browser and the cron can all be advancing
 * the same job simultaneously; each claim is atomic, so no page is done twice
 * and no invocation needs to know about the others. A design where the browser
 * "owned" the run would need a lock, a lease on the lock, and a way to tell a
 * dead tab from a slow one — which is the same problem again, one level up.
 *
 * THE CAPABILITY IS `VIEW_JOB_COSTS`, AND THE FIRST VERSION OF THIS FILE GOT IT
 * WRONG. It asserted `MANAGE_ESTIMATING`, which sounds right for a plan set and
 * is not the capability the door takes: `/jobs/[id]/takeoff` is hard-gated on
 * `VIEW_JOB_COSTS`, and its own header says "one gate, one door" because a second
 * capability on that page would make every action behind it ambiguous to the
 * census. Asserting the tidier-sounding one would have refused an estimator who
 * can open the page and answered somebody who cannot — issue #383's exact shape.
 *
 * `lib/action-capability-guards.test.ts` named all four actions and the page they
 * are reachable from, which is how this was caught rather than shipped. Every
 * action asserts it rather than trusting the page, because a Server Action is a
 * separate endpoint with a stable id that answers whoever posts to it.
 */

const NOT_YOURS =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** One page that failed for the last time, as the panel lists it. A named type
 *  rather than an inline shape so the guard in `planIngestFailures` fits on one
 *  line: `action-capability-guards.test.ts` reads the guard as source text, and a
 *  return type long enough to wrap pushed the `can(...)` onto its own line where
 *  the census could not see it. Found by that suite naming the action. */
export type FailedPage = { pageNumber: number; attempts: number; error: string | null };

/** The plan set, proved to belong to the caller's company. Returns null rather
 *  than throwing, so every caller can put a sentence on screen. */
async function planInCompany(planId: string, companyId: string) {
  return prisma.takeoffPlan.findFirst({
    where: { id: planId, companyId },
    select: { id: true, jobId: true, companyId: true },
  });
}

/**
 * Create a run over the set's pages, or hand back the one already running.
 *
 * THE SERVER COUNTS THE PAGES NOW, and this used to take the count as an argument
 * because "the server has no PDF library to read one with". That was never true:
 * `lib/ask/pageCount.ts` has counted PDF pages server-side for billing since it was
 * written — a regex over the page tree with a `zlib.inflateSync` pass for PDF 1.5
 * object streams, no pdfjs and no canvas.
 *
 * WHAT THE BROWSER ACTUALLY PASSED WAS WORSE THAN A GUESS. The takeoff page handed
 * over `plan.pages.length` — the number of `TakeoffPlanPage` rows, which exist only
 * for sheets somebody has already CALIBRATED. On a freshly uploaded set that is
 * zero, so the button was disabled and the panel said "open this plan set in the
 * viewer first", which is not a thing anybody needed to do and not what the message
 * described. Diego hit exactly that on 2026-09-27.
 *
 * So the count comes out of the file. It is still bounded, because a file can lie
 * about its own page tree and 2,000 task rows is the ceiling either way.
 */
export async function startPlanIngest(planId: string, stage: PlanIngestStage): Promise<ActionResultWith<IngestView>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS) as ActionResultWith<IngestView>;
  const companyId = context.company.id;

  const plan = await planInCompany(planId, companyId);
  if (!plan) return { ok: false, error: "That plan set could not be found." };

  if (!isRunnableStage(stage)) {
    // REFUSED UP FRONT rather than one page at a time. A job created for an
    // unbuilt stage would claim every page, fail on each, and spend three
    // attempts per page before reporting anything — three hundred pages of
    // failure to say "not built yet". `stageWork` refuses too; this is the
    // first of the two, and the one a person sees.
    return { ok: false, error: "That kind of plan reading isn't built yet." };
  }

  const file = await readPlanBytes(planId, companyId);
  if (!file.ok) return { ok: false, error: file.error };

  const pageCount = pdfPageCount(file.bytes);
  if (pageCount === null) {
    // `pdfPageCount` returns null when the page tree cannot be read, which is a
    // real state rather than a fault — the same one the Ask box charges a flat ten
    // pages for. Here there is nothing to charge and nothing to enumerate, so it
    // refuses and says which file to look at rather than starting a run over a
    // number nobody could verify.
    return {
      ok: false,
      error: "C Stream couldn't read how many sheets are in that file, so nothing was started. It may not be a PDF, or it may be damaged.",
    };
  }
  // Still bounded, because a file can lie about its own page tree. Zero is
  // legitimate — an empty PDF is reachable — and produces a job that completes
  // immediately, which `ingestProgress` calls 100% rather than dividing by zero.
  if (pageCount > 2_000) {
    return { ok: false, error: `That file says it has ${pageCount} sheets, which is more than one plan set can hold.` };
  }

  // AN UNFINISHED RUN IS REUSED, NOT DUPLICATED. Two people opening the same
  // plan set would otherwise create two jobs over the same pages, and the
  // progress figure would be over whichever one was queried — a bar that jumps
  // backwards depending on who is looking.
  const existing = await prisma.planIngestJob.findFirst({
    where: { planId, stage, finishedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, stage: true },
  });
  if (existing) return { ok: true, value: await ingestViewOf(existing.id, existing.stage) };

  const created = await prisma.$transaction(async (tx) => {
    const job = await tx.planIngestJob.create({
      data: { planId, companyId, stage, pageCount, startedByUserId: context.id },
      select: { id: true, stage: true },
    });
    if (pageCount > 0) {
      await tx.planIngestTask.createMany({
        data: Array.from({ length: pageCount }, (_, index) => ({
          jobId: job.id,
          pageNumber: index + 1,
          stage,
        })),
      });
    }
    return job;
  });

  // NO `revalidatePath` HERE, AND THAT IS A FIX RATHER THAN AN OMISSION.
  //
  // Found by a person clicking this, on 2026-09-27: starting a run made the
  // plan viewer jump from the sheet they were working on back to sheet 1 of 12.
  // The mechanism is the one #61's investigation established and CLAUDE.md
  // records — `revalidatePath` sets `pathWasRevalidated` UNCONDITIONALLY, the
  // path argument is irrelevant, so flight data is appended and the client
  // re-renders FROM THE ROOT. That remounts `TakeoffPlanViewer`, whose selected
  // `pageNumber` is component state, and the estimator loses their place.
  //
  // Nothing needs the revalidation: the panel takes the run's state from this
  // function's own return value, and no other part of the page renders ingest
  // state. A revalidate here bought a re-render nobody asked for and cost the
  // one thing the person was looking at.
  return { ok: true, value: await ingestViewOf(created.id, created.stage) };
}

/**
 * Do one slice of work and report where the run got to.
 *
 * CALLED IN A LOOP BY THE OPEN PAGE. Its budget is deliberately far below the
 * cron's: a Server Action holds the person's request open, so a 45-second one
 * would look like a hung page. Several short slices give the progress bar
 * something to show and let the person navigate away between them — and
 * navigating away mid-slice costs nothing, because the claim lapses and the
 * cron or the next visit picks it up.
 */
export async function advancePlanIngest(ingestJobId: string): Promise<ActionResultWith<IngestView>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS) as ActionResultWith<IngestView>;

  // SCOPED TO THE CALLER'S COMPANY, from the session rather than the argument.
  // The id in the argument is a claim; this is the check. Without it the action
  // would advance any company's run for anybody who knew an id.
  const job = await prisma.planIngestJob.findFirst({
    where: { id: ingestJobId, companyId: context.company.id },
    // `plan.jobId` comes along because a stage records its spend against the
    // construction job (`AskUsage.jobId`), and looking it up inside the per-page
    // work would be one query per page — three hundred on a set.
    select: {
      id: true,
      stage: true,
      startedAt: true,
      planId: true,
      startedByUserId: true,
      plan: { select: { jobId: true } },
    },
  });
  if (!job) return { ok: false, error: "That plan reading could not be found." };

  if (!job.startedAt) {
    await prisma.planIngestJob.updateMany({
      where: { id: job.id, startedAt: null },
      data: { startedAt: new Date() },
    });
  }

  try {
    await runIngest({
      ports: claimPorts({
        jobId: job.id,
        work: stageWork(job.stage, {
          planId: job.planId,
          companyId: context.company.id,
          ingestJobId: job.id,
          jobId: job.plan.jobId,
          startedByUserId: job.startedByUserId,
        }),
      }),
      // Five seconds. Short enough that the page stays responsive, long enough
      // that a slice is worth the round trip.
      budgetMs: 5_000,
    });
  } catch (err) {
    // A page's own failure is caught inside `runIngest` and recorded against
    // its row; reaching here means the loop itself broke, which is a bug. The
    // sentence is generic because a thrown error's text can carry a connection
    // string and this reaches a screen.
    console.error("[plan-ingest] advance threw", { jobId: job.id, stage: job.stage, err });
    return { ok: false, error: "Reading this plan set stopped unexpectedly. Nothing was lost — try again." };
  }

  await closeIfSettled(job.id);
  return { ok: true, value: await ingestViewOf(job.id, job.stage) };
}

/**
 * Give one failed page another go — how many depends on whether the stage spends.
 *
 * THIS USED TO RESET `attempts` TO 0 FOR EVERY STAGE, and the reasoning was sound
 * when every stage was free: the ceiling exists to stop an automatic loop spending
 * without end, a person clicking Retry is not that loop, and "decrementing by one
 * would give them a single try and then refuse again with the same message, which
 * reads as a broken button."
 *
 * `TITLE_BLOCK` made it wrong. It claims a plan sheet before each model call, so a
 * full reset turns ONE CLICK INTO THREE PAID ATTEMPTS — and because each retry reset
 * the counter again, there was no ceiling at all. A page could be charged without
 * limit, with nothing on screen saying it cost anything.
 *
 * So `STAGE_SPENDS` decides: a free stage still gets its three back, and a paid one
 * gets ONE attempt per click. The "broken button" objection is answered by the button
 * saying what it costs rather than by quietly buying two more tries.
 *
 * It refuses a page that is currently being worked on rather than yanking the
 * claim out from under a live worker — the one case where a person's click and
 * the machinery genuinely conflict.
 */
export async function retryPlanIngestPage(ingestJobId: string, pageNumber: number): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);

  const job = await prisma.planIngestJob.findFirst({
    where: { id: ingestJobId, companyId: context.company.id },
    select: { id: true, stage: true, planId: true, plan: { select: { jobId: true } } },
  });
  if (!job) return actionFail("That plan reading could not be found.");

  const at = new Date();
  // A paid stage gets exactly one more attempt, so the click and the charge are one
  // to one and the ceiling cannot be reset away. A free one gets the full three.
  const attempts = STAGE_SPENDS[job.stage] ? MAX_ATTEMPTS - 1 : 0;
  const reset = await prisma.planIngestTask.updateMany({
    where: {
      jobId: job.id,
      pageNumber,
      finishedAt: null,
      // Not currently held by a live worker. `claimExpiresAt` in the past is
      // fair game — that worker is gone.
      OR: [{ claimedAt: null }, { claimExpiresAt: { lt: at } }],
    },
    data: { attempts, error: null, claimedAt: null, claimExpiresAt: null, nextAttemptAt: null },
  });

  if (reset.count !== 1) {
    // Three states share this sentence on purpose: already finished, being read
    // right now, or no such page. All three mean "there is nothing for you to
    // retry", and distinguishing them on screen would be three messages for one
    // decision the person does not have to make.
    return actionFail("That page is either already read or being read right now, so there was nothing to retry.");
  }

  // A job closed because every page had failed must REOPEN when one is retried,
  // or the run is complete with work outstanding and no tick will ever visit it.
  await prisma.planIngestJob.updateMany({
    where: { id: job.id, finishedAt: { not: null } },
    data: { finishedAt: null },
  });

  // No `revalidatePath`, for the same reason as `startPlanIngest` above: it
  // would re-render from the root and throw the viewer back to sheet 1. The
  // panel drops the retried page from its own list and resumes the loop.
  return actionOk;
}

/** Every failed page of a run, for the panel's retry list. */
export async function planIngestFailures(ingestJobId: string): Promise<ActionResultWith<FailedPage[]>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS) as ActionResultWith<FailedPage[]>;

  const job = await prisma.planIngestJob.findFirst({
    where: { id: ingestJobId, companyId: context.company.id },
    select: { id: true },
  });
  if (!job) return { ok: false, error: "That plan reading could not be found." };

  const failures = await prisma.planIngestTask.findMany({
    where: { jobId: job.id, finishedAt: null, attempts: { gte: MAX_ATTEMPTS } },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true, attempts: true, error: true },
  });
  return { ok: true, value: failures };
}

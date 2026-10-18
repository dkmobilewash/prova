import type { PlanIngestStage } from "@prova/db";
import type { RunnerPorts } from "./runner";
import { STAGE_SPENDS } from "./stageCost";
import { pageInventoryWork } from "./pageInventory";
import { titleBlockWork } from "./titleBlock";
import { scheduleRowsWork } from "./scheduleRows";

/**
 * What each stage's per-page work actually is.
 *
 * TWO STAGES ARE IMPLEMENTED, and the split between them is where the money is.
 * `PAGE_INVENTORY` reads the PDF and calls no model; `TITLE_BLOCK` calls the model
 * and never opens the PDF. `pageInventory.ts` argues that at length — in short, a
 * stage doing both is paced by the model, which means one or two pages a slice and
 * the whole file refetched for each pair.
 *
 * THIS HEADER SAID THE OPPOSITE UNTIL 2026-09-29, and the correction is worth
 * keeping rather than quietly replacing. It read: "the server GENUINELY CANNOT do
 * more than this yet… a server-side stage cannot open the file at all until
 * something rasterises it… any stage that claims to read a page today would be
 * claiming something this process cannot do."
 *
 * Every part of that was wrong, and it is why `PAGE_INVENTORY` shipped as
 * `async () => ({ ok: true })`. It conflated READING a PDF with RASTERISING one:
 * `lib/ask/pageCount.ts` had been parsing PDFs server-side for billing the whole
 * time, and `pdfjs-dist` in Node gives page count, sheet size, rotation and
 * positioned text. Only `page.render()` needs a canvas, and nothing here calls it.
 *
 * The sentence was not careless — it cited `TakeoffPlan`'s own comment, which said
 * the same thing. That is what made it expensive: a false claim with a citation
 * reads as settled, and it deferred three stages for a fortnight. Both are corrected
 * now, and `planPdf.ts` carries the measurements rather than an assertion.
 *
 * WHAT THIS IS NOT: a placeholder to be filled in. `CLASSIFY` and `SHEET_INDEX`
 * stay null for reasons given on `STAGE_WORK` itself, and neither is "not got round
 * to yet".
 */

/** A stage's work, or null when that stage is not built. */
export type StageWork = RunnerPorts["work"];

/**
 * WHICH RUN a stage's work is for.
 *
 * `ClaimedTask` carries only `{id, pageNumber, stage, attempts}` — nothing about
 * the plan, the company or the job — because `runner.ts` and `claim.ts` are built
 * to know nothing about what a page's work IS. That property is worth keeping, so
 * the run's identity arrives the other way: `claimPorts({jobId, work})` takes
 * `work` as an injected value, and both call sites already hold the job row. A
 * stage is therefore a FACTORY over this, and the closure it returns is a
 * per-invocation cache — which is what lets `PAGE_INVENTORY` open one PDF and
 * serve many pages from it without `runner.ts` learning that PDFs exist.
 *
 * `ingestJobId` is here because a `PlanSheetProposal` is keyed on the RUN, not on
 * the page — see that model's header for why a re-run must not overwrite a
 * proposal somebody has already accepted beside.
 */
export type StageCtx = {
  planId: string;
  companyId: string;
  ingestJobId: string;
  /** The construction JOB the plan set belongs to — not the ingest job. Carried
   *  because `AskUsage.jobId` is what makes "which jobs is this AI bill going on"
   *  answerable, and looking it up inside the work would be one query per page. */
  jobId: string;
  /** Who started the run, for the spend ledger. NULL ON THE CRON, which has no
   *  person — the first caller in this app for which that is the real case rather
   *  than a nullable column being polite. */
  startedByUserId: string | null;
};

/**
 * A total `Record` over the enum, so adding a stage without deciding what it
 * does fails to compile — the shape #526 landed for `CostCategory` after a
 * missing member produced a NaN bid total from an unwired index. A stage with no
 * entry would otherwise create claimable tasks that nothing can ever do, and a
 * job stuck at 99% with one invisible task is indistinguishable from a job that
 * finished.
 *
 * `CLASSIFY` STAYS NULL ON PURPOSE and is not an omission. Reading the title block
 * yields the sheet number, the title AND the discipline, which is the
 * classification — so building both stages would mean two paid model calls per
 * page for one answer. `SHEET_INDEX` stays null for a different reason: ordering
 * sheets, spotting duplicate numbers and flagging gaps is pure computation over
 * rows that are already there, so it belongs in a read-time module like
 * `lib/intake/review.ts` rather than in a per-page job. As a stage it would either
 * run three hundred times over the same set or need a one-task job, and
 * `PlanIngestJob.pageCount` exists precisely to be compared against the task count.
 */
const STAGE_WORK: Record<PlanIngestStage, ((ctx: StageCtx) => StageWork) | null> = {
  PAGE_INVENTORY: pageInventoryWork,
  CLASSIFY: null,
  TITLE_BLOCK: titleBlockWork,
  SCHEDULE_ROWS: scheduleRowsWork,
  SHEET_INDEX: null,
};

export { STAGE_SPENDS };

/** Which stages a run may actually be started for. Derived, so it cannot
 *  disagree with the map above. */
export const RUNNABLE_STAGES: PlanIngestStage[] = (
  Object.keys(STAGE_WORK) as PlanIngestStage[]
).filter((stage) => STAGE_WORK[stage] !== null);

export function isRunnableStage(stage: PlanIngestStage): boolean {
  return STAGE_WORK[stage] !== null;
}

/**
 * The work for one stage.
 *
 * RETURNS A REFUSAL RATHER THAN THROWING for an unbuilt stage, and the sentence
 * is one a person can act on. A job created for `CLASSIFY` today would otherwise
 * claim every page, throw on each, and exhaust three attempts per page before
 * reporting anything — three hundred pages of failure to say "not built yet".
 * `startPlanIngest` refuses such a job up front; this is the second of the two,
 * because the first one is the kind of check that gets bypassed by a backfill
 * script.
 */
export function stageWork(stage: PlanIngestStage, ctx: StageCtx): StageWork {
  const build = STAGE_WORK[stage];
  if (build) return build(ctx);
  return async () => ({
    ok: false,
    error: "This kind of plan reading isn't built yet, so nothing was read. Nothing about this page was changed.",
  });
}

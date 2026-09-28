import type { PlanIngestStage } from "@prova/db";
import type { RunnerPorts } from "./runner";
import { pageInventoryWork } from "./pageInventory";
import { titleBlockWork } from "./titleBlock";

/**
 * What each stage's per-page work actually is.
 *
 * ONE STAGE IS IMPLEMENTED AND IT DELIBERATELY DOES NOTHING, which is the part
 * of this PR most likely to be read as an oversight, so it is stated plainly
 * here rather than defended later.
 *
 * `PAGE_INVENTORY` records that a page was reached and nothing else. It makes no
 * model call, reads no PDF and writes no domain row. Its output is the RUN — the
 * task rows, their claims, their attempts, the progress derived from them — and
 * that is the whole point of shipping it before ingestion: a 300-page run's
 * resumability, its attempt ceiling, its backoff and its stuck-lease reclaim are
 * all properties of the machinery, not of the work, and they are far cheaper to
 * get wrong here than three hundred paid calls later.
 *
 * AND THE SERVER GENUINELY CANNOT DO MORE THAN THIS YET, which is worth knowing
 * before somebody tries to make this stage useful. `TakeoffPlan`'s own schema
 * comment says there is no `pageCount` column because "the server has no PDF
 * library to read it with" — the viewer knows the count because it renders the
 * document with `pdfjs-dist` in the BROWSER. So a server-side stage cannot open
 * the file at all until something rasterises it, which is the rasterisation
 * question the step-1 plan flagged as the one genuinely undecided piece. Any
 * stage that claims to read a page today would be claiming something this
 * process cannot do.
 *
 * WHAT THIS IS NOT: a placeholder to be filled in. When `CLASSIFY` lands it
 * gets its own entry here, gated on `PLAN_INGESTION` through `aiGate` — the
 * feature key #533 put in the enum ahead of the feature precisely so it would
 * not be retrofitted onto a call site afterwards. `PAGE_INVENTORY` stays a
 * no-op, because "did the runner reach every page" stays worth being able to
 * ask on its own.
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
  SHEET_INDEX: null,
};

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

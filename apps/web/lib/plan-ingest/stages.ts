import type { PlanIngestStage } from "@prova/db";
import type { RunnerPorts } from "./runner";

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
 * A total `Record` over the enum, so adding a stage without deciding what it
 * does fails to compile — the shape #526 landed for `CostCategory` after a
 * missing member produced a NaN bid total from an unwired index. A stage with no
 * entry would otherwise create claimable tasks that nothing can ever do, and a
 * job stuck at 99% with one invisible task is indistinguishable from a job that
 * finished.
 */
const STAGE_WORK: Record<PlanIngestStage, StageWork | null> = {
  // Succeeds for every page, having done nothing. See the header.
  PAGE_INVENTORY: async () => ({ ok: true }),
  CLASSIFY: null,
  TITLE_BLOCK: null,
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
export function stageWork(stage: PlanIngestStage): StageWork {
  const work = STAGE_WORK[stage];
  if (work) return work;
  return async () => ({
    ok: false,
    error: "This kind of plan reading isn't built yet, so nothing was read. Nothing about this page was changed.",
  });
}

/**
 * ── WHERE "NEW JOB" GOES ──
 *
 * The dashboard and the top bar both start a job here. For someone who can open the Takeoff tab
 * (VIEW_JOB_COSTS, its gate) the wizard carries `then=plans`, and creating the job lands on the
 * job's Takeoff tab — the stepper with the plan uploader — instead of the scope-items step: a new
 * bid starts from its drawings. Anyone else gets the wizard as it was, since the tab would refuse them.
 */
export const NEW_JOB_LABEL = "New job";

export function newJobHref(canOpenTakeoff: boolean): string {
  return canOpenTakeoff ? "/jobs/new?then=plans" : "/jobs/new";
}

/** Every route the job tab row can show, as app-router patterns. The
 * reachability census (lib/reachabilityCensus.test.ts) reads this list. */
export const JOB_TAB_ROUTES = [
  "/jobs/[id]",
  "/jobs/[id]/estimate",
  "/jobs/[id]/takeoff",
  "/jobs/[id]/crew",
  "/jobs/[id]/compliance",
  "/jobs/[id]/billing",
  "/jobs/[id]/retainage",
  "/jobs/[id]/field-reports",
  "/jobs/[id]/photos",
] as const;

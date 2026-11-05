import { estimateStage } from "@/lib/estimate-stage";

/**
 * ── THE ESTIMATING STEPS OF ONE JOB: Job → Plans → Scale → Takeoff → Review →
 * Estimate → Send ──
 *
 * A slim bar on the job page while the job is an estimate, so a new user can
 * see where the job is and what to do next. It is NOT a locked wizard: every
 * step is a link, and a job priced without any plans is still a job whose
 * estimate is done. Pure, and derived on every render from rows that already
 * exist — the same rule as `estimateStage`, which it reuses for the last two
 * steps so this bar and the jobs list cannot disagree about "sent".
 *
 * What each step's DONE means, in the facts it reads:
 *   - Job      — the job exists (always).
 *   - Plans    — a plan set is uploaded.
 *   - Scale    — at least one sheet has a scale.
 *   - Takeoff  — something is measured on the job's plans.
 *   - Review   — something is measured AND no wall is left "to confirm".
 *   - Estimate — the estimate has a line (`estimateStage` past NEEDS_PRICING).
 *   - Send     — a signing link has gone to the client (a signature request,
 *                OUT_FOR_SIGNATURE or SIGNED), made on the job overview.
 *
 * CURRENT is the first step not done AFTER the furthest one that is, so a job
 * typed straight into the estimate is "on" Send, not sent back to Plans.
 * Steps before it that were skipped read "not started", which is the truth.
 */
export type JobStepKey = "job" | "plans" | "scale" | "takeoff" | "review" | "estimate" | "send";
export type JobStepState = "done" | "current" | "todo";
export type JobStep = {
  key: JobStepKey;
  label: string;
  href: string;
  /** Opens in its own tab (the full-screen takeoff workspace). */
  newTab: boolean;
  state: JobStepState;
};
export type JobStepFacts = {
  jobId: string;
  hasPlan: boolean;
  scaledSheets: number;
  measurements: number;
  /** Walls the model held off the estimate, still waiting for a person. */
  wallsToConfirm: number;
  lineItemCount: number;
  signatureStatuses: string[];
};
export type JobNext = { label: string; href: string; newTab: boolean } | null;

const LABELS: Record<JobStepKey, string> = {
  job: "Job",
  plans: "Plans",
  scale: "Scale",
  takeoff: "Takeoff",
  review: "Review",
  estimate: "Estimate",
  send: "Send",
};

export function jobSteps(facts: JobStepFacts): { steps: JobStep[]; next: JobNext } {
  const job = `/jobs/${facts.jobId}`;
  const workspace = `/takeoff/${facts.jobId}`;
  const stage = estimateStage(facts.lineItemCount, facts.signatureStatuses).key;
  const done: Record<JobStepKey, boolean> = {
    job: true,
    plans: facts.hasPlan,
    scale: facts.scaledSheets > 0,
    takeoff: facts.measurements > 0,
    review: facts.measurements > 0 && facts.wallsToConfirm === 0,
    estimate: stage !== "NEEDS_PRICING",
    send: stage === "OUT_FOR_SIGNATURE" || stage === "SIGNED",
  };
  const where: Record<JobStepKey, { href: string; newTab: boolean }> = {
    job: { href: job, newTab: false },
    plans: { href: `${job}/takeoff`, newTab: false },
    scale: { href: `${job}/takeoff`, newTab: false },
    takeoff: { href: workspace, newTab: true },
    review: { href: workspace, newTab: true },
    estimate: { href: `${job}/estimate`, newTab: false },
    // Where a job is SENT today: a signing link for the client, on the
    // overview. The proposal page prints and packages the bid but has no send
    // (the new-job walkthrough found it a dead end), and "sent" is read off the
    // signature requests, so the step goes where one is made.
    send: { href: `${job}#contract-signature`, newTab: false },
  };
  const order = Object.keys(LABELS) as JobStepKey[];
  const furthest = order.reduce((at, key, i) => (done[key] ? i : at), 0);
  const currentAt = order.findIndex((key, i) => i > furthest && !done[key]);
  const steps = order.map((key, i) => ({
    key,
    label: LABELS[key],
    ...where[key],
    state: (done[key] ? "done" : i === currentAt ? "current" : "todo") as JobStepState,
  }));

  if (currentAt === -1) return { steps, next: null };
  const key = order[currentAt]!;
  const NEXT: Record<JobStepKey, string> = {
    job: "Open the job",
    plans: "Upload the plans",
    scale: "Set the scale",
    takeoff: "Run the takeoff",
    review:
      facts.wallsToConfirm > 0
        ? `Review ${facts.wallsToConfirm} ${facts.wallsToConfirm === 1 ? "wall" : "walls"} to confirm`
        : "Review the takeoff",
    // Estimate is only ever current once something is taken off (Review needs
    // it), and those quantities go on from the workspace's item panel ("Send to
    // estimate") — so its Next opens the workspace, while the step itself still
    // links to the estimate tab, where pricing by hand happens.
    estimate: "Put the takeoff on the estimate",
    send: "Send it for signature",
  };
  const goes = key === "estimate" ? { href: workspace, newTab: true } : where[key];
  return { steps, next: { label: NEXT[key], ...goes } };
}

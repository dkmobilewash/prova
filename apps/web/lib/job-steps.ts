import { estimateStage } from "@/lib/estimate-stage";
import { reviewLabel } from "@/lib/takeoff/reviewQueue";

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
 *   - Scale    — every FLOOR PLAN has a scale (the plan set's sort,
 *                `lib/takeoff/planSet.ts`); with none recognised yet, any sheet.
 *   - Takeoff  — something is measured on the job's plans.
 *   - Review   — something is measured AND the job's one review queue is
 *                empty: no wall to confirm, no untyped wall group, no floor
 *                plan without a scale, no unpriced line (`reviewQueue.ts`).
 *   - Estimate — the estimate has lines (`estimateStage` past NEEDS_PRICING)
 *                and NONE is unpriced: a line with neither a price nor a
 *                cost is not an estimate, it is footage (Diego, Chrome's
 *                re-test: a $0.00 bid read "Next: Send it for signature").
 *   - Send     — a signing link has gone to the client (a signature request,
 *                OUT_FOR_SIGNATURE or SIGNED), made on the job overview.
 *
 * CURRENT is the first step not done AFTER the furthest one that is, so a job
 * typed straight into the estimate is "on" Send, not sent back to Plans.
 * Steps before it that were skipped read "not started", which is the truth.
 * EXCEPT REVIEW: once something is taken off, Review comes before Estimate
 * and Send, so what is left to review is never jumped over.
 *
 * Scale, Takeoff and Review open the workspace on the right sheet
 * (`?open=scale` / `?open=review`, chosen in `startPage.ts`), never a cover.
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
  /** Sheets the plan set sorts as floor plans, and how many of them have a scale. */
  floorPlans: number;
  floorPlansScaled: number;
  measurements: number;
  /** Items left in the job's review queue (`reviewQueue.ts`). */
  toReview: number;
  lineItemCount: number;
  /** Lines with neither a price nor a cost. */
  unpricedLines: number;
  signatureStatuses: string[];
  /** Asked its trade at signup and its own markup still not all set (`markupNeeded`). */
  markupNeeded: boolean;
  /** The proposal says what is in the number and what is not: at least one inclusion and one exclusion. */
  clausesReady: boolean;
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
    scale: facts.floorPlans > 0 ? facts.floorPlansScaled === facts.floorPlans : facts.scaledSheets > 0,
    takeoff: facts.measurements > 0,
    review: facts.measurements > 0 && facts.toReview === 0,
    estimate: stage !== "NEEDS_PRICING" && facts.unpricedLines === 0 && !facts.markupNeeded,
    send: stage === "OUT_FOR_SIGNATURE" || stage === "SIGNED",
  };
  const where: Record<JobStepKey, { href: string; newTab: boolean }> = {
    job: { href: job, newTab: false },
    // Both land on the plan set: the sheets sorted, their scales, Confirm scales.
    plans: { href: `${job}/takeoff#plan-set`, newTab: false },
    scale: { href: `${job}/takeoff#plan-set`, newTab: false },
    takeoff: { href: workspace, newTab: true },
    review: { href: `${workspace}?open=review`, newTab: true },
    estimate: { href: `${job}/estimate`, newTab: false },
    // Where a job is SENT today: a signing link for the client, on the
    // overview. The proposal page prints and packages the bid but has no send
    // (the new-job walkthrough found it a dead end), and "sent" is read off the
    // signature requests, so the step goes where one is made.
    send: { href: `${job}#contract-signature`, newTab: false },
  };
  const order = Object.keys(LABELS) as JobStepKey[];
  const furthest = order.reduce((at, key, i) => (done[key] ? i : at), 0);
  const currentAt = done.takeoff && !done.review ? order.indexOf("review") : order.findIndex((key, i) => i > furthest && !done[key]);
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
    // Names the floor plans whenever the set has any: "Confirm the scales"
    // read as done once the sure sheets were confirmed and none of them was a
    // floor plan (the new-customer run on Baker).
    scale:
      facts.floorPlans > 0
        ? `Scale ${facts.floorPlans - facts.floorPlansScaled} ${facts.floorPlansScaled > 0 ? "more " : ""}floor plan${facts.floorPlans - facts.floorPlansScaled === 1 ? "" : "s"}`
        : "Confirm the scales",
    takeoff: "Run the takeoff",
    review: facts.toReview > 0 ? reviewLabel(facts.toReview) : "Review the takeoff",
    // Estimate is only ever current once something is taken off (Review needs
    // it), and those quantities go on from the workspace's item panel ("Send to
    // estimate") — so its Next opens the workspace, while the step itself still
    // links to the estimate tab, where pricing by hand happens.
    estimate:
      facts.lineItemCount === 0
        ? "Put the takeoff on the estimate"
        : facts.unpricedLines > 0
          ? `Price ${facts.unpricedLines} ${facts.unpricedLines === 1 ? "line" : "lines"} on the estimate`
          : "Set your markup",
    // A proposal with no inclusions or exclusions reaches the GC as a price
    // and a list of lines; the step still links to the signing link, and
    // Next asks for the clauses first (the guided flow's Send).
    send: facts.clausesReady ? "Send it for signature" : "Add inclusions and exclusions",
  };
  const goes =
    key === "estimate" && facts.lineItemCount === 0
      ? { href: workspace, newTab: true }
      : key === "send" && !facts.clausesReady
        ? { href: `${job}/proposal#clauses`, newTab: false }
        : where[key];
  return { steps, next: { label: NEXT[key], ...goes } };
}

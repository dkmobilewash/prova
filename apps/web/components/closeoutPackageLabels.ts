/** Wording for closeout readiness and the package's trip to the GC.
 *
 * Only wording. Every figure and every state comes from
 * lib/closeout-readiness.ts, so the sentence on a job card and the count
 * in the page header can't disagree — which is how a page ends up telling
 * two stories about the same job. */

import type { CloseoutBlocker, CloseoutStage } from "@/lib/closeout-readiness";

export function stageLabel(stage: CloseoutStage) {
  switch (stage) {
    case "NOT_READY":
      return "Not ready to submit";
    case "READY_TO_SUBMIT":
      return "Ready to submit — nobody has sent it";
    case "AWAITING_GC":
      return "With the GC";
    case "REJECTED":
      return "Sent back by the GC";
    case "ACCEPTED":
      return "Package accepted";
  }
}

/** Amber for our move, blue for theirs, green for done. The distinction
 * the whole model exists to draw is whose court the ball is in. */
export function stageBadgeClass(stage: CloseoutStage) {
  switch (stage) {
    case "READY_TO_SUBMIT":
    case "REJECTED":
      return "bg-amber-500/15 text-amber-300";
    case "AWAITING_GC":
      return "bg-blue-500/15 text-blue-300";
    case "ACCEPTED":
      return "bg-green-500/15 text-green-300";
    default:
      return "bg-slate-800 text-slate-400";
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function blockerLabel(blocker: CloseoutBlocker) {
  switch (blocker.kind) {
    case "NO_CHECKLIST":
      // Not "ready" and not "complete". Nothing has been asserted about
      // this job, which is a different thing from nothing being wrong.
      return "no closeout checklist yet, so nothing has been asserted";
    case "REQUIRED_ITEMS":
      return `${plural(blocker.count, "required document", "required documents")} outstanding`;
    case "OPEN_PUNCH_ITEMS":
      return `${plural(blocker.count, "punch item", "punch items")} still open`;
    case "OPEN_CALLBACKS":
      return `${plural(blocker.count, "callback", "callbacks")} still open`;
  }
}

export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "With the GC",
  ACCEPTED: "Accepted",
  REJECTED: "Sent back",
};

export function submissionStatusLabel(value: string) {
  return SUBMISSION_STATUS_LABELS[value] ?? value;
}

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

/** `1 job` / `2 jobs`. Exported because /closeout was rendering "1 jobs",
 * "1 items" and "1 days with them" from raw interpolation while this file
 * sat next to it already getting it right. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

/**
 * The chip beside a job's name on /closeout, derived from the SAME blocker
 * array the package panel underneath it renders.
 *
 * It lives here rather than inside CloseoutJobCard because the card is a
 * client component with no test around it, and this chip has now been
 * wrong three times — each time because it was a SECOND reading of the
 * checklist that could disagree with the first:
 *
 * 1. Every box ticked read "Closeout complete" above a panel reading "Not
 *    ready to submit — 1 punch item still open".
 * 2. A checklist made up ENTIRELY OF OPTIONAL ITEMS has no required items,
 *    so `isCloseoutComplete` was false and `outstandingRequired` was
 *    empty: the chip fell through to an amber "0 still outstanding"
 *    directly above a panel saying no checklist exists.
 * 3. (guarded by the tests below) any future recomputation.
 *
 * `blockers` is not optional. An absent-argument default would mean
 * "nothing is blocking", which is the dangerous direction.
 */
export function closeoutChip(
  blockers: CloseoutBlocker[],
  stage: CloseoutStage,
  /** How many checklist rows exist AT ALL, required or not. Only ever used
   * to tell "nobody has written a checklist" apart from "somebody wrote
   * one and marked nothing on it required" — two different silences. */
  checklistItemCount: number,
): { label: string; className: string } {
  // NO_CHECKLIST covers both "no items at all" and "items, but none of
  // them required" — nothing has been asserted either way, and the panel
  // says exactly that in both.
  const checklistBlocker = blockers.find(
    (b) => b.kind === "NO_CHECKLIST" || b.kind === "REQUIRED_ITEMS",
  );
  const outstanding = checklistBlocker?.kind === "REQUIRED_ITEMS" ? checklistBlocker.count : 0;

  // "Closeout complete" is a claim about the WHOLE closeout, so it is made
  // only when the package was accepted AND nothing at all is outstanding —
  // `blockers.length === 0`, not merely "no checklist blocker".
  //
  // That distinction is the bug this function was extracted to end, and the
  // extraction originally fixed only half of it. `closeoutReadiness` sets
  // the stage from the submission and reports blockers independently, by
  // design: a callback raised after acceptance must not un-accept the
  // package. So OPEN_PUNCH_ITEMS and OPEN_CALLBACKS left `checklistBlocker`
  // undefined and the chip went green — printing "Closeout complete"
  // directly above CloseoutPackagePanel's "Holding it up: 1 punch item
  // still open", which renders at ANY stage. One card, two contradictory
  // sentences, which is exactly what a chip is for preventing.
  //
  // Falling through with a non-checklist blocker yields "Checklist done" in
  // grey — a finished CHECKLIST, said plainly, which is what the sentence
  // below always claimed this did.
  if (blockers.length === 0 && stage === "ACCEPTED") {
    return { label: "Closeout complete", className: "bg-green-500/15 text-green-300" };
  }

  const label =
    checklistBlocker?.kind === "NO_CHECKLIST"
      ? // A list of optional items is still nothing asserted about what
        // closeout needs — but it is not an empty list, so it does not say
        // one is missing either.
        checklistItemCount === 0
        ? "No checklist yet"
        : "Nothing required yet"
      : outstanding > 0
        ? `${plural(outstanding, "document", "documents")} still outstanding`
        : "Checklist done";

  return {
    label,
    className:
      outstanding > 0 ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400",
  };
}

export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "With the GC",
  ACCEPTED: "Accepted",
  REJECTED: "Sent back",
};

export function submissionStatusLabel(value: string) {
  return SUBMISSION_STATUS_LABELS[value] ?? value;
}

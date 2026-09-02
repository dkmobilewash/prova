// What is actually holding a job's closeout open, and what it is holding
// up in money.
//
// Pure arithmetic and comparison over rows handed in — no database, no LLM
// call — same reasoning as lib/retainage.ts and lib/wip.ts. This decides
// whether someone chases the GC or chases their own crew, so it has to be
// reproducible from the source rows rather than cached anywhere.
//
// The gap it closes: the /closeout page could already say "3 required
// items outstanding" and lib/retainage.ts could already say "$13,420
// held", and nothing put the two sentences next to each other. A complete
// checklist sitting next to a retainage balance for four months has two
// opposite causes — nobody sent the package, or the GC is sitting on it —
// and until CloseoutSubmission existed there was no way to tell which.
//
// It reads punch list rows without owning them. An open punch item is a
// closeout blocker whether or not anyone has ticked "punch list sign-off"
// on the checklist, which is the point: the checklist is somebody's
// assertion and the punch rows are what can contradict it.

export type CloseoutBlockerKind =
  /** Nothing has been asserted about this job at all. Deliberately a
   * blocker rather than a pass, matching isCloseoutComplete: an empty
   * checklist reporting "ready" is the most dangerous possible default. */
  | "NO_CHECKLIST"
  | "REQUIRED_ITEMS"
  | "OPEN_PUNCH_ITEMS"
  | "OPEN_CALLBACKS";

export type CloseoutBlocker = { kind: CloseoutBlockerKind; count: number };

export type CloseoutStage =
  /** Work is still open. Ours to fix. */
  | "NOT_READY"
  /** Everything is closed and nobody has sent the package. Ours to send. */
  | "READY_TO_SUBMIT"
  /** With the GC, unanswered. Theirs. */
  | "AWAITING_GC"
  /** They bounced it. Ours again. */
  | "REJECTED"
  /** They took it. */
  | "ACCEPTED";

export type LatestSubmission = {
  status: string;
  submittedOn: string;
  respondedOn: string | null;
};

export interface CloseoutReadinessInput {
  requiredItemsTotal: number;
  requiredItemsOutstanding: number;
  openPunchItems: number;
  openCallbacks: number;
  /** Withheld minus released, from lib/retainage.ts. */
  retainageBalance: number;
  /** The most recent attempt, or null if the package has never gone out. */
  latestSubmission: LatestSubmission | null;
}

export interface CloseoutReadiness {
  stage: CloseoutStage;
  /** Ordered most binding first, so a caller rendering only the first one
   * shows the thing to do next rather than an arbitrary blocker. */
  blockers: CloseoutBlocker[];
  /** Money the GC is holding on this job. Reported alongside the stage
   * rather than folded into it: retainage outstanding is not itself a
   * blocker — it is what the blockers are costing. */
  retainageAtStake: number;
  /** How long the GC has had the current package, or how long the last one
   * took them. Null when nothing has been submitted. */
  daysWithGc: number | null;
}

/** Whole days between two UTC-midnight ISO dates. */
function daysBetween(fromIso: string, toIso: string) {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

export function closeoutBlockers(input: CloseoutReadinessInput): CloseoutBlocker[] {
  const blockers: CloseoutBlocker[] = [];

  if (input.requiredItemsTotal === 0) {
    blockers.push({ kind: "NO_CHECKLIST", count: 0 });
  } else if (input.requiredItemsOutstanding > 0) {
    blockers.push({ kind: "REQUIRED_ITEMS", count: input.requiredItemsOutstanding });
  }
  if (input.openPunchItems > 0) {
    blockers.push({ kind: "OPEN_PUNCH_ITEMS", count: input.openPunchItems });
  }
  if (input.openCallbacks > 0) {
    blockers.push({ kind: "OPEN_CALLBACKS", count: input.openCallbacks });
  }

  return blockers;
}

/**
 * Where a job's closeout stands, and whose move it is.
 *
 * The submission, when there is one, decides the stage — including when
 * blockers are still open. A GC who has accepted the package has accepted
 * it; a callback logged the week after acceptance is warranty work, not
 * something that un-closes the closeout. So the blockers are always
 * reported, and after a submission they stop deciding the stage. Reading
 * it the other way round would put an accepted job back into NOT_READY
 * the first time somebody rang about a sticking door, and nobody would
 * trust the column again.
 */
export function closeoutReadiness(
  input: CloseoutReadinessInput,
  today: string,
): CloseoutReadiness {
  const blockers = closeoutBlockers(input);
  const latest = input.latestSubmission;

  let stage: CloseoutStage;
  if (!latest) {
    stage = blockers.length === 0 ? "READY_TO_SUBMIT" : "NOT_READY";
  } else if (latest.status === "ACCEPTED") {
    stage = "ACCEPTED";
  } else if (latest.status === "REJECTED") {
    stage = "REJECTED";
  } else {
    stage = "AWAITING_GC";
  }

  // Measured to the response when there is one, so a resubmitted package
  // does not report the first attempt as still running. Never negative: a
  // response dated before the submission is bad data, and "-4 days with
  // the GC" is worse than saying nothing.
  let daysWithGc: number | null = null;
  if (latest) {
    const days = daysBetween(latest.submittedOn, latest.respondedOn ?? today);
    daysWithGc = days >= 0 ? days : null;
  }

  return {
    stage,
    blockers,
    retainageAtStake: input.retainageBalance,
    daysWithGc,
  };
}

/** Jobs whose closeout somebody should be doing something about, worst
 * first — most retainage at stake, since that is what the chasing is for.
 *
 * ACCEPTED jobs are excluded: the package is done, and any retainage still
 * outstanding on one is a payment question rather than a closeout one.
 * A job with nothing at stake and nothing outstanding is excluded too —
 * a list that names every job is a list nobody reads. */
export function needsAttention<T extends { readiness: CloseoutReadiness }>(rows: T[]): T[] {
  return rows
    .filter(
      (row) =>
        row.readiness.stage !== "ACCEPTED" &&
        (row.readiness.blockers.length > 0 ||
          row.readiness.stage === "READY_TO_SUBMIT" ||
          row.readiness.stage === "REJECTED" ||
          row.readiness.retainageAtStake > 0),
    )
    .sort((a, b) => b.readiness.retainageAtStake - a.readiness.retainageAtStake);
}

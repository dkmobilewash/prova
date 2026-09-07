/**
 * Which job status may follow which, and the sentence to show when one may
 * not.
 *
 * Until this file existed, `data: { status: "CONTRACTED" }` in
 * lib/actions/jobs.ts was the ONLY job-status write in the whole app — one
 * grep hit. IN_PROGRESS and COMPLETE were unreachable, so the dashboard's
 * "In progress" group was permanently empty, lib/today-dashboard.ts's crew
 * list filtered on a status nothing could ever set, and Ask answered
 * "which jobs are in progress" with nothing, forever, correctly.
 *
 * MANUAL, not derived. JobStatus is a stored column, and CLAUDE.md's rule
 * is that derived state is never stored — so deriving one of four stored
 * values (from time entries, or dates, or invoices) would create exactly
 * the contradiction that rule exists to prevent: a stored value that can
 * disagree with what it was supposedly derived from. A person says when a
 * job starts. Nothing guesses.
 *
 * Pure: no database, no session, no React. The table below is the whole
 * policy and lib/job-status-transitions.test.ts is where it is pinned.
 */

export const JOB_STATUSES = ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"] as const;

export type JobStatusValue = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: unknown): value is JobStatusValue {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

/**
 * The legal moves, keyed by where you are now.
 *
 * ESTIMATE has NO entry here on purpose. Leaving an estimate is
 * `markJobContracted`'s job and only its job, because that is where the
 * evidence gate lives — a signed SignatureRequest, or a recorded executed
 * subcontract. A general-purpose status setter that could write CONTRACTED
 * would be a second door into the billable state with no evidence behind
 * it, which is the whole thing that gate exists to stop.
 *
 * Nothing returns to ESTIMATE, ever. ESTIMATE is what unlocks direct
 * line-item editing (see assertEditableDirectly in lib/actions/shared.ts),
 * so reversing into it would let someone edit contracted scope in place
 * and leave no change order behind — it would not look like a mistake
 * afterwards, which is what makes it worth refusing rather than warning
 * about.
 *
 * Backwards moves that are NOT that are allowed, because they are how a
 * misclick gets corrected: IN_PROGRESS → CONTRACTED (started it by
 * mistake) and COMPLETE → IN_PROGRESS (closed it early, or the GC sent
 * punch-list work back).
 */
export const JOB_STATUS_TRANSITIONS: Record<JobStatusValue, readonly JobStatusValue[]> = {
  ESTIMATE: [],
  CONTRACTED: ["IN_PROGRESS"],
  IN_PROGRESS: ["CONTRACTED", "COMPLETE"],
  COMPLETE: ["IN_PROGRESS"],
};

export const JOB_STATUS_LABELS: Record<JobStatusValue, string> = {
  ESTIMATE: "Estimate",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

/** What the button should say for a given move. */
export const JOB_STATUS_ACTION_LABELS: Record<JobStatusValue, string> = {
  ESTIMATE: "Back to estimate",
  CONTRACTED: "Back to contracted",
  IN_PROGRESS: "Start work",
  COMPLETE: "Mark complete",
};

export function allowedJobStatusTransitions(from: JobStatusValue): readonly JobStatusValue[] {
  return JOB_STATUS_TRANSITIONS[from];
}

export function canTransitionJobStatus(from: JobStatusValue, to: JobStatusValue): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Why a move is refused, in a sentence a person can act on.
 *
 * Returns null when the move is legal — so a caller reads "a reason means
 * no" rather than having to remember which way a boolean points.
 *
 * These are RETURNED by the action, never thrown: production redacts a
 * thrown Server Action message to an opaque digest, so a thrown
 * explanation would reach the user as "An error occurred in the Server
 * Components render."
 */
export function jobStatusTransitionRefusal(
  from: JobStatusValue,
  to: JobStatusValue,
): string | null {
  if (from === to) {
    return `This job is already ${JOB_STATUS_LABELS[to].toLowerCase()}.`;
  }
  if (to === "ESTIMATE") {
    return (
      "A job can't go back to estimate. Contracted scope is only editable through a change " +
      "order, and moving back here would let it be edited in place with no record of what changed."
    );
  }
  if (from === "ESTIMATE") {
    return (
      "This job is still an estimate. To contract it, either the GC signs it in Prova or you " +
      "record the executed subcontract they sent — both are on this page, under Contract " +
      "signature."
    );
  }
  if (canTransitionJobStatus(from, to)) {
    return null;
  }
  return (
    `A ${JOB_STATUS_LABELS[from].toLowerCase()} job can't move straight to ` +
    `${JOB_STATUS_LABELS[to].toLowerCase()}. Allowed from here: ` +
    `${allowedJobStatusTransitions(from).map((s) => JOB_STATUS_LABELS[s].toLowerCase()).join(", ") || "nothing"}.`
  );
}

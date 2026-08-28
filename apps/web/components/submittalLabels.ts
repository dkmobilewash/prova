/** Shared submittal display semantics, so the form, the row and the
 * counters can't disagree about what state a package is in.
 *
 * There is NO stored status. State is derived from the latest revision on
 * every render — a stored status can disagree with the revision that
 * supposedly produced it, and that contradiction is how someone builds
 * from a superseded drawing. */

export type RevisionData = {
  revisionNumber: number;
  sentOn: string;
  dueBack: string | null;
  returnedOn: string | null;
  outcome: string | null;
  responseNotes: string | null;
};

export type SubmittalState =
  | "NOT_SENT" // registered, nothing submitted yet — the only deletable state
  | "WITH_GC" // latest revision is out, unreturned — their court
  | "REVISE" // latest came back revise-and-resubmit or rejected — our court
  | "APPROVED"; // latest came back approved / approved-as-noted — build from it

export const OUTCOMES = [
  { value: "APPROVED", label: "Approved" },
  { value: "APPROVED_AS_NOTED", label: "Approved as noted" },
  { value: "REVISE_AND_RESUBMIT", label: "Revise and resubmit" },
  { value: "REJECTED", label: "Rejected" },
] as const;

export function outcomeLabel(value: string) {
  return OUTCOMES.find((o) => o.value === value)?.label ?? value;
}

export function latestRevision(revisions: RevisionData[]): RevisionData | null {
  if (revisions.length === 0) return null;
  return revisions.reduce((a, b) => (b.revisionNumber > a.revisionNumber ? b : a));
}

export function submittalState(revisions: RevisionData[]): SubmittalState {
  const latest = latestRevision(revisions);
  if (!latest) return "NOT_SENT";
  if (!latest.returnedOn) return "WITH_GC";
  if (latest.outcome === "APPROVED" || latest.outcome === "APPROVED_AS_NOTED") return "APPROVED";
  return "REVISE";
}

export function stateLabel(state: SubmittalState) {
  switch (state) {
    case "NOT_SENT":
      return "Not sent";
    case "WITH_GC":
      return "With the GC";
    case "REVISE":
      return "Revise and resubmit";
    case "APPROVED":
      return "Approved";
  }
}

/** Overdue = the GC has it and the date we asked for is past. Derived on
 * every render; `today` comes from the server so server and browser can't
 * disagree about the date. */
export function isOverdue(revisions: RevisionData[], today: string) {
  const latest = latestRevision(revisions);
  return !!latest && !latest.returnedOn && !!latest.dueBack && latest.dueBack < today;
}

/** Whole days between two UTC-midnight ISO dates. */
export function daysBetween(fromIso: string, toIso: string) {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

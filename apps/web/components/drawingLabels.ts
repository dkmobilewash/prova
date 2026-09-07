/** Shared drawing-set display semantics, so the form, the row and the
 * counters can't disagree about which revision is current.
 *
 * There is NO stored "is current" flag. Current is derived from the issue
 * dates on every render — a stored flag can disagree with the revision
 * that supposedly set it, and that contradiction is precisely how someone
 * builds from a superseded sheet.
 */

export type RevisionData = {
  id: string;
  label: string;
  issuedOn: string;
  receivedOn: string | null;
  description: string | null;
  fileUrl: string | null;
  fileName: string | null;
};

/** Newest issue first. Ties on the issue date break on the received date
 * (a revision already in hand is the later one in practice), then on
 * label, so the order is total and stable rather than dependent on the
 * order rows came back from the database. */
export function byNewestFirst(revisions: RevisionData[]): RevisionData[] {
  return [...revisions].sort((a, b) => {
    if (a.issuedOn !== b.issuedOn) return a.issuedOn < b.issuedOn ? 1 : -1;
    const ar = a.receivedOn ?? "";
    const br = b.receivedOn ?? "";
    if (ar !== br) return ar < br ? 1 : -1;
    return a.label < b.label ? 1 : -1;
  });
}

/** The revision it is legal to build from: the most recently ISSUED one.
 *
 * Deliberately not "the most recently received". A revision that has been
 * issued supersedes the one before it whether or not it has reached the
 * trailer yet — that is exactly why an unreceived revision is dangerous
 * rather than merely pending. */
export function currentRevision(revisions: RevisionData[]): RevisionData | null {
  return byNewestFirst(revisions)[0] ?? null;
}

/** Revisions that have been issued but never reached us. The whole point
 * of the page: something exists that supersedes what the crew is holding,
 * and we don't have it. */
export function unreceivedRevisions(revisions: RevisionData[]): RevisionData[] {
  return byNewestFirst(revisions).filter((r) => !r.receivedOn);
}

export type SetState =
  | "EMPTY" // registered, nothing issued against it yet
  | "CURRENT_IN_HAND" // the newest issue is one we actually hold
  | "BEHIND"; // the newest issue has not reached us

/**
 * CURRENT_IN_HAND is a claim that the crew is holding everything that
 * governs, so it has to be true of EVERY revision issued on the newest
 * issue date — not just of whichever one the tiebreak picked.
 *
 * The tiebreak in `byNewestFirst` prefers a revision already in hand,
 * which is right for "which single sheet is current" and wrong here: two
 * bulletins issued the same day, one received and one never delivered,
 * made `current.receivedOn` truthy and this function say "Current set in
 * hand" while a sheet with equal authority had never arrived. The set is
 * not in hand. `unreceivedRevisions` listed it on the same screen the
 * whole time, which is the two-computations-disagreeing shape again.
 */
export function setState(revisions: RevisionData[]): SetState {
  const current = currentRevision(revisions);
  if (!current) return "EMPTY";
  const newestIssueMissing = revisions.some(
    (r) => r.issuedOn === current.issuedOn && !r.receivedOn,
  );
  return newestIssueMissing ? "BEHIND" : "CURRENT_IN_HAND";
}

export function stateLabel(state: SetState) {
  switch (state) {
    case "EMPTY":
      return "Nothing issued yet";
    case "CURRENT_IN_HAND":
      return "Current set in hand";
    case "BEHIND":
      return "Newest issue not received";
  }
}

/** Whole days between two UTC-midnight ISO dates. */
export function daysBetween(fromIso: string, toIso: string) {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/** How long a revision took to reach us, or how long we have been waiting
 * if it hasn't. Null when there is nothing meaningful to report, so the
 * caller can never render "0 days" for an unknown. */
export function daysToReachUs(revision: RevisionData, today: string): number | null {
  const end = revision.receivedOn ?? today;
  const days = daysBetween(revision.issuedOn, end);
  return days >= 0 ? days : null;
}

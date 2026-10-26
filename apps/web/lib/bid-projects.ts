/**
 * The decisions behind "one project, many GC invitations, one estimate".
 *
 * Pure: no database, no clock. `lib/actions/bidProjects.ts` reads the rows,
 * asks these functions what to do, and writes. Everything here is a fact
 * about two rows or a sentence about them; nothing is stored. In particular
 * "this GC didn't get the job" is NOT a column — it is the project's entered
 * prime award compared with the invitation's GC, every time it is read, so it
 * cannot disagree with the award it was derived from.
 *
 * Money is held as plain numbers by the callers (they convert from Decimal
 * once, at the edge), the same split `lib/bid-pipeline.ts` makes.
 */

/** The two fields of a project that say who won the PRIME contract. */
export type PrimeAward = {
  primeAwardedContactId: string | null;
  primeAwardedName: string | null;
};

/** Has anyone recorded who won the prime? A name with no contact counts: the
 * winner is a GC we have no record of, which is exactly the common case. */
export function hasPrimeAward(project: PrimeAward): boolean {
  return project.primeAwardedContactId !== null || (project.primeAwardedName ?? "").trim() !== "";
}

/**
 * Did the prime contract go to a DIFFERENT GC than this invitation's?
 *
 * Unknown (nothing recorded) is NOT "went elsewhere" — a project nobody has
 * entered an award for tells us nothing, and a GC must not be counted as one
 * that turned our price down because we have not been told yet.
 *
 * An award recorded by name only (no contact) is by construction not any of
 * the GCs on file, so every invitation on the project missed it.
 */
export function primeWentElsewhere(project: PrimeAward, invitationContactId: string): boolean {
  if (project.primeAwardedContactId !== null) return project.primeAwardedContactId !== invitationContactId;
  return hasPrimeAward(project);
}

/** The words for it, where a status would otherwise nag. */
export const DIDNT_GET_THE_JOB = "Didn't get the job";

/**
 * Which invitation's GC the estimate is provisionally FOR while several GCs
 * are pricing the same job.
 *
 * `Job.contactId` is required and everything downstream reads it, so the
 * estimate needs somebody. The rule is: the GC who awarded us the job if the
 * prime has been awarded to a GC that invited us, otherwise the FIRST GC to
 * invite us (earliest created, id as the tie-break so it is deterministic).
 * It is provisional — recordPrimeAward / marking an invitation WON switches
 * it, while the job is still an ESTIMATE.
 */
export function provisionalGc<T extends { id: string; contactId: string; createdAt: Date }>(
  invitations: T[],
  project: PrimeAward,
): T | null {
  if (invitations.length === 0) return null;
  if (project.primeAwardedContactId !== null) {
    const winner = invitations.find((i) => i.contactId === project.primeAwardedContactId);
    if (winner) return winner;
  }
  return [...invitations].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )[0];
}

/** The slice of a project the merge decision needs. */
export type MergeSide = {
  id: string;
  companyId: string;
  estimateJobId: string | null;
} & PrimeAward;

export type MergePlan =
  | { ok: false; error: string }
  | {
      ok: true;
      /** The source's estimate moves to the target (target had none). */
      adoptEstimateJobId: string | null;
      /** The source's prime award moves to the target (target had none). */
      adoptPrimeAward: boolean;
    };

/**
 * May `source` be folded into `target`, and what comes with it?
 *
 * Refuses in words rather than silently dropping something:
 *  - two estimates would leave one of them with no project, and "which one
 *    prices this job" is exactly the question the project exists to answer;
 *  - two DIFFERENT prime awards are a contradiction a person has to settle.
 */
export function planMerge(source: MergeSide, target: MergeSide): MergePlan {
  if (source.id === target.id) return { ok: false, error: "That is already the same project." };
  if (source.companyId !== target.companyId) {
    return { ok: false, error: "That project isn't on this company. Reload the page." };
  }
  if (source.estimateJobId !== null && target.estimateJobId !== null) {
    return {
      ok: false,
      error: "Both have an estimate. Pick which one prices this project first: remove the estimate you don't want, then merge.",
    };
  }
  const sourceAward = hasPrimeAward(source);
  const targetAward = hasPrimeAward(target);
  if (sourceAward && targetAward && !samePrimeAward(source, target)) {
    return {
      ok: false,
      error: "The two projects record different winners for the prime contract. Correct one of them first, then merge.",
    };
  }
  return {
    ok: true,
    adoptEstimateJobId: target.estimateJobId === null ? source.estimateJobId : null,
    adoptPrimeAward: sourceAward && !targetAward,
  };
}

function samePrimeAward(a: PrimeAward, b: PrimeAward): boolean {
  if (a.primeAwardedContactId !== null || b.primeAwardedContactId !== null) {
    return a.primeAwardedContactId === b.primeAwardedContactId;
  }
  return normalName(a.primeAwardedName) === normalName(b.primeAwardedName);
}

function normalName(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The sentence for "what we sent this GC" against "what the estimate says",
 * or null when there is nothing to say. Only a DIFFERENCE is worth a line:
 * one GC's bid form may exclude an alternate, so the two can honestly differ.
 */
export function priceVersusEstimate(
  sent: number | null,
  estimate: number | null,
  gcName: string,
  format: (n: number) => string,
): string | null {
  if (sent === null || estimate === null) return null;
  if (Math.round(sent * 100) === Math.round(estimate * 100)) return null;
  return `${format(sent)} sent to ${gcName}; the estimate totals ${format(estimate)}.`;
}

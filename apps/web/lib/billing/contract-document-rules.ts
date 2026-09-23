/**
 * When a contract document is evidence rather than a file (#351).
 *
 * Lives outside `lib/actions/billing.ts` because that module is "use server"
 * — every export from it becomes an HTTP endpoint and must be an async
 * function, so a shared sentence cannot come from there. The page and the
 * action both read THIS, which is the only way the control the page hides
 * and the refusal the action throws can be guaranteed to agree.
 *
 * The rule: a document carrying an executed-signed date, on a job that has
 * left the ESTIMATE stage, is the evidence `markJobContracted` accepted and
 * is kept. At ESTIMATE the delete stays available, because an executed date
 * typed on the wrong upload is a mistake that should stay cheap while
 * nothing has been built on it.
 */
export function executedContractIsKept(
  document: { executedSignedDate: Date | null },
  job: { status: string },
): boolean {
  return document.executedSignedDate !== null && job.status !== "ESTIMATE";
}

export const EXECUTED_CONTRACT_KEPT =
  "This is the executed subcontract that made the job billable. It stays with the job as evidence and cannot be deleted; upload a newer version instead.";

/**
 * WHERE `createJob` SENDS A PERSON AFTER IT STARTS A JOB.
 *
 * The CRM's start-a-bid form ends in a server action that REDIRECTS to the
 * bid-creation stepper (`/jobs/new/<id>/items`). A server action's redirect is
 * invisible to the link census (its sight ends at `lib/`), and C Stream Bid
 * starts jobs through the very same action — so a Bid user must not be sent
 * into the CRM's stepper. The form says where it is being used with a
 * `returnTo` field, and THIS FILE turns that word into a path.
 *
 * AN ALLOWLIST OF WORDS, never a URL. `returnTo` arrives from a form field a
 * browser can set to anything; honouring it as a path would be an open
 * redirect (and a way to land a signed-in person on an attacker's page). So the
 * only values that mean anything are the keys of `START_DESTINATIONS`; every
 * other value — absent, empty, `https://evil.example`, `//evil.example`,
 * `/jobs`, `bid ` — falls through to the CRM default, which is what the action
 * did before this file existed. The paths are built here from the job id the
 * action just created, never from the field.
 *
 * `bidLinkCensus.test.ts` calls this with every key and classifies the result,
 * so a Bid destination that points at the CRM fails there by name.
 */

/** The CRM's step 2 of the bid-creation stepper — what the action always did. */
function crmDestination(jobId: string): string {
  return `/jobs/new/${jobId}/items`;
}

/**
 * C Stream Bid: straight into the estimate, on its first link of the chain —
 * the takeoff, where the drawing set goes. Bid has no separate "add work" step;
 * the estimate's tabs ARE where work is added.
 */
const START_DESTINATIONS = {
  bid: (jobId: string) => `/bid/estimates/${jobId}/takeoff`,
} as const satisfies Record<string, (jobId: string) => string>;

export type JobStartReturn = keyof typeof START_DESTINATIONS;

/** The words a form may send as `returnTo`. */
export const JOB_START_RETURNS = Object.keys(START_DESTINATIONS) as JobStartReturn[];

export function isJobStartReturn(value: unknown): value is JobStartReturn {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(START_DESTINATIONS, value);
}

/** The path to redirect to. Unknown input is the CRM default, never an error. */
export function jobStartDestination(returnTo: unknown, jobId: string): string {
  return isJobStartReturn(returnTo) ? START_DESTINATIONS[returnTo](jobId) : crmDestination(jobId);
}

/**
 * WHERE "START THE ESTIMATE" (from a bid project) SENDS A PERSON. Same rule as
 * above — a WORD from a fixed list, never a URL — but a different destination:
 * the project's estimate already has its name, GC, address and bid date from the
 * project, so Bid opens the estimate itself (which lands on its takeoff) rather
 * than the new-job stepper's drawings step. The CRM default is what
 * `startEstimateFromProject` always did.
 */
const ESTIMATE_DESTINATIONS = {
  bid: (jobId: string) => `/bid/estimates/${jobId}`,
} as const satisfies Record<JobStartReturn, (jobId: string) => string>;

export function estimateStartDestination(returnTo: unknown, jobId: string): string {
  return isJobStartReturn(returnTo) ? ESTIMATE_DESTINATIONS[returnTo](jobId) : crmDestination(jobId);
}

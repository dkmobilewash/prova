// What each job function is allowed to see and do.
//
// Pure mapping and pure predicates — no database, no session. The point of
// keeping it here rather than inside the pages is that a permissions rule
// has to be readable in one place and testable without a browser: this is
// the one file where "can a foreman see margin" has an answer, and
// lib/permissions.test.ts is where that answer is pinned.
//
// TWO ORTHOGONAL THINGS, and conflating them is the bug this shape exists
// to prevent:
//
//   UserRole    OWNER | MEMBER — can this person ADMINISTER the company.
//               Untouched by this feature. Every assertOwner() in
//               lib/actions/* already means this and still does.
//   JobFunction what the person DOES, and therefore what they need.
//
// An OWNER holds every capability regardless of job function. An owner
// locked out of their own books by a dropdown is a support call nobody can
// resolve from inside the app, and on a single-owner company — which is
// most of them — there is no second owner to undo it.

export const CAPABILITIES = [
  /** Actual cost, forecast, margin and WIP on a job. */
  "VIEW_JOB_COSTS",
  /** Company-wide money: backlog, cash flow, the metric bar. */
  "VIEW_COMPANY_FINANCIALS",
  /** Pricing work: estimates, the catalog, bids, vendor price quotes. */
  "MANAGE_ESTIMATING",
  /** Invoices, pay applications, retainage, backcharges, accounting sync. */
  "MANAGE_BILLING",
  /** Compliance documents, licences, insurance, bonds, certified payroll. */
  "MANAGE_COMPLIANCE",
  /** Field reports, safety, punch lists, time, materials, equipment. */
  "MANAGE_FIELD",
  /** Jobs themselves and the correspondence around them: RFIs, submittals,
   * drawings, closeout. */
  "MANAGE_JOBS",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const JOB_FUNCTIONS = [
  "EXECUTIVE",
  "ESTIMATOR",
  "PROJECT_MANAGER",
  "FIELD",
  "PAYROLL_COMPLIANCE",
  "ACCOUNTING",
] as const;

export type JobFunctionValue = (typeof JOB_FUNCTIONS)[number];

/** Everything below owner-only administration.
 *
 * This is what an unset job function grants, and it is deliberately the
 * complete list: exactly what every MEMBER has had since multi-user
 * companies existed. Shipping this feature takes nothing from anyone until
 * somebody chooses to. */
const ALL: Capability[] = [...CAPABILITIES];

/**
 * The defaults. A company that works differently cannot currently change
 * them — per-company overrides are a real feature and not this one, and a
 * half version (a settings page editing a map nothing reads) would be
 * worse than the honest absence. Where a call was genuinely arguable it is
 * noted here rather than left to be discovered from behaviour.
 */
const BY_FUNCTION: Record<JobFunctionValue, Capability[]> = {
  // A partner or general manager: the owner's view without the owner's
  // administration.
  EXECUTIVE: ALL,

  // Job cost is in, because you cannot price the next job honestly
  // without knowing what the last one actually cost. Billing is out:
  // what has been invoiced is not an estimator's business.
  ESTIMATOR: ["MANAGE_ESTIMATING", "VIEW_JOB_COSTS", "MANAGE_JOBS"],

  // Arguable, and called deliberately: a PM in this trade drives the pay
  // application, so MANAGE_BILLING is in. Company-wide financials are not
  // — backlog and blended margin are an owner's numbers, and a PM needs
  // their own jobs rather than the whole book.
  PROJECT_MANAGER: [
    "MANAGE_JOBS",
    "MANAGE_FIELD",
    "VIEW_JOB_COSTS",
    "MANAGE_ESTIMATING",
    "MANAGE_BILLING",
  ],

  // The only function that removes anything, and the audit row this
  // feature exists for. A foreman needs the job, the crew, the paperwork
  // that comes off the site, and an RFI when the drawings are wrong.
  // Margin, cost and billing are not withheld out of distrust — they are
  // simply not this job, and a phone left on a bench in a jobsite trailer
  // is a genuinely different exposure from a laptop in an office.
  FIELD: ["MANAGE_FIELD", "MANAGE_JOBS"],

  PAYROLL_COMPLIANCE: ["MANAGE_COMPLIANCE", "MANAGE_FIELD"],

  ACCOUNTING: ["MANAGE_BILLING", "VIEW_COMPANY_FINANCIALS", "VIEW_JOB_COSTS"],
};

export type Principal = {
  role: string;
  jobFunction: string | null;
};

/**
 * Everything this person can do.
 *
 * Three rules, in this order, and the order is the safety:
 *   1. An OWNER holds everything. Always. No job function reduces it.
 *   2. No job function set means the pre-existing MEMBER access — the
 *      whole list. Nobody loses anything by this feature shipping.
 *   3. Otherwise, the function's list.
 *
 * An unrecognised job function falls back to rule 2 rather than to an
 * empty set. A value this build does not know about is far more likely to
 * be a newer enum member than an attack, and locking a real person out of
 * their own account on a string comparison is the worse outcome.
 */
export function capabilitiesFor(user: Principal): Set<Capability> {
  if (user.role === "OWNER") return new Set(ALL);
  if (!user.jobFunction) return new Set(ALL);

  const known = JOB_FUNCTIONS.includes(user.jobFunction as JobFunctionValue);
  if (!known) return new Set(ALL);

  return new Set(BY_FUNCTION[user.jobFunction as JobFunctionValue]);
}

export function can(user: Principal, capability: Capability): boolean {
  return capabilitiesFor(user).has(capability);
}

/** True when this person's access is narrower than a plain member's — the
 * signal a page uses to explain WHY something is missing rather than just
 * rendering a smaller screen with no explanation. */
export function isRestricted(user: Principal): boolean {
  return capabilitiesFor(user).size < CAPABILITIES.length;
}

/** Which capability each guarded route needs.
 *
 * Routes absent from this map need none beyond being signed in — the job
 * list, alerts, contacts, the schedule. `/estimating` is absent on
 * purpose: it is a bare redirect to `/dashboard`, and listing it as
 * guarded would claim a protection that redirects straight past itself. Being explicit about the guarded
 * set, in one map, is what makes it possible to check the nav and the page
 * guards against each other rather than hoping they agree.
 */
export const ROUTE_CAPABILITY: Record<string, Capability> = {
  "/cash-flow": "VIEW_COMPANY_FINANCIALS",
  "/catalog": "MANAGE_ESTIMATING",
  "/bids": "MANAGE_ESTIMATING",
  "/vendors/pricing": "MANAGE_ESTIMATING",
  "/backcharges": "MANAGE_BILLING",
  "/compliance": "MANAGE_COMPLIANCE",
  "/settings": "MANAGE_COMPLIANCE",
};

export function capabilityForRoute(href: string): Capability | null {
  return ROUTE_CAPABILITY[href] ?? null;
}

/** The routes this person can reach, for filtering the nav.
 *
 * NOT a security boundary and must never be treated as one — hiding a link
 * hides nothing, since the URL still exists and can be typed. The page's
 * own guard is the boundary. This only stops the rail advertising doors
 * that will not open. */
export function canReach(user: Principal, href: string): boolean {
  const needed = capabilityForRoute(href);
  return needed === null || can(user, needed);
}

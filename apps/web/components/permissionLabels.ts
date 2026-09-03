/** Wording for job functions. What each one actually grants is decided in
 * lib/permissions.ts and nowhere else — these sentences describe that map
 * and must be changed with it. */

import { CAPABILITIES, capabilitiesFor, type JobFunctionValue } from "@/lib/permissions";

export const JOB_FUNCTION_LABELS: Record<JobFunctionValue, string> = {
  EXECUTIVE: "Executive",
  ESTIMATOR: "Estimator",
  PROJECT_MANAGER: "Project manager",
  FIELD: "Foreman / field",
  PAYROLL_COMPLIANCE: "Payroll & compliance",
  ACCOUNTING: "Accounting",
};

export function jobFunctionLabel(value: string | null) {
  if (!value) return "Full office access";
  return JOB_FUNCTION_LABELS[value as JobFunctionValue] ?? value;
}

const SUMMARIES: Record<JobFunctionValue, string> = {
  EXECUTIVE: "Everything a member can see. Only account administration is owner-only.",
  ESTIMATOR: "Pricing, the catalog, bids and job cost. Not billing.",
  PROJECT_MANAGER: "Jobs, the field, cost and pay applications. Not company-wide financials.",
  FIELD: "Jobs, field reports, safety, punch lists and RFIs. No cost, margin or billing.",
  PAYROLL_COMPLIANCE: "Compliance records and the field. Not pricing or billing.",
  ACCOUNTING: "Billing, retainage, backcharges and company financials. Not the field.",
};

export function jobFunctionSummary(value: string | null) {
  if (!value) return "Everything except account administration — what every member has today.";
  return (
    SUMMARIES[value as JobFunctionValue] ??
    // A value this build doesn't know grants the default access rather than
    // nothing (see capabilitiesFor), and the wording has to say so or the
    // screen would be lying about what it just saved.
    "Not a job function this version knows — treated as full office access."
  );
}

/** How many of the capability set a function holds, for the "narrower than
 * a member" hint on the team list. */
export function capabilityCount(jobFunction: string | null): { held: number; total: number } {
  return {
    held: capabilitiesFor({ role: "MEMBER", jobFunction }).size,
    total: CAPABILITIES.length,
  };
}

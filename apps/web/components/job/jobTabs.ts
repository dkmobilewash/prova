import { can, type Principal } from "@/lib/permissions";

/**
 * The job's tab row, under the five stage boxes: every section of the job,
 * one click from any of them, at every stage. #748 replaced this row with
 * the stage boxes alone, and half the job's pages — and every estimating
 * tool on `/estimate` — went out of sight. The gating is the pre-#748 rail
 * exactly (`(tabs)/layout.tsx` at `b204ab9c~1`). Hiding a tab is cosmetic
 * (`canReach`: "NOT a security boundary"); each route re-checks itself.
 *
 * "Estimate" is "Estimate" at every stage. After the contract the page also
 * holds the change orders, but the estimate tools are still on it, and
 * calling the tab "Change orders" hid them (restore brief, 2026-10-12).
 */
export type JobTab = { href: string; label: string };

export function jobTabs(input: {
  jobId: string;
  status: string;
  showsJobMoney: boolean;
  showsBilling: boolean;
  showsField: boolean;
}): JobTab[] {
  const id = input.jobId;
  const billingOpen = input.status !== "ESTIMATE" && input.showsBilling;
  return [
    { href: `/jobs/${id}`, label: "Overview" },
    ...(input.showsJobMoney
      ? [
          { href: `/jobs/${id}/estimate`, label: "Estimate" },
          { href: `/jobs/${id}/takeoff`, label: "Takeoff" },
        ]
      : []),
    { href: `/jobs/${id}/crew`, label: "Crew & time" },
    { href: `/jobs/${id}/compliance`, label: "Compliance" },
    ...(billingOpen
      ? [
          { href: `/jobs/${id}/billing`, label: "Billing" },
          { href: `/jobs/${id}/retainage`, label: "Retainage" },
        ]
      : []),
    { href: `/jobs/${id}/field-reports`, label: "Field reports" },
    ...(input.showsField ? [{ href: `/jobs/${id}/photos`, label: "Photos" }] : []),
  ];
}

/** Every route the job tab row can show, as app-router patterns. The
 * reachability census (lib/reachabilityCensus.test.ts) reads this list. */
export const JOB_TAB_ROUTES = [
  "/jobs/[id]",
  "/jobs/[id]/estimate",
  "/jobs/[id]/takeoff",
  "/jobs/[id]/crew",
  "/jobs/[id]/compliance",
  "/jobs/[id]/billing",
  "/jobs/[id]/retainage",
  "/jobs/[id]/field-reports",
  "/jobs/[id]/photos",
] as const;

/**
 * The two job documents that are not tabs and were reachable only from
 * inside one — the proposal from the Estimate tab, certified payroll from
 * Crew & time — as rows in the Paperwork panel, so each is one click from
 * the job page at any stage. Gated on the capability each page itself
 * requires (`requireCapability` in its page.tsx), so the row never leads
 * to a "no access" page.
 */
export function jobDocumentLinks(principal: Principal, jobId: string) {
  return [
    ...(can(principal, "MANAGE_ESTIMATING")
      ? [{ href: `/jobs/${jobId}/proposal`, label: "Proposal", detail: "" }]
      : []),
    ...(can(principal, "MANAGE_COMPLIANCE")
      ? [{ href: `/jobs/${jobId}/certified-payroll`, label: "Certified payroll", detail: "WH-347" }]
      : []),
  ];
}

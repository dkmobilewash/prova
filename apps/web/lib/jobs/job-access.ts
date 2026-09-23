import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can, type Principal } from "@/lib/permissions";

/**
 * The tenant-isolation half both `requireJob` and `requireJobGivenContext`
 * need: a job that either does not exist or belongs to a DIFFERENT
 * company is `notFound()`, never returned. One function so a mutation in
 * this check can only be missed twice, not fixed in one call site and
 * left broken in the other.
 */
async function jobInCompanyOrNotFound(id: string, companyId: string) {
  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, companyId: true, name: true, status: true },
  });
  if (!job || job.companyId !== companyId) {
    notFound();
  }
  return job;
}

/**
 * The one check every `/jobs/[id]/*` route needs before its own
 * section-specific query: is this job real, does it belong to the
 * caller's company, and who is the caller.
 *
 * Deliberately minimal — `select` names only what every route needs
 * (existence, ownership, name/status for a heading) rather than the old
 * monolith's one `prisma.job.findUnique` with every relation on it. Each
 * route below layers its OWN targeted query on top of this for whatever
 * that section actually renders — the fetch a reader without a given
 * capability never pays for is the same fetch this whole rebuild exists
 * to stop running on every page load.
 *
 * `/jobs`, `/jobs/new` and `/jobs/[id]` stay open to any company member
 * (see `lib/permissions.ts`'s `ROUTE_CAPABILITY` comment) — this never
 * throws for lack of a capability, only for the job not existing or not
 * being this company's.
 *
 * USED BY SIX of the eight tabs — Overview, Estimate, Crew & time,
 * Compliance, Billing, Retainage, Field reports — every one of them
 * EXCEPT Photos. Those six withhold their money/field sections with a
 * flag from `jobCapabilities()` below and an early return in the page
 * itself, the same section-level withholding the monolith did. That is
 * NOT a `requireCapability` wall: it hides content, it does not refuse
 * the route, and Estimate/Billing/Retainage say so explicitly in their
 * own file's doc comment, with the reason (issue #383) their Server
 * Actions cannot back up a hard gate yet. Photos is the one tab that DOES
 * hard-gate, via `requireJobGivenContext` below, not this function.
 */
export async function requireJob(id: string) {
  const context = await requireCompanyContext();
  const { company, ...currentUser } = context;
  const job = await jobInCompanyOrNotFound(id, company.id);
  const principal: Principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };
  return { company, currentUser, principal, job };
}

export type JobCapabilities = {
  showsJobMoney: boolean;
  showsBilling: boolean;
  showsField: boolean;
  showsJobManagement: boolean;
};

/**
 * What this person's job function lets them see of THIS job's money and
 * management sections. Computed the same way, from the same four
 * capabilities, on every route — so the summary header, the tab nav and
 * a section's own guard can never end up disagreeing about whether a
 * reader may see a price. Mirrors the single computation the monolith did
 * once at the top of the page; now each route does it once for itself.
 */
export function jobCapabilities(principal: Principal): JobCapabilities {
  return {
    showsJobMoney: can(principal, "VIEW_JOB_COSTS"),
    showsBilling: can(principal, "MANAGE_BILLING"),
    showsField: can(principal, "MANAGE_FIELD"),
    showsJobManagement: can(principal, "MANAGE_JOBS"),
  };
}

/**
 * The job-existence half of the one HARD-gated tab — Photos, and as of
 * this writing ONLY Photos. `certified-payroll/page.tsx` and
 * `pay-applications/[invoiceId]/page.tsx` (the two pre-existing sibling
 * routes under `/jobs/[id]/`) use the same shape. Estimate, Billing and
 * Retainage do NOT call this — they soft-withhold via `requireJob` and
 * `jobCapabilities` above instead, and say why in their own file.
 *
 * Deliberately NOT a wrapper around `requireCapability` the way
 * `requireJob` above is a self-contained helper: `lib/permissions.test.ts`
 * holds every guarded route to having the literal text
 * `requireCapability("<capability>")` and `<NoAccess capability="…" />`
 * IN THE PAGE FILE ITSELF (it reads `page.tsx`'s own source, never
 * follows an import) — hiding the call inside a shared helper would make
 * a real guard invisible to that census. So a hard-gated page calls
 * `requireCapability` directly, exactly like `certified-payroll/page.tsx`
 * already does, and only the job lookup that follows is shared here. If a
 * second tab earns a hard gate later (see issue #383), it joins Photos as
 * a caller of this function — the function itself does not change.
 */
export async function requireJobGivenContext(
  id: string,
  context: Awaited<ReturnType<typeof requireCompanyContext>>,
) {
  const { company, ...currentUser } = context;
  const job = await jobInCompanyOrNotFound(id, company.id);
  return { company, currentUser, job };
}

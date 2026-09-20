import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can, type Principal } from "@/lib/permissions";

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
 * being this company's. Capability withholding happens per SECTION,
 * exactly as it did in the monolith; routes that are entirely one
 * capability's content (Estimate, Billing, Retainage, Photos) call
 * `requireCapability` themselves on top of this.
 */
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
 * The job-existence half of a HARD-gated route (Estimate, Billing,
 * Retainage, Photos) — used AFTER the page has already called
 * `requireCapability(...)` and checked `allowed` itself.
 *
 * Deliberately NOT a wrapper around `requireCapability` the way
 * `requireJob` above is a self-contained helper: `lib/permissions.test.ts`
 * holds every guarded route to having the literal text
 * `requireCapability("<capability>")` and `<NoAccess capability="…" />`
 * IN THE PAGE FILE ITSELF (it reads `page.tsx`'s own source, never
 * follows an import) — hiding the call inside a shared helper would make
 * a real guard invisible to that census. So each hard-gated page calls
 * `requireCapability` directly, exactly like `certified-payroll/page.tsx`
 * already does, and only the job lookup that follows is shared here.
 */
export async function requireJobGivenContext(
  id: string,
  context: Awaited<ReturnType<typeof requireCompanyContext>>,
) {
  const { company, ...currentUser } = context;
  const job = await jobInCompanyOrNotFound(id, company.id);
  return { company, currentUser, job };
}

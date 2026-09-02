import Link from "next/link";
import type { Capability } from "@/lib/permissions";

/** Why a page is empty, rather than an empty page.
 *
 * Deliberately not a 404 and not a redirect to the dashboard. Both of
 * those tell a foreman who followed a link from a colleague that the page
 * is broken, and the next thing that happens is a phone call. This says
 * the page exists, that it is not part of their job, and who can change
 * that — which is the true and useful answer.
 *
 * It never names what is on the other side beyond the area, because the
 * point of withholding cost data is not served by describing it. */
const AREA: Record<Capability, string> = {
  VIEW_JOB_COSTS: "job cost and margin",
  VIEW_COMPANY_FINANCIALS: "company financials",
  MANAGE_ESTIMATING: "estimating and pricing",
  MANAGE_BILLING: "billing",
  MANAGE_COMPLIANCE: "compliance records",
  MANAGE_FIELD: "field operations",
  MANAGE_JOBS: "job records",
};

export function NoAccess({ capability }: { capability: Capability }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Not part of your access</h1>
      <p className="mb-4 text-sm text-slate-400">
        This page covers {AREA[capability]}, which isn&apos;t included in your job function. Nothing
        is broken and you haven&apos;t done anything wrong — the account owner sets who sees what,
        on the Team page.
      </p>
      <Link
        href="/dashboard"
        className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Back to jobs
      </Link>
    </div>
  );
}

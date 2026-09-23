import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCompanyContext } from "@/lib/auth";
import { loadJobSummary } from "@/lib/jobs/job-summary";
import { jobCapabilities } from "@/lib/jobs/job-access";
import { JobSummaryHeader } from "@/components/JobSummaryHeader";
import { JobSectionNav, type JobSectionTab } from "@/components/JobSectionNav";

/**
 * The shared shell for every `/jobs/[id]/*` tab: the summary header (always
 * visible, no scrolling to reach it) and the tab rail underneath. A route
 * GROUP — `(tabs)`, invisible in the URL — so this does NOT wrap the three
 * pre-existing sibling routes that already had their own single-purpose
 * pages before this rebuild: `certified-payroll`, `pay-applications/
 * [invoiceId]`, `photo-report`. Those keep their own "← Back to job" link
 * and print layout unchanged; wrapping them in a tab rail they are not
 * part of would be the wrong kind of navigation for a report you print.
 *
 * Fetches its OWN lightweight job summary rather than receiving one from
 * a page below it — Next's layout/page split has no prop channel between
 * them, and that is fine: this query is select-only, no relations beyond
 * what `loadJobSummary` needs, cheap next to what any one section below
 * asks for.
 */
export default async function JobTabsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company, ...currentUser } = await requireCompanyContext();
  const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };

  const summary = await loadJobSummary(company.id, id);
  if (!summary) {
    notFound();
  }

  const { showsJobMoney, showsBilling, showsField } = jobCapabilities(principal);
  const isEstimateStage = summary.status === "ESTIMATE";

  // Which tabs this viewer would have seen SOMETHING under in the old
  // single-page layout. Hiding a tab is cosmetic (`lib/permissions.ts`'s
  // own `canReach` comment: "NOT a security boundary... hides nothing");
  // each route re-checks for itself. Invoices/Retainage were absent
  // entirely pre-contract in the monolith (`!isEstimateStage &&
  // showsBilling`) — same condition, now a hidden tab instead of an
  // absent section.
  const tabs: JobSectionTab[] = [
    { href: `/jobs/${id}`, label: "Overview" },
    ...(showsJobMoney ? [{ href: `/jobs/${id}/estimate`, label: "Estimate" }] : []),
    ...(showsJobMoney ? [{ href: `/jobs/${id}/takeoff`, label: "Takeoff" }] : []),
    { href: `/jobs/${id}/crew`, label: "Crew & time" },
    { href: `/jobs/${id}/compliance`, label: "Compliance" },
    ...(!isEstimateStage && showsBilling ? [{ href: `/jobs/${id}/billing`, label: "Billing" }] : []),
    ...(!isEstimateStage && showsBilling ? [{ href: `/jobs/${id}/retainage`, label: "Retainage" }] : []),
    { href: `/jobs/${id}/field-reports`, label: "Field reports" },
    ...(showsField ? [{ href: `/jobs/${id}/photos`, label: "Photos" }] : []),
  ];

  return (
    // `working` for the header and the tab rail, and the WIDEST a tab body
    // can be. This used to be `mx-auto max-w-3xl` around all of it, so every
    // tab — the billing register, the estimate's line items, the photo grid —
    // was a 768px column with half the screen empty beside it, and no tab
    // could do anything about it. Now a tab chooses: a list or a table
    // renders straight into this width; a form or a short document narrows
    // itself with `<PageColumn width="reading">` (Compliance, Retainage,
    // Field reports). `print:px-0 print:py-0` keep the printed Overview
    // summary flush to the paper, as before.
    <PageShell width="working" className="print:px-0 print:py-0">
      <JobSummaryHeader summary={summary} showsJobMoney={showsJobMoney} showsBilling={showsBilling} />
      <JobSectionNav tabs={tabs} />
      {/* NOT wrapped in print:hidden here — the Overview tab's printable
          ContractSummary block lives in `children` and must still print.
          The header and nav above hide themselves individually; every
          other section below does the same where it needs to (see
          Overview's own print:hidden wrapper around its non-summary
          content, unchanged from the monolith). */}
      {children}
    </PageShell>
  );
}

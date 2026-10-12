import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCompanyContext } from "@/lib/auth";
import { loadJobSummary } from "@/lib/jobs/job-summary";
import { jobCapabilities } from "@/lib/jobs/job-access";
import { canReach } from "@/lib/permissions";
import { jobPaperworkLinks, loadJobPaperworkCounts } from "@/lib/jobs/job-paperwork";
import { JobSummaryHeader } from "@/components/JobSummaryHeader";
import { JobStageNav } from "@/components/job/JobStageNav";
import { JobPaperworkPanel } from "@/components/job/JobPaperworkPanel";
import { changeOrderPaperworkLink, jobStages } from "@/components/job/jobStages";
import { loadJobStageFacts } from "@/components/job/loadJobStageFacts";
import { viewerAsOf } from "@/lib/viewerToday";

/**
 * The shared shell for every `/jobs/[id]/*` tab: the summary header (always
 * visible, no scrolling to reach it), the five stage steps that every tab is
 * filed under, and the job's Paperwork panel beside the open tab. A route
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

  const [facts, paperworkCounts, asOf] = await Promise.all([
    loadJobStageFacts(company.id, id),
    loadJobPaperworkCounts(company.id, id),
    // The reader's calendar day, so "overdue" on the Billing step flips at
    // THEIR midnight, not the server's UTC one (lib/due-date.ts).
    viewerAsOf(),
  ]);

  // The old tab rail, refiled under five stages (components/job/jobStages.ts).
  // Every tab keeps its own route; jobStages.test.ts holds the stages' links
  // equal to the rail this replaced, for every capability combination.
  // Hiding a link is cosmetic (`lib/permissions.ts`'s `canReach`: "NOT a
  // security boundary"); each route re-checks for itself. Billing and
  // Retainage stay absent before the contract (`!isEstimateStage &&
  // showsBilling`), exactly as the rail had them.
  const stages = jobStages({
    jobId: id,
    status: summary.status,
    lifecycleStage: summary.lifecycle.stage,
    showsJobMoney,
    showsBilling,
    showsField,
    canReachPunchList: canReach(principal, "/punch-lists"),
    canReachCloseout: canReach(principal, "/closeout"),
    crewSize: summary.crewSize,
    contractSigned: facts.contractSigned,
    approvedChangeOrders: facts.approvedChangeOrders,
    invoiceCount: facts.invoiceCount,
    latestPayApp: showsBilling ? facts.latestPayApp : null,
    filesMonthlyPayApps: company.filesMonthlyPayApps,
    asOf,
  });

  const paperwork = [
    ...jobPaperworkLinks(principal, id, paperworkCounts),
    // Change orders live on the Estimate route once the job is contracted.
    ...(showsJobMoney && !isEstimateStage
      ? [changeOrderPaperworkLink(id, facts.approvedChangeOrders, facts.waitingChangeOrders)]
      : []),
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
      <JobStageNav stages={stages} />
      {/* The open stage's page, with the job's paperwork beside it on a wide
          screen and below it on a narrow one. `min-w-0` lets a wide table
          inside a tab scroll in its own box instead of pushing the panel
          off the page. NOT wrapped in print:hidden — the Overview tab's
          printable ContractSummary lives in `children` and must still
          print; the panel hides itself. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">{children}</div>
        <aside className="xl:sticky xl:top-6 xl:self-start print:hidden">
          <JobPaperworkPanel links={paperwork} />
        </aside>
      </div>
    </PageShell>
  );
}

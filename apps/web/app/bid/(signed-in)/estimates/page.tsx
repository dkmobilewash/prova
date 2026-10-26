import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { BidComingSoon } from "@/components/bid/BidComingSoon";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Estimates" };

/**
 * C Stream Bid — estimates: start a bid, the plan takeoff, the estimate and
 * bid recap, and the proposal. Steps 2-4 of the chain. A STUB in this build.
 *
 * An estimate is a `Job` at ESTIMATE status (ARCHITECTURE.md: Job/JobLineItem
 * is one unified object), which is what keeps "same account" true — a Bid
 * estimate the company wins later is the CRM job, with every line.
 *
 * PORTING BRIEF (wave 2). Every CRM href in each screen's import closure, from
 * `lib/bid/navTargets.ts`. The money and takeoff logic is NOT to be copied —
 * render the same components; only the links and the chrome change.
 *
 *   LIST — the CRM has no estimate list page of its own: `/estimating`
 *   redirects to `/jobs?status=ESTIMATE` (`app/(app)/estimating/page.tsx`).
 *   Bid needs a list of ESTIMATE-stage jobs.
 *
 *   START A BID — `app/(app)/jobs/new/page.tsx` (`/jobs` back link, :53) and
 *   `app/(app)/jobs/new/[jobId]/items/page.tsx` (`/jobs/${id}` :42 :92 :113,
 *   `/jobs` :83). `components/BidWizardSteps.tsx:62-63` hard-codes
 *   `/jobs/new` and `/jobs/new/${id}/items` as its step hrefs. AND THE SERVER
 *   ACTION REDIRECTS: `lib/actions/jobs.ts:94` `createJob` ends in
 *   `redirect(`/jobs/new/${jobId}/items`)` — the link census cannot see this
 *   (it stops at lib/), so it needs a `next` parameter or a Bid twin.
 *
 *   THE JOB SHELL — `app/(app)/jobs/[id]/(tabs)/layout.tsx` is the CRM job:
 *   `components/JobSummaryHeader.tsx` (`/jobs` :62, `/jobs/${id}#contract-
 *   signature` :108), `components/job/jobTabs.ts` (every tab, incl. crew,
 *   compliance, billing, retainage, certified payroll), `components/job/
 *   jobStages.ts` (billing, retainage, punch lists, closeout, lien waivers).
 *   Bid needs its own estimate header with three tabs: Takeoff, Estimate,
 *   Proposal. Do NOT reuse the CRM tab layout.
 *
 *   ESTIMATE + RECAP — `app/(app)/jobs/[id]/(tabs)/estimate/page.tsx`:
 *   `/jobs/${id}/proposal` :545, `/settings?tab=estimating` :578,
 *   `/jobs/${id}/takeoff` :1177, `/takeoff/${id}` :1193;
 *   `components/WallSchedule.tsx:91` `/wall-types`;
 *   `components/DocuSignPanel.tsx:282` `/settings/integrations#docusign`
 *   (contract e-sign — post-award, leave it out of Bid). The recap itself,
 *   `components/BidRecapPanel.tsx`, has NO CRM hrefs and ports as-is. The
 *   page is 1,200+ lines and also renders change orders, contract and
 *   billing-stage sections — Bid renders the estimate-stage subset only.
 *
 *   TAKEOFF — `app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx` (`/takeoff/${id}`
 *   :409, `/jobs/${id}/estimate` :420); `components/TakeoffCurrencyBanner.tsx:84`
 *   `/bids`; `components/PlanIngestPanel.tsx:300` `legend.reviewHref`
 *   (dynamic, built in lib). Full-screen workspace `app/takeoff/[id]/page.tsx`
 *   (`/jobs/${id}/takeoff` :59) — OUTSIDE `(app)` and a CRM route on the Bid
 *   host; `components/TakeoffAssemblyPanel.tsx:188,200` `/wall-types`;
 *   `components/TakeoffWorkspace.tsx:1207` `/jobs/${id}/estimate`. Bid needs
 *   `/bid/estimates/[id]/takeoff` and its own full-screen route.
 *
 *   PROPOSAL — `app/(app)/jobs/[id]/proposal/page.tsx` (`/jobs/${id}/estimate`
 *   :210 :258, `finding.fixHref` :200 built in `lib/agents/estimateCheck.ts`);
 *   `components/BidPackageBuilder.tsx:302` `/messages`, `finding.href` :327;
 *   `components/ProposalClauses.tsx:217` `/proposals` (the clause library →
 *   `/bid/settings`).
 */
export default async function BidEstimatesPage() {
  const { allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  return (
    <PageShell width="working">
      <BidComingSoon
        title="Estimates"
        purpose={
          <p>
            Start an estimate from an invite, upload the drawing set and find the walls, price the lines from your
            wall types and price book, set your markup in the bid recap, and print the proposal — one set of numbers
            from the drawings to the proposal.
          </p>
        }
      />
    </PageShell>
  );
}

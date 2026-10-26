import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { BidComingSoon } from "@/components/bid/BidComingSoon";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Settings" };

/**
 * C Stream Bid — the shop settings the chain READS, traced from the code:
 *
 *   1. Bid recap rates — `CompanyBidDefaults` (markup by cost type, overhead,
 *      profit, tax, bond, contingency) and the default waste %. Read by the
 *      recap (`lib/estimating/recap-state.ts`) and by wall types (waste).
 *      Form: `components/BidDefaultsForm.tsx` — NO CRM hrefs. Its action
 *      `saveCompanyBidDefaults` (`lib/actions/bidRecap.ts:443`) requires
 *      MANAGE_COMPLIANCE, not MANAGE_ESTIMATING — so an ESTIMATOR who can open
 *      every other Bid screen would be refused here. Founders' call.
 *   2. Opening deduction (none / large only / all) — `OpeningDeductionForm`
 *      (`components/OpeningDeductionForm.tsx`) — NO CRM hrefs; read by the
 *      takeoff when it turns openings into quantities.
 *   3. Proposal clause library — `ProposalClause`; `NewProposalClauseForm` and
 *      `ProposalClauseRow` (`components/ProposalClauses.tsx`) have no CRM href,
 *      but the same file's `JobProposalClauseBuilder` links `/proposals` at
 *      :217. CRM page: `app/(app)/proposals/page.tsx` (`/bids` :55 :75).
 *   4. Labour crafts — `CraftClassification`, the rate a wall part's
 *      production hours are costed at (`craftOptions` in
 *      `lib/wall-types-view.ts`). Managed today under the CRM's union pages
 *      (`app/(app)/union-compliance/page.tsx`); Bid needs a small crafts form
 *      or this stays a CRM-only setup step — founders' call.
 *   5. GCs — `BidInvitation.contactId` is required, and `LogBidForm` sends a
 *      person to `/contacts` to add one. Bid needs a "add a GC" form.
 *
 * Source of 1-2 today: the CRM's `app/(app)/settings/page.tsx` "estimating"
 * tab (`BidDefaultsForm` at :616, `OpeningDeductionForm` at :596). That page
 * as a whole links `/settings*`, `/phase-codes`, `/compliance` and renders job
 * stage nav — port the two forms, never the page. A STUB in this build.
 */
export default async function BidSettingsPage() {
  const { allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  return (
    <PageShell width="working">
      <BidComingSoon
        title="Settings"
        purpose={
          <p>
            The numbers your estimates read: your markup, overhead and profit, the waste you allow, whether you deduct
            openings, your standard inclusions and exclusions, your crafts&rsquo; rates, and the GCs who invite you.
          </p>
        }
      />
    </PageShell>
  );
}

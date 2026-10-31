import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { bidDefaultsView } from "@/lib/estimating/bid-defaults-view";
import { loadGcOptions } from "@/lib/jobs/gc-options";
import { BidDefaultsForm } from "@/components/BidDefaultsForm";
import { OpeningDeductionForm } from "@/components/OpeningDeductionForm";
import { NewProposalClauseForm, ProposalClauseRow } from "@/components/ProposalClauses";
import { CollapsedForm } from "@/components/CollapsedForm";
import { BidAddGcForm } from "@/components/bid/BidAddGcForm";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Settings" };

/**
 * C Stream Bid — the shop settings the chain READS, traced from the code:
 *
 *   1. Bid recap rates — `CompanyBidDefaults` (markup by cost type, overhead,
 *      profit, tax, bond, contingency) and the default waste %. Read by the
 *      recap (`lib/estimating/recap-state.ts`) and by wall types (waste).
 *   2. Opening deduction (none / large only / all), read by the takeoff when it
 *      turns openings into quantities.
 *   3. The proposal clause library — the standing inclusions and exclusions.
 *   4. GCs — `BidInvitation.contactId` is required.
 *   5. Labour crafts — the rate a wall part's production hours are costed at.
 *
 * THE CRM'S OWN FORMS, each unchanged and over the same rows (`BidDefaultsForm`,
 * `OpeningDeductionForm`, `NewProposalClauseForm`/`ProposalClauseRow`), which the
 * CRM's `/settings?tab=estimating` and `/proposals` render too. The page around
 * them is Bid's own: the CRM's settings page links `/settings*`, `/phase-codes`
 * and `/compliance` and renders job-stage nav — port the forms, never the page.
 *
 * WHO CAN SAVE WHAT is the actions', not this page's, and the page says so rather
 * than hiding the form: `saveCompanyBidDefaults` and `saveOpeningDeduction`
 * assert MANAGE_COMPLIANCE (as the CRM page they came from does), the opening
 * deduction is further owner-only, and the clause forms assert MANAGE_ESTIMATING
 * (which this whole surface already requires). An estimator without
 * MANAGE_COMPLIANCE therefore sees the current values and a sentence, not a
 * save that fails after typing. Founders' call whether Bid should widen that.
 */
export default async function BidSettingsPage() {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const { company } = context;
  const isOwner = context.role === "OWNER";
  const canSaveRates = can(context, "MANAGE_COMPLIANCE");

  const [bidDefaultsRow, clauses, gcs, crafts] = await Promise.all([
    prisma.companyBidDefaults.findUnique({ where: { companyId: company.id } }),
    prisma.proposalClause.findMany({
      where: { companyId: company.id },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, kind: true, text: true },
    }),
    loadGcOptions(company.id),
    prisma.craftClassification.findMany({
      where: { companyId: company.id },
      include: { unionLocal: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PageShell width="reading">
      <h1 className="mb-1 font-headline text-3xl font-semibold text-ink">Settings</h1>
      <p className="mb-8 max-w-prose text-sm text-ink-body">
        The numbers your estimates read: your markup, overhead and profit, the waste you allow, whether you deduct
        openings, your standard inclusions and exclusions, and the GCs who invite you.
      </p>

      <section id="bid-defaults" className="mb-10" data-bid="settings-bid-defaults">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Default markup</h2>
        <p className="mb-3 text-sm text-ink-body">
          The standing rates that fill a new estimate&rsquo;s bid recap the first time it is opened. An estimate keeps
          its own copy, so changing these never moves a bid you have already built.
        </p>
        {canSaveRates ? null : (
          <p className="mb-3 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink">
            Your access can read these but not change them &mdash; the account owner or your compliance lead saves
            them.
          </p>
        )}
        <BidDefaultsForm
          defaults={bidDefaultsView(bidDefaultsRow)}
          wastePercent={bidDefaultsRow?.defaultWastePercent?.toString() ?? null}
        />
      </section>

      <section id="opening-deduction" className="mb-10" data-bid="settings-opening-deduction">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">How you take off board</h2>
        <OpeningDeductionForm
          answer={company.openingDeduction ?? null}
          thresholdSqFt={company.openingDeductionSqFt == null ? null : Number(company.openingDeductionSqFt)}
          isOwner={isOwner}
        />
      </section>

      <section id="clauses" className="mb-10 scroll-mt-4" data-bid="settings-clauses">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Proposal clauses</h2>
        <p className="mb-3 text-sm text-ink-body">
          The inclusions, exclusions, clarifications and alternates you repeat on every bid. Add them to a proposal from
          its Proposal tab; a clause already on a proposal is a copy, so changing it here never changes one you have
          sent. Removing a clause from the library is owner-only.
        </p>
        <div className="mb-4">
          <CollapsedForm label="Add clause">
            <NewProposalClauseForm />
          </CollapsedForm>
        </div>
        {clauses.length === 0 ? (
          <p className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body" data-bid="no-clauses">
            No clauses yet. Exclusions are the spine of a bid &mdash; the &ldquo;not in our number&rdquo; that defends it
            against a GC&rsquo;s scope sheet. Write the ones you type on every job once, here.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {clauses.map((clause) => (
              <ProposalClauseRow key={clause.id} clause={clause} />
            ))}
          </ul>
        )}
      </section>

      <section id="gcs" className="mb-10" data-bid="settings-gcs">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">GCs</h2>
        <p className="mb-3 text-sm text-ink-body">
          The general contractors you bid to. Each estimate is for one of them, and an invitation needs one.
        </p>
        <div className="mb-4 rounded-lg border border-line-card bg-surface p-4">
          <BidAddGcForm />
        </div>
        {gcs.length === 0 ? (
          <p className="text-sm text-ink-body">No GCs yet.</p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-bid="gc-list">
            {gcs.map((gc) => (
              <li key={gc.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-medium text-ink">{gc.name}</span>
                <span className="text-ink-body">
                  {gc.email ?? "no email"} · {gc.jobCount} {gc.jobCount === 1 ? "job" : "jobs"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="crafts" className="mb-10" data-bid="settings-crafts">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Labour crafts</h2>
        <p className="mb-3 text-sm text-ink-body">
          The crafts a wall part&rsquo;s production rate is costed against. They are set up with your union locals and
          wage schedules in the full C Stream product; this is what your account already has.
        </p>
        {crafts.length === 0 ? (
          <p className="text-sm text-ink-body">None set up. Parts with no craft price on material alone.</p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-bid="craft-list">
            {crafts.map((craft) => (
              <li key={craft.id} className="px-4 py-3 text-sm text-ink">
                {craft.unionLocal.parentInternational} {craft.unionLocal.localNumber} &mdash; {craft.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

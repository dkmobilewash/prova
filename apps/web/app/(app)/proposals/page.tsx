import Link from "next/link";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { EmptyState } from "@/components/EmptyState";
import { NewProposalClauseForm, ProposalClauseRow } from "@/components/ProposalClauses";

/**
 * The proposal clause library — the company's reusable standard set of
 * inclusions, exclusions, clarifications and alternates. A sub reuses the
 * same exclusions on every bid; editing one here changes only proposals that
 * copy it afterwards, because a job's proposal snapshots the text.
 */
export default async function ProposalsPage() {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;

  const clauses = await prisma.proposalClause.findMany({
    where: { companyId: company.id },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, text: true },
  });

  return (
    <PageShell width="working">
      <h1 className="mb-2 text-xl font-semibold text-ink">Proposal clauses</h1>
      <p className="mb-6 text-sm text-ink-body">
        The inclusions, exclusions, clarifications and alternates you repeat on every bid. Add them
        to a job&rsquo;s proposal from its Estimate tab. A clause already on a proposal is a copy, so
        changing it here never changes a proposal you have already sent.
      </p>

      {clauses.length === 0 ? (
        <div className="mb-6">
          <EmptyState
            data-tour="proposals-empty"
            title="No clauses yet"
            purpose={
              <p>
                Exclusions are the spine of a bid — the &ldquo;not in our number&rdquo; that defends
                it against a GC&rsquo;s scope sheet. Write the ones you type on every job once, here,
                and pull them into each proposal instead of retyping them.
              </p>
            }
            actions={[{ label: "See your bids", href: "/bids" }]}
          />
        </div>
      ) : (
        <ul data-tour="proposals-list" className="mb-6 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {clauses.map((clause) => (
            <ProposalClauseRow key={clause.id} clause={clause} />
          ))}
        </ul>
      )}

      <div data-tour="proposals-add">
        <NewProposalClauseForm />
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        Removing a clause from the library is owner-only. Proposals are built per job — open a job and
        choose <span className="text-ink-label">Proposal</span>, or go to <Link href="/bids" className="text-link hover:underline">Bids</Link>.
      </p>
    </PageShell>
  );
}

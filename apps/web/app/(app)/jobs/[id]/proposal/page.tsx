import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { JobProposalClauseBuilder, JobProposalClauseRow } from "@/components/ProposalClauses";
import { money } from "@/lib/money";
import { formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { groupProposalClauses, PROPOSAL_CLAUSE_HEADINGS } from "@/lib/proposal-clauses";
import { bidRecap, RECAP_RATE_KEYS, type CostCategoryValue, type RecapRates } from "@/lib/bid-recap";
import { proposalPriceState, proposalPriceWarning } from "@/lib/estimating/proposal-recap-currency";
import { bidMargin, underCostWarning } from "@/lib/estimating/bid-margin";

/**
 * A job's bid proposal — the scope + price + exclusions document a sub sends
 * a GC. The schedule of values is the job's live line items; the clauses are
 * snapshots pulled from the company library or typed for this job.
 *
 * Print-styled HTML plus the browser's own Save as PDF, the same shape as the
 * G702/G703 page: this monorepo has no PDF library and this did not add one.
 * The builder and every Remove control are `print:hidden`, so what prints is
 * the document only.
 *
 * MANAGE_ESTIMATING, the gate /catalog and /bids use: a proposal is a bid,
 * and its clause actions assert the same capability themselves.
 */
export default async function JobProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;

  const job = await prisma.job.findFirst({
    where: { id, companyId: company.id },
    include: {
      contact: { select: { name: true } },
      lineItems: { where: { isDeleted: false }, orderBy: { createdAt: "asc" } },
      proposalClauses: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, kind: true, text: true },
      },
    },
  });
  if (!job) notFound();

  const library = await prisma.proposalClause.findMany({
    where: { companyId: company.id },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, text: true },
  });

  // THE RECAP, READ HERE FOR THE FIRST TIME — and the reason is the whole of
  // `lib/estimating/proposal-recap-currency.ts`. This page is the document a
  // GC acts on, its total is the line prices added up, and until 2026-10-02 it
  // read `JobBidRecap` nowhere at all: a bid with markup, overhead, profit,
  // bond and contingency configured printed none of them unless somebody had
  // pressed "Apply to line prices" on the estimate tab first, with nothing
  // saying so.
  //
  // It is read to WARN and never to re-price. The schedule of values below is
  // a table a GC adds up, so substituting a different grand total under it
  // would produce a document that does not reconcile with itself — which is
  // worse than the defect. `applyBidRecap` is what moves the prices, and it
  // keeps them adding up.
  const recapRow = await prisma.jobBidRecap.findFirst({
    where: { jobId: job.id, companyId: company.id },
  });

  // A null unit price is a cost-only line (general conditions, overhead):
  // it prints with no price and counts $0 toward the bid total, the same
  // rule the contract value uses everywhere else.
  const lines = job.lineItems.map((line) => {
    const quantity = Number(line.quantity);
    const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : null;
    return { id: line.id, description: line.description, unit: line.unit, quantity, unitPrice, total: unitPrice != null ? quantity * unitPrice : null };
  });
  const bidTotal = lines.reduce((sum, line) => sum + (line.total ?? 0), 0);
  const groups = groupProposalClauses(job.proposalClauses);
  const timeZone = await viewerTimeZone();

  // `addedTotal` is what the rates WOULD add, recomputed here from the job's
  // current lines rather than read off a column — the recap stores percentages
  // and never money, because "a stored total is wrong the moment a line
  // changes" (`bid-recap.prisma`).
  // The same two conversions the estimate tab makes, deliberately identical —
  // `budgetedUnitCost` and not `currentEstimatedUnitCost` (#512: the recap marks
  // up COST, and the latter is the PM's live re-forecast), and the cost category
  // narrowed rather than trusted.
  //
  // NOTE: the JOB's own recap row only, never `CompanyBidDefaults`. The estimate
  // tab falls back to the defaults because it is a FORM pre-filling an unsaved
  // row; this is a document asking "did the rates reach these prices", and
  // company defaults a person has never opened on this job have not.
  const recapState = proposalPriceState(
    recapRow
      ? {
          addedTotal: bidRecap(
            job.lineItems.map((line) => ({
              id: line.id,
              quantity: Number(line.quantity),
              unitCost: line.budgetedUnitCost != null ? Number(line.budgetedUnitCost) : null,
              unitPrice: line.unitPrice != null ? Number(line.unitPrice) : null,
              costCategory: (line.costCategory as CostCategoryValue | null) ?? null,
            })),
            Object.fromEntries(
              RECAP_RATE_KEYS.map((key) => [key, recapRow[key] != null ? Number(recapRow[key]) : null]),
            ) as RecapRates,
          ).addedTotal,
          appliedAt: recapRow.appliedAt,
          appliedTotal: recapRow.appliedTotal != null ? Number(recapRow.appliedTotal) : null,
        }
      : null,
    bidTotal,
  );
  const priceWarning = proposalPriceWarning(recapState);

  // DOES THIS BID COVER ITS OWN COST? The same conversion as above, over the
  // same lines — `budgetedUnitCost`, never `currentEstimatedUnitCost`. Nothing
  // new is queried: the page already reads every live line's cost to compute
  // `addedTotal`, and it has never RENDERED one, which is the point of the
  // print:hidden box below.
  const marginWarning = underCostWarning(
    bidMargin(
      job.lineItems.map((line) => ({
        id: line.id,
        quantity: Number(line.quantity),
        unitCost: line.budgetedUnitCost != null ? Number(line.budgetedUnitCost) : null,
        unitPrice: line.unitPrice != null ? Number(line.unitPrice) : null,
        costCategory: (line.costCategory as CostCategoryValue | null) ?? null,
      })),
    ),
    money,
  );

  return (
    // A document, so "reading" — and `print:p-0` so the printed page runs to
    // the browser's own margins, the way the G702/G703 does.
    <PageShell width="reading" className="print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/jobs/${job.id}/estimate`} className="text-sm text-link hover:underline">
          ← Back to the estimate
        </Link>
        <PrintButton />
      </div>

      {/* PRINT:HIDDEN, ADDRESSED TO THE SENDER AND NEVER TO THE GC. The
          document itself stays exactly as it was — this is a sentence to the
          person about to press Print, in the same place and the same style as
          the recap panel's own two warnings about lines with no cost. A note on
          the PRINTED page would be telling a customer our prices may be wrong,
          which is a different and much worse sentence. */}
      {priceWarning && (
        <p className="mb-6 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink print:hidden">
          {priceWarning}
        </p>
      )}

      {/* PRINT:HIDDEN FOR THE SAME REASON AND MORE SO. This page deliberately
          shows the GC no cost figure at all — the schedule of values prints
          prices and nothing else. A margin on the printed page would hand a
          customer our cost base, which is worse than the sentence above it.
          Rose rather than amber: the warnings above are fields somebody forgot
          to fill in, and this one is a bid that does not cover the work. */}
      {marginWarning && (
        <p className="mb-6 rounded-md bg-tag-rose px-3 py-2 text-sm text-tag-rose-ink print:hidden">
          {marginWarning}
        </p>
      )}

      <h1 className="text-xl font-semibold text-ink">Proposal — {job.name}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {company.name} to {job.contact.name} · {formatInstant(new Date(), timeZone, "numeric")}
      </p>
      {job.projectLocation && <p className="text-sm text-ink-muted">{job.projectLocation}</p>}

      {job.scope && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">Scope of work</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-body">{job.scope}</p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">Schedule of values</h2>
        {lines.length === 0 ? (
          <p className="mt-1 text-sm text-ink-body print:hidden">
            This job has no line items yet.{" "}
            <Link href={`/jobs/${job.id}/estimate`} className="text-link hover:underline">
              Price it on the Estimate tab
            </Link>{" "}
            and the schedule of values fills in here.
          </p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-line-row text-left text-xs text-ink-muted">
                <th className="py-1 pr-2 font-medium">Description</th>
                <th className="px-2 py-1 text-right font-medium">Qty</th>
                <th className="px-2 py-1 font-medium">Unit</th>
                <th className="px-2 py-1 text-right font-medium">Unit price</th>
                <th className="py-1 pl-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line-row">
                  <td className="py-1 pr-2 text-ink">{line.description}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{line.quantity}</td>
                  <td className="px-2 py-1 text-ink">{line.unit ?? ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{line.unitPrice != null ? money(line.unitPrice) : "—"}</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-ink">{line.total != null ? money(line.total) : "—"}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="py-2 pr-2 text-right font-medium text-ink">
                  Total bid
                </td>
                <td className="py-2 pl-2 text-right font-semibold tabular-nums text-ink">{money(bidTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {groups.map((group) => (
        <section key={group.kind} className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">
            {PROPOSAL_CLAUSE_HEADINGS[group.kind]}
          </h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-body">
            {group.clauses.map((clause) => (
              <JobProposalClauseRow key={clause.id} jobId={job.id} clauseId={clause.id}>
                {clause.text}
              </JobProposalClauseRow>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-8 rounded-lg border border-line-card bg-surface p-4 print:hidden">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Add a clause</h2>
        <p className="mb-3 text-xs text-ink-muted">
          What is in your number, what is not, what it assumes, and what the GC can add. A clause added
          here is a copy — editing your library later does not change this proposal.
        </p>
        <JobProposalClauseBuilder jobId={job.id} library={library} />
      </section>
    </PageShell>
  );
}

import { money } from "@/lib/money";
import { gapsAsFindings, type ScopeReport } from "@/lib/subcontract-review/scopeCheck";
import type { DecisionView } from "@/lib/subcontract-review/findings";
import { SubcontractFindingCard } from "@/components/SubcontractFindingCard";

/**
 * SECTION B — the subcontract against our side of the deal: the money, the
 * retainage, the addenda, and the scope gaps. Every figure here was either read
 * off the contract and found in its own quote, or recorded by a person on the
 * bid and the job; every comparison is code (`lib/subcontract-review/scopeCheck.ts`).
 */
export function SubcontractScopeCheck({
  jobId,
  scope,
  decisions,
}: {
  jobId: string;
  scope: ScopeReport;
  decisions: DecisionView[];
}) {
  const m = scope.money;
  const gaps = gapsAsFindings(scope.gaps, decisions);
  const pct = (n: number) => `${n}%`;

  return (
    <section className="mb-8" data-subcontract-review="scope-check">
      <h2 className="mb-2 text-lg font-semibold text-ink">Against your bid</h2>
      {!scope.hasWonBid && (
        <p className="mb-3 text-sm text-ink-body" data-subcontract-review="no-won-bid">
          This job has no won bid linked to it, so the contract sum and addenda cannot be compared with what you bid.
          Link the bid on <span className="text-ink">/bids</span> (Won → this job) and reload. The clause comparison
          below still uses this job&apos;s proposal clauses.
        </p>
      )}

      <dl className="mb-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-line-card bg-surface p-4 text-sm sm:grid-cols-2">
        <div data-subcontract-review="money">
          <dt className="text-ink-muted">Contract sum</dt>
          <dd className="text-ink">
            {m.contractSum ? money(m.contractSum.value) : m.conflictingSums.length > 0 ? "The contract states more than one sum" : "Not found in the readable pages"}
            {m.contractSum && <span className="ml-1 text-xs text-ink-muted">(p. {m.contractSum.cite.pageStart})</span>}
          </dd>
          {m.awardedTotal !== null && (
            <dd className="text-ink-body">
              Your awarded bid: {money(m.awardedTotal)}
              {m.acceptedAlternates !== 0 && ` (base ${money(m.base ?? 0)} + accepted alternates ${money(m.acceptedAlternates)})`}
            </dd>
          )}
          {m.verdict === "MATCHES" && <dd className="text-ok">Matches your awarded bid.</dd>}
          {(m.verdict === "CONTRACT_HIGHER" || m.verdict === "CONTRACT_LOWER") && (
            <dd className="text-warn">
              {money(Math.abs(m.difference!))} {m.verdict === "CONTRACT_HIGHER" ? "more" : "less"} than your awarded bid.
            </dd>
          )}
          {m.undecidedAlternates.length > 0 && (
            <dd className="text-ink-body">Alternates the GC has not decided: {m.undecidedAlternates.join(", ")}.</dd>
          )}
          {m.allowancesCarried > 0 && (
            <dd className="text-ink-muted">Includes {money(m.allowancesCarried)} of allowances inside the base.</dd>
          )}
          <dd className="text-ink-muted">This job&apos;s line items total {money(m.jobLineTotal)}.</dd>
        </div>

        <div data-subcontract-review="retainage">
          <dt className="text-ink-muted">Retainage</dt>
          <dd className="text-ink">
            {scope.retainage.contract ? `${pct(scope.retainage.contract.value)} in the contract` : "Not stated"}
            {scope.retainage.job !== null && ` · ${pct(scope.retainage.job)} on this job`}
            {scope.retainage.gcDefault !== null && ` · ${pct(scope.retainage.gcDefault)} usual for this GC`}
          </dd>
          {scope.retainage.notes.map((note) => (
            <dd key={note} className="text-ink-body">
              {note}
            </dd>
          ))}
        </div>

        <div data-subcontract-review="addenda" className="sm:col-span-2">
          <dt className="text-ink-muted">Addenda</dt>
          <dd className="text-ink">
            {scope.addenda.listed.length > 0
              ? `The contract incorporates addenda ${scope.addenda.listed.join(", ")}`
              : "The review found no list of addenda in the contract."}
            {scope.addenda.cite && <span className="ml-1 text-xs text-ink-muted">(p. {scope.addenda.cite.pageStart})</span>}
          </dd>
          {scope.addenda.notOnOurBid.length > 0 && (
            <dd className="text-warn">Not logged on your bid: {scope.addenda.notOnOurBid.join(", ")} — you may never have priced them.</dd>
          )}
          {scope.addenda.notAcknowledged.length > 0 && (
            <dd className="text-warn">Never acknowledged on your bid: {scope.addenda.notAcknowledged.join(", ")}.</dd>
          )}
          {scope.addenda.acknowledgedNotListed.length > 0 && (
            <dd className="text-ink-body">
              You acknowledged {scope.addenda.acknowledgedNotListed.join(", ")}, which the contract does not list.
            </dd>
          )}
        </div>
      </dl>

      <h3 className="mb-2 font-semibold text-ink">Scope</h3>
      {scope.notCarriedWithheld && (
        <p className="mb-2 text-sm text-ink-muted" data-subcontract-review="not-carried-withheld">
          {scope.notCarriedWithheld}
        </p>
      )}
      {gaps.length === 0 ? (
        <p className="text-sm text-ink-body" data-subcontract-review="no-scope-gaps">
          No scope gaps found between the contract and your proposal clauses.
        </p>
      ) : (
        <div className="rounded-lg border border-line-card bg-surface">
          {gaps.map((gap) => (
            <SubcontractFindingCard key={gap.key} jobId={jobId} finding={gap} evidenceIsOurClause={gap.evidenceIsOurClause} />
          ))}
        </div>
      )}
    </section>
  );
}

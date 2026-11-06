import { prisma } from "@prova/db";
import { groupProposalClauses, PROPOSAL_CLAUSE_HEADINGS, type ProposalClauseKindValue } from "@/lib/proposal-clauses";
import { wallScope, type WallScopeRow } from "@/lib/estimating/takeoff-item-lines";

/**
 * ── WHAT THE GC READS BESIDE THE PRICE ──
 *
 * The guided flow's last step, Send, hands the GC a signing link
 * (`app/esign/[token]`). Until now that page was the line items and a total.
 * This is the rest of a proposal: the scope by wall type with the takeoff's
 * linear and square feet (`wallScope`), the job's inclusions, exclusions,
 * clarifications and alternates, and the terms on file — the GC's payment
 * terms and the retainage, the job's own over the GC's default.
 *
 * Plain JSON on purpose: `signRequest` freezes it into the signature's
 * snapshot, so a signed proposal keeps reading exactly what was agreed.
 */
export type GcProposal = {
  scope: WallScopeRow[];
  clauses: { kind: ProposalClauseKindValue; heading: string; texts: string[] }[];
  terms: { paymentTermsDays: number | null; retainagePercent: string | null };
};

export async function loadGcProposal(companyId: string, jobId: string): Promise<GcProposal> {
  const [scope, job] = await Promise.all([
    prisma.$transaction((tx) => wallScope(tx, companyId, jobId)),
    prisma.job.findFirstOrThrow({
      where: { id: jobId, companyId },
      select: {
        retainagePercent: true,
        contact: { select: { paymentTermsDays: true, defaultRetainagePercent: true } },
        proposalClauses: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { kind: true, text: true } },
      },
    }),
  ]);
  const retainage = job.retainagePercent ?? job.contact.defaultRetainagePercent;
  return {
    scope: scope.map((row) => ({ ...row, linearFt: Math.round(row.linearFt), squareFeet: row.squareFeet === null ? null : Math.round(row.squareFeet) })),
    clauses: groupProposalClauses(job.proposalClauses).map((group) => ({
      kind: group.kind,
      heading: PROPOSAL_CLAUSE_HEADINGS[group.kind],
      texts: group.clauses.map((clause) => clause.text),
    })),
    terms: { paymentTermsDays: job.contact.paymentTermsDays, retainagePercent: retainage === null ? null : retainage.toString() },
  };
}

/** Whether a proposal says both what is in the number and what is not — what Send waits on. */
export function hasInclusionsAndExclusions(clauses: readonly { kind: string }[]): boolean {
  return clauses.some((c) => c.kind === "INCLUSION") && clauses.some((c) => c.kind === "EXCLUSION");
}

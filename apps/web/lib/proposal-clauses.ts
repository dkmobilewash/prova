/**
 * The four kinds of proposal clause, in the order a proposal prints them.
 *
 * A plain module rather than something exported from a page: an App Router
 * `page.tsx` may only export the handful of names Next recognises, and the
 * library page, the job proposal and the client builder all need these.
 */

export const PROPOSAL_CLAUSE_KINDS = ["INCLUSION", "EXCLUSION", "CLARIFICATION", "ALTERNATE"] as const;
export type ProposalClauseKindValue = (typeof PROPOSAL_CLAUSE_KINDS)[number];

export const PROPOSAL_CLAUSE_LABELS: Record<ProposalClauseKindValue, string> = {
  INCLUSION: "Inclusion",
  EXCLUSION: "Exclusion",
  CLARIFICATION: "Clarification",
  ALTERNATE: "Alternate",
};

/** Heading for a group of clauses on the printed proposal. */
export const PROPOSAL_CLAUSE_HEADINGS: Record<ProposalClauseKindValue, string> = {
  INCLUSION: "Inclusions",
  EXCLUSION: "Exclusions",
  CLARIFICATION: "Clarifications",
  ALTERNATE: "Alternates",
};

export function isProposalClauseKind(value: string): value is ProposalClauseKindValue {
  return (PROPOSAL_CLAUSE_KINDS as readonly string[]).includes(value);
}

/** Groups clauses by kind in print order, dropping kinds with none. Pure, so
 * the printed document's structure is testable without a database. */
export function groupProposalClauses<T extends { kind: string }>(
  clauses: readonly T[],
): { kind: ProposalClauseKindValue; clauses: T[] }[] {
  return PROPOSAL_CLAUSE_KINDS.map((kind) => ({
    kind,
    clauses: clauses.filter((clause) => clause.kind === kind),
  })).filter((group) => group.clauses.length > 0);
}

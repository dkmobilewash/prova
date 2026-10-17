import {
  SUBCONTRACT_FINDING_CATEGORIES,
  type SubcontractFindingCategory,
  type SubcontractSeverity,
} from "@prova/integrations/src/subcontractCategories";

/**
 * Keys, labels, ordering, decisions and the version diff for subcontract
 * findings — every rule a test should reach, kept out of the action and the
 * page so it is reachable. Nothing here talks to the database or the model,
 * and nothing here imports a Node module — the finding cards render it in the
 * browser. The key, which hashes, is in `keys.ts`.
 */

export const SUBCONTRACT_CATEGORY_LABEL: Record<SubcontractFindingCategory, string> = {
  PAYMENT: "Payment",
  RETAINAGE: "Retainage",
  BILLING: "Billing",
  LIQUIDATED_DAMAGES: "Liquidated damages",
  INDEMNITY: "Indemnity",
  DELAY_AND_SCHEDULE: "Delay and schedule",
  NOTICE: "Notice deadlines",
  TERMINATION: "Termination",
  BACKCHARGE: "Back-charges",
  WARRANTY: "Warranty",
  INSURANCE: "Insurance",
  BONDING: "Bonding",
  LIEN_WAIVER: "Lien waivers",
  FLOW_DOWN: "Flow-down",
  DISPUTE: "Disputes",
  SAFETY_SITE_ADMIN: "Safety, site and admin",
  SCOPE: "Scope and contract sum",
  OTHER: "Other",
};

/** The word beside the colour — a severity is never a colour alone. */
export const SEVERITY_WORD: Record<SubcontractSeverity, string> = {
  HIGH: "High risk",
  MEDIUM: "Medium risk",
  LOW: "Low risk",
};

const SEVERITY_RANK: Record<SubcontractSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export type SubcontractDecisionKind = "ACCEPTED" | "DISMISSED" | "NEGOTIATED";

export const DECISION_WORD: Record<SubcontractDecisionKind | "OPEN", string> = {
  OPEN: "Not reviewed yet",
  ACCEPTED: "Accepted as written",
  DISMISSED: "Dismissed",
  NEGOTIATED: "Negotiating",
};

/** A stored finding, as the page and the diff need it. */
export type FindingView = {
  id: string;
  key: string;
  category: SubcontractFindingCategory;
  subtype: string | null;
  severity: SubcontractSeverity;
  title: string;
  quote: string;
  sourceLabel: string;
  pageStart: number;
  pageEnd: number;
  sectionRef: string | null;
  explanation: string;
  suggestedPosition: string;
  questionForGc: string | null;
};

export type DecisionView = {
  key: string;
  decision: SubcontractDecisionKind;
  note: string | null;
  editedSeverity: SubcontractSeverity | null;
  editedExplanation: string | null;
  editedPosition: string | null;
};

/** A finding with the person's call laid over it. The original text is kept
 *  beside every edit, so "what the document said" is never lost to "what we
 *  decided it means". */
export type ReviewedFinding = FindingView & {
  status: SubcontractDecisionKind | "OPEN";
  note: string | null;
  effectiveSeverity: SubcontractSeverity;
  effectiveExplanation: string;
  effectivePosition: string;
  edited: boolean;
};

export function applyDecisions(findings: readonly FindingView[], decisions: readonly DecisionView[]): ReviewedFinding[] {
  const byKey = new Map(decisions.map((decision) => [decision.key, decision]));
  return findings.map((finding) => {
    const decision = byKey.get(finding.key);
    return {
      ...finding,
      status: decision?.decision ?? "OPEN",
      note: decision?.note ?? null,
      effectiveSeverity: decision?.editedSeverity ?? finding.severity,
      effectiveExplanation: decision?.editedExplanation ?? finding.explanation,
      effectivePosition: decision?.editedPosition ?? finding.suggestedPosition,
      edited: Boolean(decision?.editedSeverity || decision?.editedExplanation || decision?.editedPosition),
    };
  });
}

/** Categories in the canonical order, each with its findings HIGH first, then by page. */
export function groupByCategory<T extends { category: SubcontractFindingCategory; effectiveSeverity: SubcontractSeverity; pageStart: number }>(
  findings: readonly T[],
): { category: SubcontractFindingCategory; label: string; findings: T[] }[] {
  return SUBCONTRACT_FINDING_CATEGORIES.flatMap((category) => {
    const inCategory = findings
      .filter((finding) => finding.category === category)
      .sort(
        (a, b) => SEVERITY_RANK[a.effectiveSeverity] - SEVERITY_RANK[b.effectiveSeverity] || a.pageStart - b.pageStart,
      );
    return inCategory.length === 0 ? [] : [{ category, label: SUBCONTRACT_CATEGORY_LABEL[category], findings: inCategory }];
  });
}

export type SeverityCounts = Record<SubcontractSeverity, number>;

export function severityCounts(findings: readonly { effectiveSeverity: SubcontractSeverity; status: string }[]): SeverityCounts {
  const counts: SeverityCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const finding of findings) if (finding.status !== "DISMISSED") counts[finding.effectiveSeverity]++;
  return counts;
}

// ── The version diff ─────────────────────────────────────────────────────────

export type DiffEntry<T> =
  | { change: "UNCHANGED"; current: T; previous: T }
  | { change: "CHANGED"; current: T; previous: T }
  | { change: "NEW"; current: T }
  | { change: "REMOVED"; previous: T };

/**
 * What a new contract version changed, finding by finding. Derived on every
 * read and never stored.
 *
 *   - Same key → UNCHANGED: the clause is word-for-word the same, and a
 *     decision on it carries across by construction.
 *   - Left over on both sides with the same category AND the same non-null
 *     subtype → CHANGED, paired in page order: "retainage went from 5% to
 *     10%" is one change, not a removal and an addition. A null subtype never
 *     pairs; guessing which unlabelled clause became which is worse than
 *     showing one NEW and one REMOVED.
 *   - Anything else → NEW or REMOVED.
 */
export function diffFindings<T extends { key: string; category: string; subtype: string | null; pageStart: number }>(
  previous: readonly T[],
  current: readonly T[],
): DiffEntry<T>[] {
  const previousByKey = new Map(previous.map((finding) => [finding.key, finding]));
  const currentKeys = new Set(current.map((finding) => finding.key));
  const entries: DiffEntry<T>[] = [];

  const unmatchedCurrent: T[] = [];
  for (const finding of current) {
    const before = previousByKey.get(finding.key);
    if (before) entries.push({ change: "UNCHANGED", current: finding, previous: before });
    else unmatchedCurrent.push(finding);
  }
  const unmatchedPrevious = previous.filter((finding) => !currentKeys.has(finding.key));

  const pairKey = (finding: T) => (finding.subtype ? `${finding.category}|${finding.subtype}` : null);
  const pool = new Map<string, T[]>();
  for (const finding of [...unmatchedPrevious].sort((a, b) => a.pageStart - b.pageStart)) {
    const key = pairKey(finding);
    if (key) pool.set(key, [...(pool.get(key) ?? []), finding]);
  }
  const pairedPrevious = new Set<T>();
  for (const finding of [...unmatchedCurrent].sort((a, b) => a.pageStart - b.pageStart)) {
    const key = pairKey(finding);
    const candidates = key ? pool.get(key) : undefined;
    const before = candidates?.shift();
    if (before) {
      pairedPrevious.add(before);
      entries.push({ change: "CHANGED", current: finding, previous: before });
    } else {
      entries.push({ change: "NEW", current: finding });
    }
  }
  for (const finding of unmatchedPrevious) {
    if (!pairedPrevious.has(finding)) entries.push({ change: "REMOVED", previous: finding });
  }
  return entries;
}

/** Duplicates from overlapping chunks collapse on the key; the first wins. */
export function uniqueByKey<T extends { key: string }>(findings: readonly T[]): T[] {
  const seen = new Set<string>();
  return findings.filter((finding) => (seen.has(finding.key) ? false : (seen.add(finding.key), true)));
}

/** "p. 4", "pp. 4–5", with the section when there is one. */
export function citationLabel(finding: { pageStart: number; pageEnd: number; sectionRef: string | null }): string {
  const pages = finding.pageStart === finding.pageEnd ? `p. ${finding.pageStart}` : `pp. ${finding.pageStart}–${finding.pageEnd}`;
  return finding.sectionRef ? `${pages} · § ${finding.sectionRef.replace(/^§\s*/, "")}` : pages;
}

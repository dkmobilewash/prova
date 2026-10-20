import { citationLabel, type ReviewedFinding } from "./findings";
import type { ScopeReport } from "./scopeCheck";

/**
 * THE ONE-PAGE SUMMARY, section C of the brief — PURE CODE over findings,
 * decisions and the scope report. No second model call goes into it, so nothing
 * on it can be newer than, or different from, what the person already saw and
 * decided on the review screen: every line traces to a finding or a number.
 *
 * Dismissed findings are left out everywhere. A person's edit wins over what
 * the review wrote, as on the screen.
 */

export type SummaryLine = { text: string; cite: string | null };

export type ReviewSummary = {
  topRisks: SummaryLine[];
  moneyTerms: SummaryLine[];
  deadlines: SummaryLine[];
  insurance: SummaryLine[];
  scopeGaps: SummaryLine[];
  questions: SummaryLine[];
  unread: string | null;
};

export const TOP_RISK_LIMIT = 6;

const MONEY_CATEGORIES = new Set(["PAYMENT", "RETAINAGE", "BILLING", "LIQUIDATED_DAMAGES", "BACKCHARGE", "BONDING"]);
const DEADLINE_SUBTYPES = new Set(["BILLING_CUTOFF", "PAYMENT_TIMING", "LIEN_WAIVER_TIMING", "WARRANTY_TERM"]);

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function line(finding: ReviewedFinding): SummaryLine {
  return { text: `${finding.title} — ${finding.effectiveExplanation}`, cite: `${finding.sourceLabel}, ${citationLabel(finding)}` };
}

export function buildSummary(
  findings: readonly ReviewedFinding[],
  scope: ScopeReport | null,
  unread: string | null,
): ReviewSummary {
  const live = findings.filter((f) => f.status !== "DISMISSED");
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const byRisk = [...live].sort((a, b) => rank[a.effectiveSeverity] - rank[b.effectiveSeverity] || a.pageStart - b.pageStart);

  const moneyTerms: SummaryLine[] = [];
  if (scope) {
    const m = scope.money;
    if (m.contractSum) {
      const against =
        m.awardedTotal === null
          ? scope.hasWonBid
            ? " — no bid amount is recorded to compare it with."
            : " — this job has no won bid linked to compare it with."
          : m.verdict === "MATCHES"
            ? ` — matches your awarded bid of ${money(m.awardedTotal)}.`
            : ` — ${money(Math.abs(m.difference!))} ${m.verdict === "CONTRACT_HIGHER" ? "more" : "less"} than your awarded bid of ${money(m.awardedTotal)}.`;
      moneyTerms.push({
        text: `Contract sum ${money(m.contractSum.value)}${against}${m.undecidedAlternates.length > 0 ? ` Undecided alternates: ${m.undecidedAlternates.join(", ")}.` : ""}`,
        cite: `p. ${m.contractSum.cite.pageStart}`,
      });
    } else if (m.conflictingSums.length > 0) {
      moneyTerms.push({ text: `The contract states ${m.conflictingSums.length} different sums: ${m.conflictingSums.map((s) => money(s.value)).join(", ")}.`, cite: null });
    }
    for (const note of scope.retainage.notes) moneyTerms.push({ text: note, cite: scope.retainage.contract ? `p. ${scope.retainage.contract.cite.pageStart}` : null });
  }
  for (const finding of byRisk) if (MONEY_CATEGORIES.has(finding.category)) moneyTerms.push(line(finding));

  const deadlines = byRisk
    .filter((f) => f.category === "NOTICE" || (f.subtype !== null && DEADLINE_SUBTYPES.has(f.subtype)))
    .map(line);

  const insurance = byRisk.filter((f) => f.category === "INSURANCE").map(line);

  const scopeGaps: SummaryLine[] = [];
  if (scope) {
    for (const gap of scope.gaps) {
      if (gap.kind === "NOT_IN_OUR_PRICED_SCOPE") continue; // a prompt to check, not a gap to print
      scopeGaps.push({
        text: `${gap.title}: “${gap.evidence}”`,
        cite: gap.pageStart === null ? "your proposal" : gap.pageStart === gap.pageEnd ? `p. ${gap.pageStart}` : `pp. ${gap.pageStart}–${gap.pageEnd}`,
      });
    }
    if (scope.addenda.notOnOurBid.length > 0) {
      scopeGaps.push({ text: `The contract incorporates addenda you never logged: ${scope.addenda.notOnOurBid.join(", ")}.`, cite: scope.addenda.cite ? `p. ${scope.addenda.cite.pageStart}` : null });
    }
    if (scope.addenda.notAcknowledged.length > 0) {
      scopeGaps.push({ text: `Addenda you never acknowledged: ${scope.addenda.notAcknowledged.join(", ")}.`, cite: null });
    }
  }

  const questions: SummaryLine[] = live
    .filter((f) => f.questionForGc && (f.status === "OPEN" || f.status === "NEGOTIATED"))
    .sort((a, b) => rank[a.effectiveSeverity] - rank[b.effectiveSeverity])
    .map((f) => ({ text: f.questionForGc!, cite: citationLabel(f) }));
  if (scope) {
    for (const gap of scope.gaps) {
      if (gap.kind === "NOT_CARRIED") {
        questions.push({ text: `Will you attach our proposal's terms to the subcontract, including: “${gap.evidence}”?`, cite: "your proposal" });
      }
    }
  }

  return {
    topRisks: byRisk.filter((f) => f.effectiveSeverity !== "LOW").slice(0, TOP_RISK_LIMIT).map(line),
    moneyTerms,
    deadlines,
    insurance,
    scopeGaps,
    questions,
    unread,
  };
}

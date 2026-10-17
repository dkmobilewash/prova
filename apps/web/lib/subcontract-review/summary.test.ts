import { describe, expect, it } from "vitest";
import { applyDecisions, type FindingView } from "./findings";
import { scopeReport } from "./scopeCheck";
import { buildSummary, TOP_RISK_LIMIT } from "./summary";

const view = (over: Partial<FindingView>): FindingView => ({
  id: over.key ?? "f", key: "k", category: "OTHER", subtype: null, severity: "MEDIUM", title: "t", quote: "q",
  sourceLabel: "Subcontract agreement", pageStart: 1, pageEnd: 1, sectionRef: null, explanation: "e",
  suggestedPosition: "p", questionForGc: null, ...over,
});

const findings = applyDecisions(
  [
    view({ key: "pay", category: "PAYMENT", severity: "HIGH", title: "Pay-if-paid", questionForGc: "Will you accept pay-when-paid?" }),
    view({ key: "notice", category: "NOTICE", severity: "MEDIUM", title: "48-hour notice" }),
    view({ key: "ins", category: "INSURANCE", severity: "LOW", title: "AI endorsement" }),
    view({ key: "ld", category: "LIQUIDATED_DAMAGES", severity: "HIGH", title: "$1,500/day LDs", questionForGc: "Will you cap LDs?" }),
  ],
  [{ key: "ld", decision: "DISMISSED", note: null, editedSeverity: null, editedExplanation: null, editedPosition: null }],
);

describe("the one-page summary", () => {
  it("is built from the findings alone — dismissed ones gone, HIGH first, each line cited", () => {
    const summary = buildSummary(findings, null, null);
    expect(summary.topRisks.map((l) => l.text)).toEqual(["Pay-if-paid — e", "48-hour notice — e"]);
    expect(summary.topRisks.every((l) => l.cite?.includes("p. 1"))).toBe(true);
    expect(summary.deadlines.map((l) => l.text)).toEqual(["48-hour notice — e"]);
    expect(summary.insurance.map((l) => l.text)).toEqual(["AI endorsement — e"]);
    expect(summary.moneyTerms.map((l) => l.text)).toEqual(["Pay-if-paid — e"]);
    // A dismissed finding's question is not asked.
    expect(summary.questions.map((l) => l.text)).toEqual(["Will you accept pay-when-paid?"]);
  });

  it("puts the money comparison and the scope gaps in, from the scope report", () => {
    const scope = scopeReport({
      bid: { projectName: "p", bidAmount: 400000, lines: [], addenda: [] },
      clauses: [{ id: "c1", kind: "EXCLUSION", text: "Final cleaning is excluded." }],
      jobRetainagePercent: null,
      gcDefaultRetainagePercent: null,
      jobLineTotal: 0,
      findings: [{ key: "s", category: "SCOPE", subtype: "CONTRACT_SUM", quote: "q", pageStart: 1, pageEnd: 1, terms: { contractSum: 412000 } }],
      scopeChecks: [],
      reviewComplete: true,
      scopeChecked: true,
      pagesRead: 3,
      unreadPages: 0,
    });
    const summary = buildSummary(findings, scope, "Subcontract agreement, pages 5");
    expect(summary.moneyTerms[0]!.text).toBe("Contract sum $412,000.00 — $12,000.00 more than your awarded bid of $400,000.00.");
    expect(summary.scopeGaps[0]!.text).toContain("Final cleaning is excluded.");
    expect(summary.questions.at(-1)!.text).toContain("Final cleaning is excluded.");
    expect(summary.unread).toBe("Subcontract agreement, pages 5");
  });

  it("caps the top risks", () => {
    const many = applyDecisions(Array.from({ length: 10 }, (_, i) => view({ key: `h${i}`, severity: "HIGH" })), []);
    expect(buildSummary(many, null, null).topRisks).toHaveLength(TOP_RISK_LIMIT);
  });
});

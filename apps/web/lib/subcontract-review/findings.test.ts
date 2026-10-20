import { describe, expect, it } from "vitest";
import {
  applyDecisions,
  citationLabel,
  diffFindings,
  groupByCategory,
  severityCounts,
  uniqueByKey,
  type FindingView,
} from "./findings";
import { findingKey } from "./keys";

const view = (over: Partial<FindingView>): FindingView => ({
  id: "f", key: "k", category: "PAYMENT", subtype: null, severity: "MEDIUM", title: "t", quote: "q",
  sourceLabel: "Agreement", pageStart: 1, pageEnd: 1, sectionRef: null, explanation: "e",
  suggestedPosition: "p", questionForGc: null, ...over,
});

describe("findingKey", () => {
  it("is stable across typographic variants and whitespace, and changes with one word", () => {
    const a = findingKey("RETAINAGE", "Contractor shall retain ten percent (10%) of each payment.");
    expect(findingKey("RETAINAGE", "Contractor  shall retain ten percent (10%) of each payment.")).toBe(a);
    expect(findingKey("RETAINAGE", "Contractor shall retain five percent (5%) of each payment.")).not.toBe(a);
    expect(findingKey("PAYMENT", "Contractor shall retain ten percent (10%) of each payment.")).not.toBe(a);
    expect(a).toMatch(/^RETAINAGE:[0-9a-f]{16}$/);
  });
  it("treats a curly apostrophe as the straight one, the same equivalence the citation check accepts", () => {
    expect(findingKey("OTHER", "the Owner’s written approval is required")).toBe(findingKey("OTHER", "the Owner's written approval is required"));
  });
});

describe("applyDecisions", () => {
  it("lays a decision over a finding by key and keeps the original text beside the edit", () => {
    const [open, edited] = applyDecisions(
      [view({ key: "a" }), view({ key: "b", severity: "HIGH", explanation: "original" })],
      [{ key: "b", decision: "NEGOTIATED", note: "asked for 5%", editedSeverity: "LOW", editedExplanation: "ours", editedPosition: null }],
    );
    expect(open!.status).toBe("OPEN");
    expect(edited!.status).toBe("NEGOTIATED");
    expect(edited!.effectiveSeverity).toBe("LOW");
    expect(edited!.effectiveExplanation).toBe("ours");
    expect(edited!.explanation).toBe("original");
    expect(edited!.effectivePosition).toBe("p");
    expect(edited!.edited).toBe(true);
  });
});

describe("grouping and counts", () => {
  it("groups in canonical category order with HIGH first, and leaves dismissed findings out of the counts", () => {
    const reviewed = applyDecisions(
      [
        view({ key: "1", category: "INSURANCE", severity: "LOW", pageStart: 2 }),
        view({ key: "2", category: "PAYMENT", severity: "LOW", pageStart: 1 }),
        view({ key: "3", category: "PAYMENT", severity: "HIGH", pageStart: 9 }),
      ],
      [{ key: "1", decision: "DISMISSED", note: null, editedSeverity: null, editedExplanation: null, editedPosition: null }],
    );
    const groups = groupByCategory(reviewed);
    expect(groups.map((group) => group.category)).toEqual(["PAYMENT", "INSURANCE"]);
    expect(groups[0]!.findings.map((finding) => finding.key)).toEqual(["3", "2"]);
    expect(severityCounts(reviewed)).toEqual({ HIGH: 1, MEDIUM: 0, LOW: 1 });
  });
});

describe("diffFindings — what a new contract version changed", () => {
  it("names unchanged, changed, new and removed clauses", () => {
    const previous = [
      view({ key: "same", category: "PAYMENT", subtype: "PAY_IF_PAID" }),
      view({ key: "ret5", category: "RETAINAGE", subtype: "RETAINAGE_RATE", pageStart: 4 }),
      view({ key: "ld", category: "LIQUIDATED_DAMAGES", subtype: "LD_RATE" }),
    ];
    const current = [
      view({ key: "same", category: "PAYMENT", subtype: "PAY_IF_PAID" }),
      view({ key: "ret10", category: "RETAINAGE", subtype: "RETAINAGE_RATE", pageStart: 5 }),
      view({ key: "bond", category: "BONDING", subtype: null }),
    ];
    const byChange = Object.fromEntries(
      diffFindings(previous, current).map((entry) => [
        entry.change,
        "current" in entry ? entry.current.key : entry.previous.key,
      ]),
    );
    expect(byChange).toEqual({ UNCHANGED: "same", CHANGED: "ret10", NEW: "bond", REMOVED: "ld" });
  });

  it("never pairs two clauses that carry no subtype — one NEW and one REMOVED instead of a guess", () => {
    const entries = diffFindings([view({ key: "a", category: "OTHER" })], [view({ key: "b", category: "OTHER" })]);
    expect(entries.map((entry) => entry.change).sort()).toEqual(["NEW", "REMOVED"]);
  });

  it("is empty-safe in both directions", () => {
    expect(diffFindings([], [view({ key: "a" })]).map((entry) => entry.change)).toEqual(["NEW"]);
    expect(diffFindings([view({ key: "a" })], []).map((entry) => entry.change)).toEqual(["REMOVED"]);
  });
});

describe("small helpers", () => {
  it("collapses overlap duplicates on the key, first wins", () => {
    expect(uniqueByKey([{ key: "a", n: 1 }, { key: "a", n: 2 }, { key: "b", n: 3 }]).map((x) => x.n)).toEqual([1, 3]);
  });
  it("labels a citation by page and printed section", () => {
    expect(citationLabel({ pageStart: 4, pageEnd: 4, sectionRef: "6.2" })).toBe("p. 4 · § 6.2");
    expect(citationLabel({ pageStart: 4, pageEnd: 5, sectionRef: null })).toBe("pp. 4–5");
  });
});

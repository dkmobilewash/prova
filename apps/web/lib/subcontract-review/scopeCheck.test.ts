import { describe, expect, it } from "vitest";
import { narrowSubcontractChunk, renderOurSide } from "@prova/integrations/src/subcontractReview";
import { addendaListedIn } from "./addendaList";
import { validateScopeChecks, type ChunkPage } from "./citations";
import { notCarriedKey } from "./keys";
import { buildOurSide, MAX_PRICED_LINES } from "./ourSide";
import { gapsAsFindings, scopeReport, type ScopeInputs } from "./scopeCheck";

const base: ScopeInputs = {
  bid: {
    projectName: "ZZ Office",
    bidAmount: 400000,
    lines: [
      { kind: "ALTERNATE", label: "Alt 1 — Level 5 lobby", description: null, amount: 12000, unit: null, unitPrice: null, accepted: true },
      { kind: "ALTERNATE", label: "Alt 2 — soffits", description: null, amount: 8000, unit: null, unitPrice: null, accepted: null },
      { kind: "ALLOWANCE", label: "Patching allowance", description: null, amount: 5000, unit: null, unitPrice: null, accepted: null },
    ],
    addenda: [
      { reference: "Addendum 1", acknowledgedOn: new Date("2026-09-01"), affectsPricedScope: false },
      { reference: "Addendum 2", acknowledgedOn: null, affectsPricedScope: true },
      { reference: "Addendum 4", acknowledgedOn: new Date("2026-09-10"), affectsPricedScope: false },
    ],
  },
  clauses: [
    { id: "c-fire", kind: "EXCLUSION", text: "Firestopping and fire caulking are excluded." },
    { id: "c-clean", kind: "EXCLUSION", text: "Final cleaning is excluded." },
    { id: "c-incl", kind: "INCLUSION", text: "Level 4 finish throughout." },
  ],
  jobRetainagePercent: 5,
  gcDefaultRetainagePercent: 10,
  jobLineTotal: 398500.5,
  findings: [
    { key: "SCOPE:a", category: "SCOPE", subtype: "CONTRACT_SUM", quote: "the Subcontract Sum of $412,000.00", pageStart: 1, pageEnd: 1, terms: { contractSum: 412000 } },
    { key: "RETAINAGE:b", category: "RETAINAGE", subtype: "RETAINAGE_RATE", quote: "retain ten percent (10%)", pageStart: 2, pageEnd: 2, terms: { retainagePercent: 10 } },
    { key: "SCOPE:c", category: "SCOPE", subtype: "ADDENDA_LIST", quote: "the Drawings and Addenda Nos. 1, 2 and 3 dated 9/14/2026", pageStart: 1, pageEnd: 1, terms: null },
  ],
  scopeChecks: [
    { key: "k1", relation: "CONTRADICTS_OUR_CLAUSE", clauseId: "c-fire", clauseKind: "EXCLUSION", clauseText: "Firestopping and fire caulking are excluded.", quote: "Subcontractor shall furnish and install firestopping and fire caulking", pageStart: 1, pageEnd: 1, explanation: "The contract puts firestopping on you." },
    { key: "k2", relation: "CARRIES_OUR_CLAUSE", clauseId: "c-incl", clauseKind: "INCLUSION", clauseText: "Level 4 finish throughout.", quote: "Level 4 finish", pageStart: 3, pageEnd: 3, explanation: "Carried." },
  ],
  reviewComplete: true,
  scopeChecked: true,
  pagesRead: 4,
  unreadPages: 1,
};

describe("money — the contract sum against the awarded bid, by code", () => {
  it("matches base + ACCEPTED alternates only, and names the undecided ones", () => {
    const { money } = scopeReport(base);
    expect(money.awardedTotal).toBe(412000);
    expect(money.verdict).toBe("MATCHES");
    expect(money.undecidedAlternates).toEqual(["Alt 2 — soffits"]);
    // Allowances sit INSIDE the base and are never added to it.
    expect(money.allowancesCarried).toBe(5000);
  });

  it("says how far apart, and which way", () => {
    const lower = scopeReport({ ...base, findings: [{ ...base.findings[0]!, terms: { contractSum: 405500 } }] });
    expect(lower.money).toMatchObject({ verdict: "CONTRACT_LOWER", difference: -6500 });
  });

  it("refuses to choose between two sums the contract states, and has nothing to compare without a won bid", () => {
    const two = scopeReport({ ...base, findings: [base.findings[0]!, { ...base.findings[0]!, key: "SCOPE:z", terms: { contractSum: 420000 } }] });
    expect(two.money.contractSum).toBeNull();
    expect(two.money.conflictingSums.map((s) => s.value)).toEqual([412000, 420000]);
    const noBid = scopeReport({ ...base, bid: null });
    expect(noBid.hasWonBid).toBe(false);
    expect(noBid.money.verdict).toBe("UNKNOWN");
  });
});

describe("retainage", () => {
  it("names the job's rate and the GC's usual rate when either differs from the contract", () => {
    const { retainage } = scopeReport(base);
    expect(retainage.contract?.value).toBe(10);
    expect(retainage.notes.join(" ")).toMatch(/withholds 10%; this job is set to 5%/);
    expect(retainage.notes.join(" ")).not.toMatch(/usual rate/); // the GC default IS 10
  });
});

describe("addenda", () => {
  it("flags an addendum the contract incorporates that is not on our bid, and one we never acknowledged", () => {
    const { addenda } = scopeReport(base);
    expect(addenda.listed).toEqual([1, 2, 3]);
    expect(addenda.notOnOurBid).toEqual([3]);
    expect(addenda.notAcknowledged).toEqual(["Addendum 2"]);
    expect(addenda.acknowledgedNotListed).toEqual(["Addendum 4"]);
  });

  it("reads the forms contracts use, and never a date as an addendum", () => {
    expect(addendaListedIn("Addendum No. 1 dated 3/2/2026 and Addendum No. 2")).toEqual([1, 2]);
    expect(addendaListedIn("Addenda #1 through #4, inclusive")).toEqual([1, 2, 3, 4]);
    expect(addendaListedIn("Addenda 1-3 issued March 4, 2026")).toEqual([1, 2, 3]);
    expect(addendaListedIn("the Drawings listed in Exhibit B, revision 7")).toEqual([]);
  });
});

describe("scope gaps", () => {
  it("lists a contradiction with its contract quote, and an exclusion not carried with OUR words and what was searched", () => {
    const { gaps } = scopeReport(base);
    const contradiction = gaps.find((g) => g.kind === "CONTRADICTS_OUR_CLAUSE")!;
    expect(contradiction.evidenceIsOurClause).toBe(false);
    expect(contradiction.pageStart).toBe(1);
    const notCarried = gaps.filter((g) => g.kind === "NOT_CARRIED");
    // Only the cleaning exclusion: the fire-caulking one is already listed as
    // CONTRADICTED, and the inclusion is never a candidate.
    expect(notCarried.map((g) => g.key)).toEqual([notCarriedKey("c-clean")]);
    expect(notCarried[0]!.evidenceIsOurClause).toBe(true);
    expect(notCarried[0]!.explanation).toMatch(/Searched 4 readable pages; 1 unread page was not searched/);
  });

  it("withholds 'not carried' until the whole contract was read, and on a review run before the scope check existed", () => {
    expect(scopeReport({ ...base, reviewComplete: false }).gaps.some((g) => g.kind === "NOT_CARRIED")).toBe(false);
    expect(scopeReport({ ...base, reviewComplete: false }).notCarriedWithheld).toMatch(/whole contract/);
    expect(scopeReport({ ...base, scopeChecked: false }).notCarriedWithheld).toMatch(/Run it again/);
  });

  it("decides a gap on its own key, so a person's call on it survives a re-read", () => {
    const report = scopeReport(base);
    const [first] = gapsAsFindings(report.gaps, [
      { key: "k1", decision: "NEGOTIATED", note: "Struck in redline", editedSeverity: null, editedExplanation: null, editedPosition: null },
    ]);
    expect(first).toMatchObject({ key: "k1", status: "NEGOTIATED", note: "Struck in redline", effectiveSeverity: "HIGH" });
  });
});

describe("our side, as the model is given it", () => {
  it("refs clauses C1…, de-duplicates priced lines, leaves out a rejected alternate, and caps the list", () => {
    const side = buildOurSide(
      base.clauses,
      ["5/8 Type X board", "5/8  type x board", "Metal studs 3-5/8"],
      [
        { kind: "ALTERNATE", label: "Alt 3", description: "rejected work", accepted: false },
        { kind: "ALLOWANCE", label: "Patching", description: null, accepted: null },
      ],
    );
    expect(side.ourSide.clauses.map((c) => c.ref)).toEqual(["C1", "C2", "C3"]);
    expect(side.clauseByRef.get("C2")?.id).toBe("c-clean");
    expect(side.ourSide.priced).toEqual(["5/8 Type X board", "Metal studs 3-5/8", "Allowance: Patching"]);
    const many = buildOurSide([], Array.from({ length: 200 }, (_, i) => `line ${i}`), []);
    expect(many.ourSide.priced).toHaveLength(MAX_PRICED_LINES);
  });

  it("renders nothing when there is no our side, so a risk-only review sends no empty heading", () => {
    expect(renderOurSide({ clauses: [], priced: [] })).toBe("");
    expect(renderOurSide(undefined)).toBe("");
    expect(renderOurSide(buildOurSide(base.clauses, [], []).ourSide)).toContain("C1 [EXCLUSION] Firestopping");
  });
});

describe("the scope-check gate", () => {
  const pages: ChunkPage[] = [{ page: 1, lines: ["1.2 Subcontractor shall furnish and install firestopping and fire caulking at all rated assemblies."] }];
  const { clauseByRef } = buildOurSide(base.clauses, [], []);

  it("keeps a check whose quote is on the page and whose clause ref we gave, and drops an invented ref or quote", () => {
    const result = validateScopeChecks(
      [
        { relation: "CONTRADICTS_OUR_CLAUSE", clauseRef: "C1", quote: "furnish and install firestopping and fire caulking", explanation: "Contradicts." },
        { relation: "CONTRADICTS_OUR_CLAUSE", clauseRef: "C9", quote: "furnish and install firestopping and fire caulking", explanation: "No such clause." },
        { relation: "CARRIES_OUR_CLAUSE", clauseRef: null, quote: "furnish and install firestopping and fire caulking", explanation: "Names no clause." },
        { relation: "NOT_IN_OUR_PRICED_SCOPE", clauseRef: null, quote: "Subcontractor shall paint all exposed steel.", explanation: "Not on the page." },
      ],
      pages,
      clauseByRef,
    );
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.clause?.id).toBe("c-fire");
    expect(result.dropped).toBe(3);
  });

  it("drops an unknown relation at the boundary rather than defaulting it", () => {
    const narrowed = narrowSubcontractChunk({
      findings: [],
      scopeChecks: [{ relation: "PROBABLY_FINE", clauseRef: "C1", quote: "x", explanation: "y" }],
      readingReason: "r",
    });
    expect(narrowed.scopeChecks).toEqual([]);
  });
});

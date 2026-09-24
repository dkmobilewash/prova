import { describe, expect, it } from "vitest";
import { groupProposalClauses, isProposalClauseKind, PROPOSAL_CLAUSE_KINDS } from "./proposal-clauses";

describe("groupProposalClauses", () => {
  it("prints inclusions, exclusions, clarifications, alternates — in that order, whatever order they were added", () => {
    const groups = groupProposalClauses([
      { id: "a", kind: "ALTERNATE", text: "Add Level 5 finish in lobby" },
      { id: "e1", kind: "EXCLUSION", text: "Excluded: dumpsters" },
      { id: "i", kind: "INCLUSION", text: "Included: fire caulking at our penetrations" },
      { id: "e2", kind: "EXCLUSION", text: "Excluded: overtime" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["INCLUSION", "EXCLUSION", "ALTERNATE"]);
    // Within a kind, the order the rows arrived in is kept.
    expect(groups[1].clauses.map((c) => c.id)).toEqual(["e1", "e2"]);
  });

  it("drops a kind with no clauses rather than printing an empty heading", () => {
    const groups = groupProposalClauses([{ id: "e", kind: "EXCLUSION", text: "x" }]);
    expect(groups).toHaveLength(1);
    expect(groupProposalClauses([])).toEqual([]);
  });

  it("never files a clause under a kind it does not have", () => {
    const groups = groupProposalClauses([{ id: "x", kind: "NOT_A_KIND", text: "x" }]);
    expect(groups).toEqual([]);
  });
});

describe("isProposalClauseKind", () => {
  it("accepts exactly the four kinds", () => {
    for (const kind of PROPOSAL_CLAUSE_KINDS) expect(isProposalClauseKind(kind)).toBe(true);
    expect(isProposalClauseKind("exclusion")).toBe(false);
    expect(isProposalClauseKind("")).toBe(false);
  });
});

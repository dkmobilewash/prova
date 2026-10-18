import { describe, expect, it } from "vitest";
import {
  proposalFacts,
  uncoveredFacts,
  type FactSpecReading,
  type ProposalFactsInput,
} from "./proposal-facts";

/**
 * The half that decides what goes on a scope letter, with no model involved.
 *
 * The cases are chosen so a failure on each means something different: one
 * group is about gathering the facts, one about `priced` being honest where it
 * cannot be known, and one about coverage — which is the part that decides
 * whether this reads as a tool or as a nag.
 */

const EMPTY: ProposalFactsInput = {
  specReadings: [],
  missingIndirects: [],
  carriedPackages: [],
  addenda: null,
  drawingBasis: null,
  drafts: [],
};

const LEVEL_5: FactSpecReading = {
  id: "read1",
  sectionNumber: "09 21 16",
  findings: [
    {
      ordinal: 1,
      label: "Level 5 at public areas",
      requirement: "Level 5 finish at all public areas and lobbies",
      quote: "Provide Level 5 finish at all public areas, lobbies and elevator lobbies.",
      sourcePageLabel: "Page 12",
    },
  ],
};

describe("gathering what the bid knows", () => {
  it("finds nothing on an empty bid rather than throwing", () => {
    expect(proposalFacts(EMPTY)).toEqual([]);
    expect(uncoveredFacts(EMPTY)).toEqual([]);
  });

  it("turns a spec finding into a citable fact", () => {
    const [fact] = proposalFacts({ ...EMPTY, specReadings: [LEVEL_5] });
    expect(fact.kind).toBe("SPEC_FINDING");
    expect(fact.summary).toContain("09 21 16 requires");
    expect(fact.summary).toContain("Level 5 finish at all public areas");
    // The quote AND where to find it, as one string a GC could be shown.
    expect(fact.citation).toContain("Provide Level 5 finish");
    expect(fact.citation).toContain("09 21 16");
    expect(fact.citation).toContain("Page 12");
  });

  it("still names the requirement when the section number is unknown", () => {
    const [fact] = proposalFacts({
      ...EMPTY,
      specReadings: [{ ...LEVEL_5, sectionNumber: null }],
    });
    expect(fact.summary).toBe("Level 5 finish at all public areas and lobbies");
    // The citation still says WHERE — a page label is a usable reference even
    // when the section number is unknown, and dropping it would throw away the
    // only thing that makes the quote checkable.
    expect(fact.citation).toContain("Page 12");
    expect(fact.citation).not.toContain("09 21 16");
  });

  it("drops a citation for a finding that carries no quote, rather than inventing one", () => {
    const [fact] = proposalFacts({
      ...EMPTY,
      specReadings: [{ ...LEVEL_5, findings: [{ ...LEVEL_5.findings[0], quote: "   " }] }],
    });
    expect(fact.citation).toBeNull();
  });

  it("turns a missing indirect into a fact about OUR estimate, with no citation", () => {
    const [fact] = proposalFacts({
      ...EMPTY,
      missingIndirects: [{ kind: "DUMPSTERS", label: "Dumpsters", covers: "debris removal" }],
    });
    expect(fact.kind).toBe("MISSING_INDIRECT");
    expect(fact.summary).toContain("Nothing on the estimate carries dumpsters");
    // No document said this. A citation here would make a derived check look
    // like a quotation.
    expect(fact.citation).toBeNull();
    expect(fact.priced).toBe(false);
  });

  it("names the vendor and the package for a carried quote", () => {
    const [fact] = proposalFacts({
      ...EMPTY,
      carriedPackages: [{ id: "q1", vendorName: "Alpha Drywall", packageLabel: "Metal stud framing" }],
    });
    expect(fact.summary).toBe("Metal stud framing is carried from Alpha Drywall's quote.");
    expect(fact.priced).toBe(true);
  });

  it("makes ONE fact for all the addenda, not one each", () => {
    // The letter says "based on Addenda 1 through 3" in a single clause. Three
    // clauses saying one each is noise on a document read in two minutes.
    const facts = proposalFacts({ ...EMPTY, addenda: { references: ["1", "2", "3"] } });
    expect(facts).toHaveLength(1);
    expect(facts[0].summary).toBe("This bid is priced on Addendum 1, Addendum 2 and Addendum 3.");
  });

  it("says nothing about addenda when there are none", () => {
    expect(proposalFacts({ ...EMPTY, addenda: { references: [] } })).toEqual([]);
  });

  it("names the drawing set, with or without a date", () => {
    const dated = proposalFacts({ ...EMPTY, drawingBasis: { label: "Permit Set", issuedOn: "2026-08-14" } });
    expect(dated[0].summary).toContain("issued 2026-08-14");
    const undated = proposalFacts({ ...EMPTY, drawingBasis: { label: "Permit Set", issuedOn: null } });
    expect(undated[0].summary).toBe("Quantities were measured from Permit Set.");
  });
});

describe("`priced` is honest about what cannot be known", () => {
  it("is NULL for a spec finding, never false", () => {
    // Matching "Level 5 finish at public areas" to a line item means reading
    // line text for meaning, which this repo refuses. A false here would make
    // the letter claim the bid excludes something nobody checked.
    const [fact] = proposalFacts({ ...EMPTY, specReadings: [LEVEL_5] });
    expect(fact.priced).toBeNull();
    expect(fact.priced).not.toBe(false);
  });

  it("is FALSE only where a declared check already answered it", () => {
    // `missingIndirects` reads `JobLineItem.indirectKind`, which is a declared
    // value — so "no dumpster line exists" is a fact and not a reading.
    const [fact] = proposalFacts({
      ...EMPTY,
      missingIndirects: [{ kind: "DUMPSTERS", label: "Dumpsters", covers: "debris" }],
    });
    expect(fact.priced).toBe(false);
  });

  it("is TRUE for something the estimate demonstrably carries", () => {
    const [fact] = proposalFacts({
      ...EMPTY,
      carriedPackages: [{ id: "q1", vendorName: "Alpha", packageLabel: "EIFS" }],
    });
    expect(fact.priced).toBe(true);
  });
});

describe("coverage, which decides tool or nag", () => {
  const input: ProposalFactsInput = {
    ...EMPTY,
    specReadings: [LEVEL_5],
    missingIndirects: [{ kind: "DUMPSTERS", label: "Dumpsters", covers: "debris" }],
  };

  it("reports both facts when nothing has been drafted", () => {
    expect(uncoveredFacts(input)).toHaveLength(2);
  });

  it("STOPS PROPOSING a fact once a draft exists for it", () => {
    const covered = uncoveredFacts({ ...input, drafts: [{ factRef: "read1:1" }] });
    expect(covered.map((f) => f.kind)).toEqual(["MISSING_INDIRECT"]);
  });

  it("treats a DISMISSED fact as answered, which is the whole point", () => {
    // The status is not passed in on purpose: any draft counts. The estimator
    // has read it and decided it does not belong on the letter, and
    // re-proposing it next time is how a panel becomes something people ignore.
    const none = uncoveredFacts({ ...input, drafts: [{ factRef: "read1:1" }, { factRef: "indirect:DUMPSTERS" }] });
    expect(none).toEqual([]);
  });

  it("still counts every fact even when all of them are answered", () => {
    // A panel that can only count gaps cannot tell "you have answered
    // everything" from "there was never anything to answer".
    const all = { ...input, drafts: [{ factRef: "read1:1" }, { factRef: "indirect:DUMPSTERS" }] };
    expect(proposalFacts(all)).toHaveLength(2);
    expect(uncoveredFacts(all)).toHaveLength(0);
  });

  it("ignores a draft whose ref matches nothing, rather than hiding a fact", () => {
    const still = uncoveredFacts({ ...input, drafts: [{ factRef: "read9:4" }] });
    expect(still).toHaveLength(2);
  });
});

describe("refs are stable, because coverage is keyed on them", () => {
  it("gives the same fact the same ref across two calls", () => {
    const once = proposalFacts({ ...EMPTY, specReadings: [LEVEL_5] })[0].ref;
    const twice = proposalFacts({ ...EMPTY, specReadings: [LEVEL_5] })[0].ref;
    expect(once).toBe(twice);
  });

  it("gives a NEW reading of the same section a new ref", () => {
    // Somebody re-read the document and may have got a different answer. That
    // is legitimately a new fact to answer, not the old one again.
    const first = proposalFacts({ ...EMPTY, specReadings: [LEVEL_5] })[0].ref;
    const second = proposalFacts({ ...EMPTY, specReadings: [{ ...LEVEL_5, id: "read2" }] })[0].ref;
    expect(second).not.toBe(first);
  });

  it("gives a new ref when an addendum is ISSUED, so the letter cannot stay wrong", () => {
    const three = proposalFacts({ ...EMPTY, addenda: { references: ["1", "2", "3"] } })[0].ref;
    const four = proposalFacts({ ...EMPTY, addenda: { references: ["1", "2", "3", "4"] } })[0].ref;
    expect(four).not.toBe(three);
  });

  it("keeps two findings of one reading apart", () => {
    const facts = proposalFacts({
      ...EMPTY,
      specReadings: [
        {
          ...LEVEL_5,
          findings: [LEVEL_5.findings[0], { ...LEVEL_5.findings[0], ordinal: 2, requirement: "UL U465" }],
        },
      ],
    });
    expect(new Set(facts.map((f) => f.ref)).size).toBe(2);
  });
});

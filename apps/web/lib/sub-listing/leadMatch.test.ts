import { describe, expect, it } from "vitest";
import { leadCandidatesFor, normaliseCompanyName } from "./leadMatch";

/**
 * The asymmetry this suite is built around: a MISSED match costs a duplicate
 * lead, which somebody merges in a minute. A WRONG match attaches a researched
 * signal about one company to a different company's record, and then somebody
 * rings a stranger and reads it to them. So every ambiguous case must come back
 * as a candidate for a person to settle, never as an answer.
 */

const leads = [
  { id: "1", companyName: "Valley Interior Systems, Inc." },
  { id: "2", companyName: "Western Fireproofing Co." },
  { id: "3", companyName: "Western Electric" },
  { id: "4", companyName: "Summit Acoustics LLC" },
  { id: "5", companyName: "Baker Drywall" },
  { id: "6", companyName: "Baker Plastering" },
];

describe("reducing a company name to the part that carries identity", () => {
  it.each([
    ["Valley Interior Systems, Inc.", "valley interior systems"],
    ["Summit Acoustics LLC", "summit acoustics"],
    ["Western Fireproofing Co.", "western fireproofing"],
    ["Pacific Lath & Plaster Inc.", "pacific lath plaster"],
    ["Acme Drywall Co. Inc.", "acme drywall"],
    ["NORTHSTATE DRYWALL", "northstate drywall"],
    ["Diablo Ceiling & Partition", "diablo ceiling partition"],
  ])("reads %s as %s", (raw, expected) => {
    expect(normaliseCompanyName(raw)).toBe(expected);
  });

  /**
   * Stripping trade words was considered and refused. "Baker Drywall" and
   * "Baker Plastering" are two companies, and a normaliser that collapsed them
   * would merge two real prospects into one silently.
   */
  it("keeps trade words, because they distinguish real companies", () => {
    expect(normaliseCompanyName("Baker Drywall")).not.toBe(normaliseCompanyName("Baker Plastering"));
  });
});

describe("finding the lead a listed subcontractor might already be", () => {
  it("calls an entity-suffix difference the same company", () => {
    const found = leadCandidatesFor("Valley Interior Systems", leads);
    expect(found).toHaveLength(1);
    expect(found[0].lead.id).toBe("1");
    expect(found[0].confidence).toBe("SAME");
  });

  it("offers a word-subset match as POSSIBLE and never as settled", () => {
    const found = leadCandidatesFor("Summit Acoustics of Riverside", leads);
    expect(found).toHaveLength(1);
    expect(found[0].lead.id).toBe("4");
    expect(found[0].confidence).toBe("POSSIBLE");
  });

  it("puts a certain match above a possible one", () => {
    const withBoth = [...leads, { id: "7", companyName: "Valley Interior" }];
    const found = leadCandidatesFor("Valley Interior Systems", withBoth);
    expect(found.map((candidate) => candidate.confidence)).toEqual(["SAME", "POSSIBLE"]);
    expect(found[0].lead.id).toBe("1");
  });

  /**
   * The failure mode that matters. "Western Fireproofing" and "Western Electric"
   * share every word that is not the trade, and a one-word resemblance is not a
   * resemblance at all.
   */
  it("does not match two companies that share only one word", () => {
    const found = leadCandidatesFor("Western Plastering", leads);
    expect(found).toEqual([]);
  });

  /**
   * FOUND BY MUTATION, NOT BY READING. Relaxing the two-word floor to one left
   * the suite entirely green, because every case above happens to compare two
   * two-word names where the subset check fails on its own. The floor only bites
   * when the shorter name is a SINGLE word — and then it is the difference
   * between "no match" and silently attaching a researched signal to whichever
   * "Western" was entered first.
   */
  it("does not treat a single-word name as a subset of every longer one", () => {
    expect(leadCandidatesFor("Western", leads)).toEqual([]);
    expect(leadCandidatesFor("Baker", leads)).toEqual([]);
    expect(leadCandidatesFor("Summit", leads)).toEqual([]);
  });

  it("does not confuse two trades under one family name", () => {
    const found = leadCandidatesFor("Baker Drywall", leads);
    expect(found).toHaveLength(1);
    expect(found[0].lead.id).toBe("5");
    expect(found[0].confidence).toBe("SAME");
  });

  it("returns nothing for a company nobody has entered, which is the common case", () => {
    expect(leadCandidatesFor("Oakwood Interior Contractors", leads)).toEqual([]);
  });

  it("returns nothing rather than throwing on empty input", () => {
    expect(leadCandidatesFor("", leads)).toEqual([]);
    expect(leadCandidatesFor("Inc.", leads)).toEqual([]);
    expect(leadCandidatesFor("Valley Interior Systems", [])).toEqual([]);
  });

  it("ignores a lead whose name normalises to nothing", () => {
    expect(leadCandidatesFor("Valley Interior Systems", [{ companyName: "LLC" }])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { bidQuoteProblem, exclusionLines, levelBid, levelPackage, type LevelQuote } from "./bid-levelling";

const quote = (over: Partial<LevelQuote> & Pick<LevelQuote, "id" | "vendorName" | "amount">): LevelQuote => ({
  packageLabel: "Metal stud framing",
  quotedOn: "2026-09-20",
  exclusions: null,
  ...over,
});

describe("the cheapest quote is never presented on its own", () => {
  it("names the low quote AND says the quotes are comparable when they are", () => {
    const levelled = levelPackage("Metal stud framing", [
      quote({ id: "a", vendorName: "Acme", amount: 82_000 }),
      quote({ id: "b", vendorName: "Beta", amount: 91_000 }),
    ]);
    expect(levelled.cheapest?.vendorName).toBe("Acme");
    expect(levelled.spread).toBe(9_000);
    expect(levelled.comparable).toBe(true);
    expect(levelled.caution).toBeNull();
  });

  it("REFUSES to leave the low number unqualified when the exclusions differ", () => {
    // THE DEFECT THIS EXISTS FOR: Acme is $9,000 cheaper because it left the
    // soffits out. "Acme, $82,000, lowest" in bold would help a contractor
    // buy a hole in their own scope.
    const levelled = levelPackage("Metal stud framing", [
      quote({ id: "a", vendorName: "Acme", amount: 82_000, exclusions: "Soffits\nFirestopping" }),
      quote({ id: "b", vendorName: "Beta", amount: 91_000 }),
    ]);
    expect(levelled.comparable).toBe(false);
    expect(levelled.caution).toContain("Acme is lowest but excludes");
    expect(levelled.caution).toContain("Soffits and Firestopping");
    expect(levelled.caution).toContain("Beta");
    expect(levelled.caution).toContain("not the same bid");
  });

  it("names WHAT is excluded, not how many things are", () => {
    // "excludes 2 things" sends somebody to read three PDFs. Naming them
    // tells them what to price.
    const levelled = levelPackage("EIFS", [
      quote({ id: "a", vendorName: "Acme", amount: 40_000, exclusions: "Scaffold", packageLabel: "EIFS" }),
      quote({ id: "b", vendorName: "Beta", amount: 44_000, packageLabel: "EIFS" }),
    ]);
    expect(levelled.caution).toContain("Scaffold");
    expect(levelled.caution).not.toMatch(/\b1 thing|\b2 things/);
  });

  it("still cautions when it is a DEARER quote carrying the exclusion", () => {
    // The dear one may be dear for a reason that does not apply. Silence here
    // would let the estimator assume the spread is all price.
    const levelled = levelPackage("Drywall", [
      quote({ id: "a", vendorName: "Acme", amount: 60_000, packageLabel: "Drywall" }),
      quote({ id: "b", vendorName: "Beta", amount: 70_000, exclusions: "Level 5", packageLabel: "Drywall" }),
    ]);
    expect(levelled.comparable).toBe(false);
    expect(levelled.caution).toContain("Beta");
    expect(levelled.caution).toContain("leaves out work Acme covers");
  });

  it("treats identical exclusions on every quote as comparable", () => {
    const levelled = levelPackage("Drywall", [
      quote({ id: "a", vendorName: "Acme", amount: 60_000, exclusions: "Scaffold", packageLabel: "Drywall" }),
      quote({ id: "b", vendorName: "Beta", amount: 66_000, exclusions: "scaffold", packageLabel: "Drywall" }),
    ]);
    // Case-insensitive, because the same exclusion typed two ways is the same
    // exclusion. Anything beyond that is guessing.
    expect(levelled.comparable).toBe(true);
    expect(levelled.caution).toBeNull();
  });

  it("does NOT try to understand differently-worded exclusions", () => {
    // "no soffits" and "soffits excluded" mean the same thing to a person and
    // must NOT be matched here: a false match suppresses the caution that
    // matters. Reading as different is the safe direction to be wrong in.
    const levelled = levelPackage("Framing", [
      quote({ id: "a", vendorName: "Acme", amount: 50_000, exclusions: "no soffits", packageLabel: "Framing" }),
      quote({ id: "b", vendorName: "Beta", amount: 52_000, exclusions: "soffits excluded", packageLabel: "Framing" }),
    ]);
    expect(levelled.comparable).toBe(false);
  });
});

describe("a single quote is not a comparison", () => {
  it("reports comparable as null, not true", () => {
    const levelled = levelPackage("Framing", [quote({ id: "a", vendorName: "Acme", amount: 50_000 })]);
    // `true` would be saying something untrue: it is comparable to nothing.
    expect(levelled.comparable).toBeNull();
    expect(levelled.spread).toBeNull();
    expect(levelled.caution).toMatch(/Only one quote/);
  });

  it("is empty-safe", () => {
    const levelled = levelPackage("Framing", []);
    expect(levelled.cheapest).toBeNull();
    expect(levelled.spread).toBeNull();
    expect(levelled.comparable).toBeNull();
    expect(levelled.caution).toBeNull();
  });
});

describe("packages are compared only against themselves", () => {
  it("groups by label and never mixes two scopes into one comparison", () => {
    const packages = levelBid([
      quote({ id: "a", vendorName: "Acme", amount: 82_000, packageLabel: "Framing" }),
      quote({ id: "b", vendorName: "Beta", amount: 40_000, packageLabel: "EIFS" }),
      quote({ id: "c", vendorName: "Gamma", amount: 44_000, packageLabel: "EIFS" }),
    ]);
    expect(packages.map((p) => p.packageLabel)).toEqual(["EIFS", "Framing"]);
    // The $40,000 EIFS quote must NOT be the "cheapest" against framing.
    expect(packages[1].quotes).toHaveLength(1);
    expect(packages[0].cheapest?.vendorName).toBe("Beta");
  });

  it("shows a typo as two headings rather than merging two scopes", () => {
    const packages = levelBid([
      quote({ id: "a", vendorName: "Acme", amount: 10_000, packageLabel: "Framing" }),
      quote({ id: "b", vendorName: "Beta", amount: 90_000, packageLabel: "Framng" }),
    ]);
    expect(packages).toHaveLength(2);
    // The visible failure, not the quiet one: nobody is told Acme is 89,000
    // cheaper than Beta for the same work.
    expect(packages.every((p) => p.comparable === null)).toBe(true);
  });
});

describe("reading exclusions off the page", () => {
  it("splits lines and drops the blanks", () => {
    expect(exclusionLines("Soffits\n\n  Firestopping  \n")).toEqual(["Soffits", "Firestopping"]);
  });

  it("treats nothing recorded as nothing excluded", () => {
    expect(exclusionLines(null)).toEqual([]);
    expect(exclusionLines("   ")).toEqual([]);
  });
});

describe("what a quote has to be before it is saved", () => {
  const good = { packageLabel: "Framing", vendorName: "Acme", amount: 50_000 };

  it("accepts a complete one", () => {
    expect(bidQuoteProblem(good)).toBeNull();
  });

  it("needs a package, a name and an amount", () => {
    expect(bidQuoteProblem({ ...good, packageLabel: " " })).toMatch(/what this quote is for/);
    expect(bidQuoteProblem({ ...good, vendorName: "" })).toMatch(/nobody behind it/);
    expect(bidQuoteProblem({ ...good, amount: null })).toMatch(/needs an amount/);
    expect(bidQuoteProblem({ ...good, amount: 0 })).toMatch(/not a quote/);
  });
});

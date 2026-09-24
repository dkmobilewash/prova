import { describe, expect, it } from "vitest";

import {
  bidQuoteProblem,
  exclusionLines,
  levelBid,
  levelPackage,
  outstandingNote,
  requestState,
  type LevelQuote,
} from "./bid-levelling";

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

  it("needs a package and somebody behind it", () => {
    expect(bidQuoteProblem({ ...good, packageLabel: " " })).toMatch(/what this quote is for/);
    expect(bidQuoteProblem({ ...good, vendorName: "" })).toMatch(/nobody behind it/);
    expect(bidQuoteProblem({ ...good, amount: 0 })).toMatch(/not a quote/);
  });

  it("no longer needs an amount, and that is the RFQ change", () => {
    // This assertion was `toMatch(/needs an amount/)` until a row could be a
    // request as well as a quote. Kept as its inverse rather than deleted, so
    // the change of rule is visible here rather than being a line that
    // quietly stopped existing.
    expect(bidQuoteProblem({ ...good, amount: null })).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE OUTBOUND HALF: a row that is a request, not yet a quote.
// ───────────────────────────────────────────────────────────────────────────

const request = (
  over: Partial<LevelQuote> & Pick<LevelQuote, "id" | "vendorName">,
): LevelQuote => ({
  packageLabel: "Metal stud framing",
  amount: null,
  quotedOn: null,
  exclusions: null,
  requestedOn: "2026-09-18",
  ...over,
});

describe("an unanswered request can never become the winning quote", () => {
  it("KEEPS A NULL AMOUNT OUT OF THE COMPARISON ENTIRELY", () => {
    // THE DEFECT THIS EXISTS FOR. `levelPackage` sorts ascending and calls the
    // first row cheapest. A null sorts to the front of that sort, so a
    // supplier who has not answered would be presented as the low bid — the
    // loudest possible version of this feature's own failure mode.
    const levelled = levelPackage("Metal stud framing", [
      request({ id: "r", vendorName: "Gamma", dueBy: "2026-09-25" }),
      quote({ id: "a", vendorName: "Acme", amount: 82_000 }),
      quote({ id: "b", vendorName: "Beta", amount: 91_000 }),
    ]);
    expect(levelled.cheapest?.vendorName).toBe("Acme");
    expect(levelled.quotes.map((q) => q.id)).toEqual(["a", "b"]);
    expect(levelled.spread).toBe(9_000);
  });

  it("reports the outstanding request rather than dropping it", () => {
    // Not in the comparison is not the same as not on screen. "Who have I not
    // heard from" is the question bid day turns on.
    const levelled = levelPackage("Metal stud framing", [
      request({ id: "r", vendorName: "Gamma" }),
      quote({ id: "a", vendorName: "Acme", amount: 82_000 }),
    ]);
    expect(levelled.outstanding.map((q) => q.vendorName)).toEqual(["Gamma"]);
    expect(levelled.declined).toEqual([]);
  });

  it("a declined request is neither outstanding nor a quote", () => {
    const levelled = levelPackage("Metal stud framing", [
      request({ id: "r", vendorName: "Gamma", declinedAt: "2026-09-22" }),
      quote({ id: "a", vendorName: "Acme", amount: 82_000 }),
    ]);
    expect(levelled.declined.map((q) => q.vendorName)).toEqual(["Gamma"]);
    expect(levelled.outstanding).toEqual([]);
    expect(levelled.quotes.map((q) => q.id)).toEqual(["a"]);
  });

  it("says so when a package has requests out and no prices back", () => {
    const levelled = levelPackage("EIFS", [
      request({ id: "r1", vendorName: "Gamma", packageLabel: "EIFS" }),
      request({ id: "r2", vendorName: "Delta", packageLabel: "EIFS" }),
    ]);
    expect(levelled.cheapest).toBeNull();
    expect(levelled.caution).toContain("No prices back yet");
    expect(levelled.caution).toContain("2");
  });

  it("does not let two comparable quotes read as a settled buyout", () => {
    // `comparable` is about the exclusions and stays true here — the
    // outstanding note is the thing that stops it reading as "that's the lot".
    const levelled = levelPackage("Metal stud framing", [
      quote({ id: "a", vendorName: "Acme", amount: 82_000 }),
      quote({ id: "b", vendorName: "Beta", amount: 91_000 }),
      request({ id: "r", vendorName: "Gamma" }),
    ]);
    expect(levelled.comparable).toBe(true);
    expect(outstandingNote(levelled, "2026-09-24")).toContain("Still waiting on Gamma");
    expect(outstandingNote(levelled, "2026-09-24")).toContain("incomplete");
  });

  it("has nothing to say when every request is in", () => {
    const levelled = levelPackage("Metal stud framing", [
      quote({ id: "a", vendorName: "Acme", amount: 82_000 }),
      quote({ id: "b", vendorName: "Beta", amount: 91_000 }),
    ]);
    expect(outstandingNote(levelled, "2026-09-24")).toBeNull();
  });
});

describe("requestState", () => {
  it("is OVERDUE only once the date you asked for has passed", () => {
    const pending = request({ id: "r", vendorName: "Gamma", dueBy: "2026-09-25" });
    expect(requestState(pending, "2026-09-24")).toBe("AWAITED");
    expect(requestState(pending, "2026-09-25")).toBe("AWAITED");
    expect(requestState(pending, "2026-09-26")).toBe("OVERDUE");
  });

  it("is never OVERDUE without a date you asked for", () => {
    // A request with no due date is outstanding forever and that is honest:
    // nothing was promised, so nothing is late.
    expect(requestState(request({ id: "r", vendorName: "Gamma" }), "2030-01-01")).toBe("AWAITED");
  });

  it("an answer and a decline both close the request", () => {
    expect(requestState(quote({ id: "a", vendorName: "Acme", amount: 1 }), "2026-09-24")).toBe("ANSWERED");
    expect(
      requestState(
        request({ id: "r", vendorName: "Gamma", declinedAt: "2026-09-22", dueBy: "2026-01-01" }),
        "2026-09-24",
      ),
    ).toBe("DECLINED");
  });

  it("a declined row that somehow carries an amount is still DECLINED", () => {
    // Belt and braces on the one ordering that matters: declining wins, so a
    // stale amount cannot resurrect a supplier into the comparison.
    const odd = { ...quote({ id: "x", vendorName: "Gamma", amount: 5 }), declinedAt: "2026-09-22" };
    expect(requestState(odd, "2026-09-24")).toBe("DECLINED");
    expect(levelPackage("Metal stud framing", [odd]).quotes).toEqual([]);
  });

  it("names the overdue ones in the outstanding note", () => {
    const levelled = levelPackage("Metal stud framing", [
      quote({ id: "a", vendorName: "Acme", amount: 82_000 }),
      request({ id: "r", vendorName: "Gamma", dueBy: "2026-09-20" }),
    ]);
    expect(outstandingNote(levelled, "2026-09-24")).toContain("past the date you asked for");
  });
});

describe("bidQuoteProblem accepts a request with no price on it", () => {
  it("allows a null amount — that is a request, not a broken quote", () => {
    expect(bidQuoteProblem({ packageLabel: "EIFS", vendorName: "Gamma", amount: null })).toBeNull();
  });

  it("still refuses a nonsense one", () => {
    expect(bidQuoteProblem({ packageLabel: "EIFS", vendorName: "Gamma", amount: 0 })).toContain("not a quote");
    expect(bidQuoteProblem({ packageLabel: "EIFS", vendorName: "Gamma", amount: -5 })).toContain("not a quote");
  });

  it("still needs a package and somebody to ask", () => {
    expect(bidQuoteProblem({ packageLabel: "", vendorName: "Gamma", amount: null })).toContain(
      "what this quote is for",
    );
    expect(bidQuoteProblem({ packageLabel: "EIFS", vendorName: "", amount: null })).toContain("whoever gave it");
  });
});

import { describe, expect, it } from "vitest";
import { parseSubListing } from "./parse";
import { signalsForSub, importSummaryFor } from "./signals";
import { SUB_LISTING_CASES } from "./subListingCases";

/**
 * THE ASSERTIONS HERE ARE ABOUT WHAT A CLAIM MAY NOT SAY.
 *
 * A signal's claim is read aloud on a telephone to the man whose company it is
 * about. The GTM study's rule — *a specific email that is wrong is
 * disqualifying* — makes an over-claim worse than a thin one, so most of this
 * file is negative: no amount where the form has none, no job where the
 * document proves only a bid, no size ever.
 */

const california = parseSubListing(
  SUB_LISTING_CASES.find((subject) => subject.id === "clean-five")!.text,
);
const oregon = parseSubListing(
  SUB_LISTING_CASES.find((subject) => subject.id === "oregon-with-amounts")!.text,
);

const valley = california.rows[0];
const cascade = oregon.rows[0];

describe("what one listing row is evidence of", () => {
  it("fills the baseline and the opener from a single row, which is the whole point", () => {
    const kinds = signalsForSub(valley, california.header).map((signal) => signal.kind);
    // TRADE + GEOGRAPHY are the band's baseline; PROJECT and GC_RELATIONSHIP are
    // its two openers. One pasted document carries all four.
    expect(kinds).toContain("TRADE");
    expect(kinds).toContain("GEOGRAPHY");
    expect(kinds).toContain("PROJECT");
    expect(kinds).toContain("LICENCE");
    expect(kinds.length).toBeGreaterThanOrEqual(4);
  });

  it("returns them in the canonical kind order, not in the order they were written", () => {
    const kinds = signalsForSub(valley, california.header).map((signal) => signal.kind);
    const sorted = [...kinds].sort(
      (a, b) =>
        ["TRADE", "SIZE", "GEOGRAPHY", "LICENCE", "UNION", "TECH"].indexOf(a) -
        ["TRADE", "SIZE", "GEOGRAPHY", "LICENCE", "UNION", "TECH"].indexOf(b),
    );
    expect(kinds.indexOf("TRADE")).toBeLessThan(kinds.indexOf("GEOGRAPHY"));
    expect(sorted.length).toBe(kinds.length);
  });

  it("carries the line number on every signal, so every claim is checkable", () => {
    for (const signal of signalsForSub(valley, california.header)) {
      expect(signal.line).toBe(valley.line);
      expect(signal.claim).toContain(`line ${valley.line}`);
    }
  });

  it("quotes the portion of work verbatim rather than describing it", () => {
    const trade = signalsForSub(valley, california.header).find((s) => s.kind === "TRADE")!;
    expect(trade.claim).toContain('"Metal stud framing & drywall"');
    expect(trade.claim).toContain("Metal framing / drywall");
  });

  it("proposes nothing for a row with no checkable fact", () => {
    const bare = { ...valley, portionOfWork: null, tradeScope: null, city: null, licence: null, registration: null };
    const kinds = signalsForSub(bare, { project: null, agency: null, prime: null, bidDate: null });
    expect(kinds).toEqual([]);
    expect(importSummaryFor(bare, { project: null, agency: null, prime: null, bidDate: null })).toMatch(
      /Nothing here to propose/,
    );
  });
});

describe("the things a claim may never say", () => {
  /**
   * THE BUG THIS BLOCK EXISTS FOR.
   *
   * California's §4104 listing is filed WITH THE BID by EVERY prime. One project
   * with five primes names five drywall subs, of whom four are not getting the
   * work. The first version of the PROJECT claim read "On Lincoln Elementary,
   * under Swinerton" and would have congratulated four subs in five on a job
   * they lost.
   */
  it("does not say a sub is ON a job when the document only proves they were on a BID", () => {
    const project = signalsForSub(valley, california.header).find((s) => s.kind === "PROJECT")!;
    expect(project.claim).toMatch(/Named on Swinerton Builders's bid/);
    expect(project.claim).toMatch(/does not say whether that bid won/);
    // The dangerous phrasing must be absent entirely.
    expect(project.claim).not.toMatch(/^On Lincoln/);
  });

  it("says 'works under' only once an award is declared", () => {
    const unknown = signalsForSub(valley, california.header).find((s) => s.kind === "GC_RELATIONSHIP")!;
    expect(unknown.claim).toMatch(/listed them as their subcontractor when bidding/);
    expect(unknown.claim).not.toMatch(/Works under/);

    const awarded = signalsForSub(valley, california.header, "AWARDED").find(
      (s) => s.kind === "GC_RELATIONSHIP",
    )!;
    expect(awarded.claim).toMatch(/^Works under Swinerton Builders/);
  });

  it("states the job plainly once the award IS known", () => {
    const project = signalsForSub(valley, california.header, "AWARDED").find(
      (s) => s.kind === "PROJECT",
    )!;
    expect(project.claim).toMatch(/^On Lincoln Elementary Modernization/);
    expect(project.claim).toMatch(/under Swinerton Builders/);
    expect(project.claim).not.toMatch(/does not say whether/);
  });

  /**
   * §4104 carries no dollar field. A rendered amount would be invented, and
   * money is the one subject these buyers would be hiring us for — being wrong
   * about it is disqualifying in a way being vague is not.
   */
  it("renders no amount for a California listing, because there is none to render", () => {
    for (const signal of signalsForSub(valley, california.header)) {
      expect(signal.claim, signal.kind).not.toMatch(/\$/);
      expect(signal.claim, signal.kind).not.toMatch(/% of the bid/);
    }
  });

  it("renders Oregon's amount, because that form really carries it", () => {
    const project = signalsForSub(cascade, oregon.header).find((s) => s.kind === "PROJECT")!;
    expect(project.claim).toContain("$2,140,000");
  });

  /**
   * The tempting over-claim. A dollar value on one scope of one job says nothing
   * about headcount, and a lead banded on an invented size is the "confident
   * fact wearing a citation" failure.
   */
  it("never proposes SIZE, not even from an Oregon row that carries a dollar value", () => {
    expect(signalsForSub(cascade, oregon.header).map((s) => s.kind)).not.toContain("SIZE");
    expect(signalsForSub(valley, california.header).map((s) => s.kind)).not.toContain("SIZE");
    expect(signalsForSub(cascade, oregon.header, "AWARDED").map((s) => s.kind)).not.toContain("SIZE");
  });

  it("never proposes UNION or TECH, which a listing cannot speak to", () => {
    const kinds = [
      ...signalsForSub(valley, california.header).map((s) => s.kind),
      ...signalsForSub(cascade, oregon.header, "AWARDED").map((s) => s.kind),
    ];
    expect(kinds).not.toContain("UNION");
    expect(kinds).not.toContain("TECH");
  });

  it("invents no project when the document has no header", () => {
    const bare = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "no-header")!.text);
    const kinds = signalsForSub(bare.rows[0], bare.header).map((s) => s.kind);
    expect(kinds).not.toContain("PROJECT");
    expect(kinds).not.toContain("GC_RELATIONSHIP");
    // But the row still yields what it does prove.
    expect(kinds).toContain("TRADE");
    expect(kinds).toContain("GEOGRAPHY");
  });
});

describe("the summary a reviewer reads", () => {
  it("counts signals rather than promising a band", () => {
    const summary = importSummaryFor(valley, california.header);
    expect(summary).toMatch(/signals to check/);
    // Every signal lands PROPOSED, so nothing here may imply the band has moved.
    expect(summary).not.toMatch(/Call this one|Worth a call|strong/i);
  });

  it("uses the singular for one", () => {
    const onlyTrade = { ...valley, city: null, licence: null, registration: null };
    expect(importSummaryFor(onlyTrade, { project: null, agency: null, prime: null, bidDate: null })).toBe(
      "1 signal to check",
    );
  });
});

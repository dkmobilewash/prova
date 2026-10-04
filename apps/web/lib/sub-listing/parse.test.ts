import { describe, expect, it } from "vitest";
import { parseSubListing, tradeScopeFor } from "./parse";
import { LOAD_BEARING_CASES, SUB_LISTING_CASES } from "./subListingCases";

/**
 * WHAT THIS SUITE CAN AND CANNOT TELL YOU.
 *
 * It can tell you the parser loses nothing silently, which is the one property
 * the feature's value rests on. It CANNOT tell you the parser reads a real
 * agency's form, because no real form was available to write it against — the
 * egress proxy answered 403 for every host. `subListingCases.ts` says so in its
 * own header and that limitation is the honest headline of this whole slice.
 *
 * So the assertions are deliberately about STRUCTURE (nothing vanishes; a
 * candidate is a row or a reported leftover) and about the handful of readings
 * that must not regress, rather than about a format this cannot verify.
 */

describe("the honest-parse guarantee", () => {
  /**
   * The whole design in one assertion.
   *
   * `candidateLines` is counted by `looksLikeData`, which asks only whether a
   * line carries a money, percent, licence or registration token. `rows` come
   * from `readRow`, which shares none of that code. If the two can disagree
   * without the difference being reported, a subcontractor can go missing and
   * nobody will ever know, because nobody misses a sub who was never mentioned.
   */
  it.each(SUB_LISTING_CASES)(
    "accounts for every candidate line in $id — $why",
    ({ text }) => {
      const parsed = parseSubListing(text);
      expect(parsed.reconciliation.rowsParsed + parsed.unread.length).toBe(
        parsed.reconciliation.candidateLines,
      );
      expect(parsed.reconciliation.rowsParsed).toBe(parsed.rows.length);
      expect(parsed.reconciliation.agreed).toBe(parsed.unread.length === 0);
    },
  );

  it("reports a line it cannot read rather than dropping it", () => {
    // Two money tokens and no field that reads as a name: a candidate by the
    // counter's reckoning, unreadable by the parser's. It must be reported.
    const parsed = parseSubListing("$100,000    $250,000\n");
    expect(parsed.reconciliation.candidateLines).toBe(1);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.unread).toHaveLength(1);
    expect(parsed.unread[0].line).toBe(1);
    expect(parsed.unread[0].why).toMatch(/name/);
    expect(parsed.reconciliation.agreed).toBe(false);
  });

  it("says nothing at all about an empty document", () => {
    const parsed = parseSubListing("");
    expect(parsed.rows).toEqual([]);
    expect(parsed.unread).toEqual([]);
    expect(parsed.reconciliation).toEqual({
      candidateLines: 0,
      rowsParsed: 0,
      agreed: true,
    });
  });
});

describe("the counter-metric", () => {
  /**
   * A parser that returned NOTHING, always, would satisfy every assertion in
   * the block above: nothing is ever missing from an empty list and nothing is
   * ever out of order in one. `lib/research/bidResearch.eval.ts` shipped that
   * hole deliberately guarded and this file copies the guard — the vacuity has
   * to be a named failure from the first run, not a thing discovered later.
   */
  it.each(SUB_LISTING_CASES)("reads the expected number of rows from $id", ({ text, expectRows, expectUnread }) => {
    const parsed = parseSubListing(text);
    expect(parsed.rows).toHaveLength(expectRows);
    expect(parsed.unread).toHaveLength(expectUnread);
  });

  it("keeps the cases that are load-bearing, named rather than counted", () => {
    const ids = SUB_LISTING_CASES.map((subject) => subject.id);
    for (const required of LOAD_BEARING_CASES) {
      expect(ids, `${required} may not be deleted — read its "why"`).toContain(required);
    }
  });
});

describe("reading a California listing", () => {
  const parsed = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "clean-five")!.text);

  it("reads the project, agency, prime and bid date out of the header", () => {
    expect(parsed.header).toEqual({
      project: "Lincoln Elementary Modernization, Increment 2",
      agency: "Riverside Unified School District",
      prime: "Swinerton Builders",
      bidDate: "March 14, 2026",
    });
  });

  it("reads every field of a row, and the scope rather than the city", () => {
    const valley = parsed.rows[0];
    expect(valley.name).toBe("Valley Interior Systems");
    expect(valley.city).toBe("Fontana, CA");
    expect(valley.licence).toBe("C-9 884201");
    expect(valley.registration).toBe("1000012345");
    expect(valley.portionOfWork).toBe("Metal stud framing & drywall");
    expect(valley.tradeScope).toBe("METAL_FRAMING_DRYWALL");
    // 11, not 10: the fixture opens with a newline and the column header is 10.
    // The number is pinned because the claim text quotes it back to a reviewer,
    // so an off-by-one here is an off-by-one in what a person is told to go and
    // look at.
    expect(valley.line).toBe(11);
    expect(valley.concerns).toEqual([]);
  });

  it("carries the verbatim line, because that is what a claim quotes", () => {
    expect(parsed.rows[0].sourceText).toContain("Valley Interior Systems");
    expect(parsed.rows[0].sourceText).toContain("Metal stud framing & drywall");
  });

  /**
   * §4104 has no dollar field. A number here would be invented, and an invented
   * number is the one specificity that disqualifies — money is the thing these
   * buyers would be hiring us for.
   */
  it("finds no amount, because the California form has no amount to find", () => {
    for (const row of parsed.rows) {
      expect(row.amount, `${row.name} should carry no amount`).toBeNull();
      expect(row.percentOfBid).toBeNull();
    }
  });

  it("does not mistake the total bid for a subcontractor", () => {
    expect(parsed.rows.map((row) => row.name)).not.toContain(expect.stringContaining("Total"));
    for (const row of parsed.rows) expect(row.name).not.toMatch(/total/i);
  });

  it("keeps the sub whose trade is not one of ours, unclassified", () => {
    const delta = parsed.rows.find((row) => row.name.startsWith("Delta Electric"))!;
    expect(delta.portionOfWork).toBe("Electrical");
    expect(delta.tradeScope).toBeNull();
  });
});

describe("the shapes that lose a row quietly", () => {
  it("flags a scope that wrapped, and attributes the orphan line to its row", () => {
    const parsed = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "wrapped-row")!.text);
    const sierra = parsed.rows.find((row) => row.name === "Sierra Wall Systems")!;

    // Both halves: the row itself looks cut off, AND the line beneath it is
    // named as possibly belonging to it.
    expect(sierra.concerns.join(" ")).toMatch(/cut off/);
    expect(sierra.concerns.join(" ")).toMatch(/interior finish carpentry/);

    // The row after the wrap is still read — a wrap must not eat its neighbour.
    expect(parsed.rows.map((row) => row.name)).toContain("Kings Acoustical");
  });

  it("costs the licence FIELD and never the row when the format is unknown", () => {
    const parsed = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "odd-licence")!.text);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Northstate Drywall");
    expect(parsed.rows[0].licence).toBeNull();
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
  });

  it("reads a bare table and invents no project for it", () => {
    const parsed = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "no-header")!.text);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.header).toEqual({ project: null, agency: null, prime: null, bidDate: null });
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(parsed.rows[1].tradeScope).toBe("LATH_PLASTER");
  });

  it("separates on tabs and on pipes, not only on space runs", () => {
    const tabs = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "tab-delimited")!.text);
    expect(tabs.rows.map((row) => row.name)).toEqual([
      "Bayline Drywall Systems",
      "Monterey Plastering",
    ]);
    expect(tabs.rows[0].amount).toBe(744300);

    const pipes = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "pipe-delimited")!.text);
    expect(pipes.rows.map((row) => row.name)).toEqual([
      "Diablo Ceiling & Partition",
      "Brightwall EIFS",
    ]);
    expect(pipes.rows[1].tradeScope).toBe("EIFS");
  });

  it("reads a percentage when that is what the form carries", () => {
    const parsed = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "percent-not-dollars")!.text);
    expect(parsed.rows[0].percentOfBid).toBe(8.4);
    expect(parsed.rows[0].amount).toBeNull();
    expect(parsed.rows[1].percentOfBid).toBe(2.15);
  });

  it("reads Oregon's dollar value, which is the only one that is real", () => {
    const parsed = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "oregon-with-amounts")!.text);
    expect(parsed.rows[0].name).toBe("Cascade Interior Systems");
    expect(parsed.rows[0].amount).toBe(2140000);
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(parsed.rows[1].amount).toBe(385500);
  });

  it("does not turn page furniture into a subcontractor", () => {
    const parsed = parseSubListing(SUB_LISTING_CASES.find((c) => c.id === "noise-only")!.text);
    expect(parsed.rows).toEqual([]);
    expect(parsed.unread).toEqual([]);
  });
});

describe("matching a portion of work to one of our five trades", () => {
  it.each([
    ["Metal stud framing & drywall", "METAL_FRAMING_DRYWALL"],
    ["Gypsum board assemblies", "METAL_FRAMING_DRYWALL"],
    ["Light-gauge framing", "METAL_FRAMING_DRYWALL"],
    ["Lath and cement plaster", "LATH_PLASTER"],
    ["Exterior cement plaster", "LATH_PLASTER"],
    ["EIFS and synthetic stucco", "EIFS"],
    ["Acoustical ceilings", "ACOUSTICAL_CEILINGS"],
    ["Suspended ceiling grid", "ACOUSTICAL_CEILINGS"],
    ["Spray-applied fireproofing", "FIREPROOFING"],
    ["Intumescent coatings", "FIREPROOFING"],
    ["Firestopping", "FIREPROOFING"],
  ])("reads %s as %s", (portion, expected) => {
    expect(tradeScopeFor(portion)).toBe(expected);
  });

  it.each([
    ["Electrical"],
    ["Plumbing"],
    ["Structural steel"],
    ["Earthwork and grading"],
    ["Site concrete"],
  ])("leaves %s unclassified rather than forcing it into one of ours", (portion) => {
    expect(tradeScopeFor(portion)).toBeNull();
  });

  it("says nothing when there is nothing to read", () => {
    expect(tradeScopeFor(null)).toBeNull();
    expect(tradeScopeFor("")).toBeNull();
  });

  /**
   * The longest keyword wins so that "spray applied fireproofing" is not caught
   * by a shorter word belonging to another trade. Pinned because the rule is
   * arbitrary enough that somebody will reasonably want to change it, and this
   * is the row that tells them what they are changing.
   */
  it("resolves an overlapping description by the longest keyword, not declaration order", () => {
    expect(tradeScopeFor("Spray-applied fireproofing and insulation")).toBe("FIREPROOFING");
    expect(tradeScopeFor("Acoustical ceilings and drywall")).toBe("ACOUSTICAL_CEILINGS");
  });
});

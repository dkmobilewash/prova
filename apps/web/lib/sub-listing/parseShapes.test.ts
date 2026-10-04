import { describe, expect, it } from "vitest";
import { parseSubListing } from "./parse";
import { SUB_LISTING_CASES } from "./subListingCases";

/**
 * SHAPES THE REVIEW SUSPECTED WERE UNHANDLED, AND WHAT THE PARSER DOES WITH THEM
 * TODAY.
 *
 * ── EVERY ASSERTION HERE RECORDS CURRENT BEHAVIOUR, NOT DESIRED BEHAVIOUR ──
 *
 * Three of these shapes are mishandled. Their tests PASS, and each one says so in
 * its own name, beginning with the word TODAY. That is deliberate and it is the
 * only honest option available: a failing test is not a deliverable, and a fixture
 * that quietly expects the right answer while the parser gives the wrong one would
 * have to be deleted or weakened by the next person before they could get a green
 * run — which is how a defect acquires a test that defends it.
 *
 * So the convention is: **TODAY in the test name means this assertion is a
 * reproduction, and fixing the parser is supposed to turn it red.** When that
 * happens, change the assertion and delete the word. A test here that has lost its
 * TODAY is a defect that was fixed; a test that never had one is a pin on
 * behaviour that was correct when it was written.
 *
 * ── WHY A SEPARATE FILE ──
 *
 * `parse.test.ts` was being edited and snapshot-restored by another session while
 * this was written, so appending to it would have raced. Nothing here duplicates
 * it: the whole-corpus partition and the "every ignored line has a reason" tests
 * live there and already cover the fixtures added for this file, because they are
 * `it.each(SUB_LISTING_CASES)`.
 *
 * ── WHAT IS NOT CHECKED ──
 *
 * No real document, same as the rest of this directory — the egress proxy answers
 * 403 on CONNECT for every general web host, so every shape below is a GUESS at
 * how a real agency's form degrades. The guesses are about DELIMITERS and column
 * counts, which is the narrowest kind available here: the question "what does this
 * parser do when a table arrives with single spaces" has a definite answer whether
 * or not a real PDF ever produces one.
 */

const caseNamed = (id: string) => SUB_LISTING_CASES.find((subject) => subject.id === id)!.text;

/**
 * The ids this file asserts against, pinned so that a fixture being renamed or
 * deleted fails HERE rather than throwing `undefined` into `parseSubListing`.
 *
 * `caseNamed` ends in a non-null assertion, so a missing id is a TypeError inside
 * a test about something else, which reads as the parser breaking. This is the
 * size-of-the-derived-set rule from CLAUDE.md applied to a lookup: assert the set
 * you are about to reason about actually has the members you think.
 */
const SHAPES_ASSERTED_HERE = [
  "single-space-columns",
  "single-space-after-wrap",
  "total-in-a-company-name",
  "totals-word-eats-a-company",
  "add-alternate-two-fields",
  "add-alternate-three-fields",
  "bare-number-as-licence",
] as const;

describe("the fixtures this file reasons about exist", () => {
  it("names every shape, so a renamed fixture fails here and not inside another test", () => {
    const ids = SUB_LISTING_CASES.map((subject) => subject.id);
    for (const required of SHAPES_ASSERTED_HERE) {
      expect(ids, `${required} is asserted against in parseShapes.test.ts`).toContain(required);
    }
    expect(SHAPES_ASSERTED_HERE).toHaveLength(7);
  });
});

describe("a table whose columns are separated by SINGLE spaces", () => {
  /**
   * `splitFields` splits on `\t+`, `\s{2,}` or `|`. A single-spaced table is one
   * field per line, so every row is held back as a "single" and then filed as
   * prose. This is the shape a PDF most often degrades to.
   */
  const parsed = parseSubListing(caseNamed("single-space-columns"));

  it("TODAY loses every subcontractor to the one-column branch — a real defect", () => {
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.ignored).toHaveLength(3);
    for (const line of parsed.ignored) {
      expect(line.why).toBe("one column only — a heading or prose, not a table row");
    }
  });

  it("TODAY still reports `agreed: true` over that loss, because `agreed` cannot see `ignored`", () => {
    // THE REASON THIS SHAPE IS SEVERE RATHER THAN MERELY WRONG. `agreed` is
    // `accountedFor === nonBlankLines && !unread.length && !problems.length`, and
    // three subcontractors in `ignored` satisfy all three terms. The screen prints
    // a green "every line was read" sentence over a page that lost every row —
    // which is the exact failure parse.ts's header says the rewrite was for, and
    // it survived the rewrite by arriving through a different bucket.
    expect(parsed.unread).toHaveLength(0);
    expect(parsed.problems).toEqual([]);
    expect(parsed.reconciliation.agreed).toBe(true);
    expect(parsed.reconciliation.rowsParsed).toBe(0);
  });

  it("does at least account for the lines, which is the one guarantee that holds", () => {
    const { reconciliation: r } = parsed;
    expect(r.accountedFor).toBe(r.nonBlankLines);
  });
});

describe("a single-spaced row that follows a row which looks cut off", () => {
  /**
   * The continuation branch attributes a one-field line to the row above when that
   * row is cut off. A complete but single-spaced row satisfies that test, so it is
   * swallowed as a continuation — and a concern is written onto the row above.
   */
  const parsed = parseSubListing(caseNamed("single-space-after-wrap"));

  it("TODAY swallows a whole second subcontractor as the first one's continuation — a real defect", () => {
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Sierra Wall Systems");
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.ignored[0].why).toBe("read as the continuation of line 2");
    // Kings Acoustical is a sub in our trades, with its own city, licence, scope
    // and amount, and it is nowhere in `rows`.
    expect(parsed.ignored[0].text).toContain("Kings Acoustical");
  });

  it("TODAY writes a FALSE concern onto the surviving row, which is worse than losing one", () => {
    // A lost row is a lead nobody contacts. This is a lead that gets contacted
    // with a sentence derived from another company's row attached to it. `concerns`
    // is rendered for the person reviewing the import, so this is a statement that
    // Kings Acoustical's entire row "may be the rest of" Sierra Wall Systems'.
    const concerns = parsed.rows[0].concerns;
    expect(concerns.some((concern) => concern.includes("may be the rest of this row"))).toBe(true);
    expect(concerns.some((concern) => concern.includes("Kings Acoustical"))).toBe(true);
  });

  it("TODAY reports `agreed: true` over that too", () => {
    expect(parsed.reconciliation.agreed).toBe(true);
  });
});

describe("the totals test's `fields.length <= 2` cap, in both directions", () => {
  /**
   * `furnitureReason` calls a line a total when `fields.length <= 2 &&
   * TOTALS_WORDS && MONEY`. The review suspected that cap was wrong at both ends,
   * and it is — but not in the way either half was predicted.
   */

  it("keeps a company whose name contains \"Total\", because `hasDataEvidence` runs first", () => {
    // NOT a defect: the rescue works. parse.ts's header names "Total Western,
    // Inc." as one of the three losses that forced the rewrite, so this is a pin
    // on the fix. The protection is the entity marker, not the parser knowing
    // anything about the word "Total" — which the next test is about.
    const parsed = parseSubListing(caseNamed("total-in-a-company-name"));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Total Western, Inc.");
    expect(parsed.rows[0].amount).toBe(450_000);
    expect(parsed.ignored).toEqual([]);
  });

  it("TODAY eats the same name once it has no entity marker — a real, narrow defect", () => {
    // "Total Drywall" has no entity marker, no place with a state code, and no run
    // of four or more digits ("$450,000" runs to three), so nothing rescues it.
    const parsed = parseSubListing(caseNamed("totals-word-eats-a-company"));
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.ignored[0].why).toBe(
      "a total or an alternate for the bid as a whole, not a subcontractor",
    );
  });

  it("correctly ignores a real alternate, whose consecutive tabs COLLAPSE to two fields", () => {
    // The predicted failure was that an alternate's long description plus an empty
    // column would reach three fields and escape the cap. REFUTED by running it:
    // `splitFields` separates on `\t+`, so `\t\t` is one separator.
    const parsed = parseSubListing(caseNamed("add-alternate-two-fields"));
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.ignored[0].why).toBe(
      "a total or an alternate for the bid as a whole, not a subcontractor",
    );
  });

  it("TODAY turns the same alternate into a LEAD once its description has its own column — a real defect", () => {
    // Three fields clears the cap, so the totals test never runs at all. The
    // bid-item exclusion in `isNameCandidate` is anchored
    // (`^(?:item|no|line|bid\s*item)\.?\s*\d+$`) and this string starts with
    // "Add", so it is accepted as a company name. `importSubListing` writes that
    // into `SalesLead.companyName`.
    const parsed = parseSubListing(caseNamed("add-alternate-three-fields"));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Add Alternate No. 1");
    // And it is sorted into our own trade, so it reaches the top of a list.
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(parsed.rows[0].portionOfWork).toBe("gypsum soffits at main entry");
    // No concern says any of this is doubtful.
    expect(parsed.rows[0].concerns).toEqual([]);
  });
});

describe("a bare undelimited number winning the licence slot", () => {
  /**
   * `LICENCE` accepts a 6–8 digit run with no label of any kind, so any six-digit
   * quantity on the row can become the licence. The floor is six because five is a
   * ZIP code — the same defect one digit further along, already paid for once.
   */
  const parsed = parseSubListing(caseNamed("bare-number-as-licence"));
  const row = parsed.rows[0];

  it("TODAY reads a square-foot quantity as the contractor's licence — a real defect", () => {
    expect(parsed.rows).toHaveLength(1);
    expect(row.name).toBe("Acme Drywall, Inc.");
    expect(row.licence).toBe("148000");
  });

  it("TODAY also loses the portion of work and the trade to the same field — the half nobody predicted", () => {
    // The field holding the quantity is ALSO disqualified from the scope slot, by
    // the address-line test `^\d+\s+\S`. So one field produces two wrong outputs:
    // an invented licence, and no portion of work at all — which costs the trade,
    // and the trade is what sorts a lead into our pipeline. "gypsum board" is
    // right there in the text.
    expect(row.portionOfWork).toBeNull();
    expect(row.tradeScope).toBeNull();
    expect(row.sourceText).toContain("gypsum board");
  });

  it("TODAY raises no concern about either, so nothing on screen marks the row as doubtful", () => {
    expect(row.concerns).toEqual([]);
    expect(parsed.reconciliation.agreed).toBe(true);
  });
});

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

  /**
   * FIXED. These two cases were written as `TODAY` reproductions and they turned
   * red when the parser was fixed, which is exactly what that convention is for
   * — the fixture gets updated, the test is not deleted.
   *
   * What changed: a one-column line carrying two of {a 6–10 digit licence, a
   * "City, ST", a company entity marker} is now read as a row this parser could
   * not split, and goes to `unread` rather than to `ignored` as prose.
   */
  it("REPORTS every subcontractor it could not split, instead of filing them as prose", () => {
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.ignored).toHaveLength(0);
    expect(parsed.unread).toHaveLength(3);
    for (const line of parsed.unread) {
      expect(line.why).toContain("arrived as a single column");
    }
    // The company names are on screen for the reviewer, which is the whole point
    // of the bucket: a line they can go and look at beats a count they cannot.
    expect(parsed.unread.map((line) => line.text).join(" ")).toContain("Valley Interior Systems");
  });

  it("no longer reports `agreed: true` over the loss", () => {
    // THE REASON THIS SHAPE WAS SEVERE RATHER THAN MERELY WRONG. `agreed` is
    // `accountedFor === nonBlankLines && !unread.length && !problems.length`, and
    // three subcontractors sitting in `ignored` satisfied all three terms — so the
    // screen printed a green "every line was read" sentence over a page that had
    // lost every row. That is the exact failure parse.ts's header says the rewrite
    // was for, and it survived the rewrite by arriving through a different bucket.
    // Moving them to `unread` is what makes the verdict honest, not a new counter.
    expect(parsed.reconciliation.agreed).toBe(false);
    expect(parsed.reconciliation.rowsParsed).toBe(0);
    expect(parsed.reconciliation.unreadLines).toBe(3);
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

  /**
   * FIXED, and this is the case that decided the SHAPE of the fix.
   *
   * The first version put the continuation test first, which left this one
   * broken — a complete but single-spaced row satisfies "the line above looks cut
   * off" and was swallowed. So the row test now OUTRANKS the continuation test,
   * and the discriminator is how many signals the line carries: a wrap fragment
   * is the tail of one cell and has at most one, a squashed row has a licence and
   * a place and usually a company marker.
   */
  it("reports the second subcontractor instead of swallowing it as a continuation", () => {
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Sierra Wall Systems");
    expect(parsed.ignored).toHaveLength(0);
    expect(parsed.unread).toHaveLength(1);
    // Kings Acoustical is a sub in our trades, with its own city, licence, scope
    // and amount. It is not in `rows` — this parser still cannot split it — but it
    // is now on screen rather than filed under another company's name.
    expect(parsed.unread[0].text).toContain("Kings Acoustical");
  });

  it("no longer writes a FALSE concern onto the surviving row, which was the worse half", () => {
    // A lost row is a lead nobody contacts. The old behaviour was worse: a lead
    // that DOES get contacted, carrying a sentence derived from another company's
    // row. `concerns` is rendered for the person reviewing the import, so it
    // stated that Kings Acoustical's entire row "may be the rest of" Sierra Wall
    // Systems'. Sierra keeps exactly one concern now — the true one, about its own
    // scope visibly not finishing.
    const concerns = parsed.rows[0].concerns;
    expect(concerns.some((concern) => concern.includes("may be the rest of this row"))).toBe(false);
    expect(concerns.some((concern) => concern.includes("Kings Acoustical"))).toBe(false);
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toContain("looks cut off");
  });

  it("no longer reports `agreed: true` over it", () => {
    expect(parsed.reconciliation.agreed).toBe(false);
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

/**
 * THE BACKSTOP, AND THE REASON IT NEEDED ITS OWN CASE.
 *
 * The fix above moves a one-column line to `unread` when it carries two of
 * {licence, "City, ST", entity marker}. A row can be single-spaced AND carry
 * none of that — "Smith Plastering  Fontana CA" has no comma before the state,
 * no entity suffix and no licence — so it is still filed as prose, and the fix
 * cannot see it.
 *
 * `parseSubListing` therefore raises a problem when NOTHING parsed and lines of
 * that shape are present. Written, and for one commit nothing exercised it: the
 * two single-space fixtures now send all their rows to `unread`, so `ignored` is
 * empty and the backstop never fires on either. That is this repo's recurring
 * "written, documented, and never called" shape, caught here only because the
 * mutation plan asked which assertion would go red and the answer was none.
 */
describe("a page that parsed nothing at all says so, even when no line looks like data", () => {
  const parsed = parseSubListing(
    ["Project: Lincoln Elementary Modernization", "Smith Plastering Fontana CA"].join("\n"),
  );

  it("raises a problem rather than reporting a clean read of zero subcontractors", () => {
    expect(parsed.reconciliation.rowsParsed).toBe(0);
    expect(parsed.unread).toHaveLength(0);
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain("nothing on this page was read as a subcontractor");
    // It names the likely cause, because "try pasting again" with no reason is
    // advice nobody follows.
    expect(parsed.problems[0]).toContain("single spaces");
  });

  it("keeps `agreed` false, which is the only thing standing between this and a green verdict", () => {
    expect(parsed.reconciliation.agreed).toBe(false);
  });

  it("does NOT fire when the page legitimately has no table — only furniture", () => {
    // `noise-only` is a page number, an addendum note and a phone number. Nothing
    // parsed there either, and that is the correct reading of the page rather than
    // a failure to read it — so the problem must stay silent, or every pasted
    // cover sheet reports a bug. This case caught the first version of the
    // backstop doing exactly that, which is why the guard also requires the page
    // to have announced itself as a listing with a header line.
    const furniture = parseSubListing(caseNamed("noise-only"));
    expect(furniture.reconciliation.headerLines).toBe(0);
    expect(furniture.reconciliation.rowsParsed).toBe(0);
    expect(furniture.problems).toEqual([]);
  });

  it("stays silent when the page DID parse rows, because then zero is not the signal", () => {
    const mixed = parseSubListing(
      [
        "Acme Drywall, Inc.\tFontana, CA\tLic. 884201\tDrywall",
        "Smith Plastering Fontana CA",
      ].join("\n"),
    );
    expect(mixed.reconciliation.rowsParsed).toBe(1);
    expect(mixed.problems).toEqual([]);
    // And the honest limit, asserted so nobody reads the fix as broader than it
    // is: that second row IS lost, quietly, and only `splitFields` learning
    // column positions can fix it.
    expect(mixed.ignored).toHaveLength(1);
    expect(mixed.ignored[0].why).toContain("one column only");
  });
});

/**
 * WHY THE DIGIT TEST IS LICENCE-SHAPED AND NOT MERELY LONG.
 *
 * Added because a mutation SURVIVED. Loosening `\b\d{6,10}\b` back to `\d{4,}`
 * — the first, wrong version of this fix — broke nothing in 278 tests, because
 * the furniture fixture's lines carry only ONE signal either way and the
 * two-of-three rule rejects them on the count alone. So the width was doing real
 * work with nothing asserting it, which is the state a surviving mutation is
 * always reporting.
 *
 * The case that needs it is a footer line that carries a second signal by
 * accident. A phone number plus a place is two signals under the loose pattern
 * and one under the right one.
 */
describe("a footer line carrying a phone number and a place is still not a subcontractor", () => {
  const parsed = parseSubListing(
    [
      "Project: Lincoln Elementary Modernization",
      "Acme Drywall, Inc.\tFontana, CA\tLic. 884201\tDrywall",
      "Questions: (916) 555-0134 Sacramento, CA",
    ].join("\n"),
  );

  it("does not read it as a row this parser failed to split", () => {
    // `555-0134` has a four-digit run and `Sacramento, CA` is a place, so under
    // `\d{4,}` this line scores two and is reported as a lost subcontractor on a
    // page that has exactly one. A licence is six to ten digits; a phone number's
    // last group is four, and that is the whole distinction.
    expect(parsed.reconciliation.rowsParsed).toBe(1);
    expect(parsed.rows[0].name).toBe("Acme Drywall, Inc.");
    expect(parsed.unread).toHaveLength(0);
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.ignored[0].why).toContain("one column only");
  });

  it("leaves the verdict clean, because nothing on this page was in fact lost", () => {
    // The cost of getting this wrong is not a lost row — it is `agreed` going
    // false on a page that read correctly, which spends the reviewer's trust on
    // nothing. A guard that cries wolf is read as noise by the second week.
    expect(parsed.problems).toEqual([]);
    expect(parsed.reconciliation.agreed).toBe(true);
  });
});

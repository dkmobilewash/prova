import { describe, expect, it } from "vitest";
import { looksCutOff, parseSubListing } from "./parse";
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
  "two-bidders-one-page",
  "bidder-name-wrapped",
] as const;

describe("the fixtures this file reasons about exist", () => {
  it("names every shape, so a renamed fixture fails here and not inside another test", () => {
    const ids = SUB_LISTING_CASES.map((subject) => subject.id);
    for (const required of SHAPES_ASSERTED_HERE) {
      expect(ids, `${required} is asserted against in parseShapes.test.ts`).toContain(required);
    }
    expect(SHAPES_ASSERTED_HERE).toHaveLength(9);
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

  it("no longer reads a square-foot quantity as the contractor's licence", () => {
    expect(parsed.rows).toHaveLength(1);
    expect(row.name).toBe("Acme Drywall, Inc.");
    // "148000 SF of gypsum board" is not a licence COLUMN — strip an optional
    // label and a class prefix and words remain. No licence is better than a
    // number belonging to nobody.
    expect(row.licence).toBeNull();
  });

  it("STILL loses the portion of work and the trade to the same field — an open defect, now flagged", () => {
    // The field holding the quantity is ALSO disqualified from the scope slot, by
    // the address-line test `^\d+\s+\S`. So one field produces two wrong outputs:
    // an invented licence, and no portion of work at all — which costs the trade,
    // and the trade is what sorts a lead into our pipeline. "gypsum board" is
    // right there in the text.
    //
    // UNFIXED on purpose, and recorded rather than quietly carried: moving the
    // licence to column discipline stopped the invented number but not this. The
    // row now arrives with a concern and no trade, so it is default-UNTICKED and
    // a person has to look at it — which is the right failure, not a fixed one.
    expect(row.portionOfWork).toBeNull();
    expect(row.tradeScope).toBeNull();
    expect(row.sourceText).toContain("gypsum board");
  });

  it("says on screen that it saw a licence-shaped number and declined to read it", () => {
    // The refusal is never silence. The reviewer has the document open and can
    // settle in one glance what no amount of parsing will.
    expect(row.concerns).toHaveLength(1);
    expect(row.concerns[0]).toContain("inside a wider field rather than in a column of its own");
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

/**
 * THE SPEC-SECTION COLLISION, WHICH IS WHY THE LICENCE MOVED TO COLUMN DISCIPLINE.
 *
 * `09 29 00` and `09 24 00` are the CSI section numbers for Gypsum Board and
 * Portland Cement Plastering — the two most likely to be printed on OUR OWN
 * trades' rows of a listing, in a Spec Section column. Stripped of spaces they
 * are six-digit runs, and the licence used to be the leftmost 6-to-8 digit run
 * anywhere on the row, so a spec section beat the contractor's real licence
 * sitting in the next column.
 */
describe("a spec-section number does not beat the contractor's real licence", () => {
  it("takes the licence from the column that holds only a licence", () => {
    const row = parseSubListing(
      "Acme Interiors, Inc.\tFontana, CA\t092900 Gypsum Board\t684213\tDrywall",
    ).rows[0];
    // The claim used to read "Listed with licence 092900" to a man whose licence
    // is 684213 and is on the same row. A CSLB number is the most checkable fact
    // about a contractor in this state, so that sentence does not read as a wrong
    // detail — it reads as not knowing who he is.
    expect(row.licence).toBe("684213");
    expect(row.portionOfWork).toBe("Drywall");
    expect(row.tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(row.concerns).toEqual([]);
  });

  it("refuses when a spec section sits ALONE in its own column, and names both", () => {
    // Then the two are genuinely indistinguishable by shape, and the doctrine the
    // amount already follows applies: when a document says two things, a parser
    // that chooses is a parser that invents.
    const row = parseSubListing(
      "Acme Interiors, Inc.\tFontana, CA\t092900\t684213\tDrywall",
    ).rows[0];
    expect(row.licence).toBeNull();
    expect(row.concerns.join(" ")).toContain("092900");
    expect(row.concerns.join(" ")).toContain("684213");
    expect(row.concerns.join(" ")).toContain("spec-section number printed in its own column");
  });

  it("still reads a labelled, a bare and a class-prefixed licence", () => {
    const labelled = parseSubListing("Acme Drywall, Inc.\tFontana, CA\tLic. 884201\tDrywall").rows[0];
    expect(labelled.licence).toBe("884201");
    const bare = parseSubListing("Acme Drywall, Inc.\tFontana, CA\t884201\tDrywall").rows[0];
    expect(bare.licence).toBe("884201");
    const classed = parseSubListing("Baker Plastering Co.\tRialto, CA\tC-35 775500\tPlaster").rows[0];
    expect(classed.licence).toBe("C-35 775500");
  });

  it("keeps a licence and a DIR registration apart when both are present", () => {
    const row = parseSubListing(
      "Acme Drywall, Inc.\tFontana, CA\t884201\t1000012345\tDrywall",
    ).rows[0];
    expect(row.licence).toBe("884201");
    expect(row.registration).toBe("1000012345");
  });

  it("does not let a LABELLED identifier column become the portion of work when it refuses", () => {
    // The scope slot used to exclude the licence by inequality against the CHOSEN
    // value. So when two licence-shaped fields made this refuse, `licence` was
    // null, `field !== licence` was true of everything, and both became eligible
    // to be quoted as the portion of work. A refusal must not widen what else can
    // go wrong, so the exclusion tests SHAPE now.
    //
    // Finding a case that can tell the two arms apart took three attempts, and
    // the failures are the useful part. A BARE "1065432" is excluded from the
    // scope slot anyway by the slot's own `[A-Za-z]{4}` test. "License No. 884201"
    // is excluded by its `^(?:lic|license|licence|dir|reg)\b` prefix test. Both
    // mutations survived, because in both cases something ELSE was doing the work.
    //
    // "CSLB" is the label that distinguishes them — it is four letters, it is how
    // a California form actually writes it, and it is not in that prefix list. So
    // this is the one case where the shape exclusion is load-bearing, and without
    // it the row's portion of work reads "CSLB 884201".
    const row = parseSubListing(
      "Acme Drywall, Inc.\tFontana, CA\tCSLB 884201\tCSLB 992211\tDrywall",
    ).rows[0];
    expect(row.licence).toBeNull();
    expect(row.portionOfWork).toBe("Drywall");
    expect(row.portionOfWork).not.toContain("CSLB");
  });

  it("does not read a registration out of the middle of a wider field", () => {
    // The same column discipline, and the same kind of case needed to prove it:
    // a registration already alone in its column cannot distinguish an anchored
    // pattern from an unanchored one.
    const row = parseSubListing(
      "Acme Drywall, Inc.\tFontana, CA\t884201\tRegistration 1000012345 verified 2026-03-04\tDrywall",
    ).rows[0];
    expect(row.licence).toBe("884201");
    expect(row.registration).toBeNull();
  });
});

/**
 * THE INVARIANT BEHIND THE VERDICT: NOTHING ROW-SHAPED REACHES THE SET-ASIDE PILE.
 *
 * `reconciliation.agreed`'s first conjunct is `accountedFor === nonBlankLines`,
 * and a fourth review established that it is a TAUTOLOGY — every non-blank line
 * is pushed into exactly one of four buckets, so the sum cannot disagree. The
 * third fires only on a conflicting header value. That left `unread.length === 0`
 * carrying the whole verdict, which is why every defect this parser has had
 * reported `agreed: true`: each one put a subcontractor in `ignored` with a
 * confident reason, and `agreed` cannot see `ignored`.
 *
 * `parseSubListing` now raises a problem when a set-aside line looks like a row.
 * **That branch is UNREACHABLE today and this suite says so rather than implying
 * otherwise** — six constructed attempts (a totals line that is also a company, a
 * heading-majority row carrying identifiers, a page-number line with a company in
 * it, an alternate with a licence, a wrap continuation that is a whole row, and
 * prose naming a company and a licence) all failed to land a row-shaped line in
 * `ignored`, because `hasDataEvidence` rescues it upstream and `looksLikeARow`
 * outranks the continuation branch.
 *
 * A conjunct over the set-aside pile was written for this and then DELETED, for
 * the reason `parse.ts` now records: removing it changed no outcome across 308
 * tests. What is kept is this block, and it is kept with its limit stated —
 * **it cannot fail against today's corpus.** Disabling `hasDataEvidence`
 * altogether reds eleven other tests and not one of these, because a well-formed
 * row does not trip the furniture branches even with the rescue gone.
 *
 * It is a forward guard, not a regression caught: it asks of every fixture the
 * question nobody was asking, so a future fixture that DOES lose a row to the
 * pile fails here instead of passing quietly. The second case below is the part
 * that can fail today — it keeps the predicate from rotting into one that matches
 * nothing, which is how a check of this shape goes vacuous.
 */
describe("across every fixture, nothing set aside looks like a subcontractor", () => {
  const looksLikeARow = (text: string) =>
    [
      /\b\d{6,10}\b/,
      /[A-Z][A-Za-z.\-]+,\s*[A-Z]{2}\b/,
      /\b(?:inc|llc|corp|corporation|co|company|ltd|llp|lp|systems|builders|construction|contractors|interiors|enterprises|group|industries)\b\.?/i,
    ].filter((pattern) => pattern.test(text)).length >= 2;

  it.each(SUB_LISTING_CASES.map((subject) => [subject.id, subject.text] as const))(
    "%s sets aside nothing that reads as a row",
    (_id, text) => {
      const parsed = parseSubListing(text);
      const offenders = parsed.ignored.filter(
        (line) => !line.why.startsWith("read as the continuation of") && looksLikeARow(line.text),
      );
      expect(offenders.map((line) => `line ${line.line}: ${line.text.trim()}`)).toEqual([]);
    },
  );

  it("and the predicate is not vacuous — it does recognise a row when shown one", () => {
    // Without this the block above would pass over an empty question, which is the
    // failure mode CLAUDE.md names for every deriving check in this repo.
    expect(looksLikeARow("Acme Drywall, Inc.  Fontana, CA  884201  Drywall")).toBe(true);
    expect(looksLikeARow("Page 3 of 7")).toBe(false);
    expect(looksLikeARow("Questions: (916) 555-0134")).toBe(false);
  });

  it("reports a row-shaped line rather than setting it aside, which is why the pile stays clean", () => {
    // This is the mechanism the block above depends on, asserted directly: a line
    // carrying a company, a place and a licence goes to `unread` — loud — and not
    // to `ignored`. The invariant holds because of THIS, not because of any check
    // over the pile afterwards.
    const parsed = parseSubListing("Page 1 of 3 Acme Drywall, Inc. Fontana, CA 884201");
    expect(parsed.ignored).toEqual([]);
    expect(parsed.unread).toHaveLength(1);
    expect(parsed.reconciliation.agreed).toBe(false);
  });
});

/**
 * A WRAP THAT SPANS TWO COLUMNS, WHICH INVENTED A SUBCONTRACTOR.
 *
 * The continuation branch only ever considered lines with fewer than two fields —
 * a wrap of ONE cell. A real PDF row wraps in several cells at once, so its second
 * physical line has two or more fields and became its own row. Run through the
 * real importer this wrote a lead for a company that does not exist, carrying a
 * sourced claim that a named GC listed it on a named project, ticked by default
 * because its trade matched, and undeletable.
 */
describe("a row that wraps across two columns does not become a second subcontractor", () => {
  const wrapped = [
    "Project: Lincoln Elementary Modernization",
    "Prime Contractor: Swinerton Builders",
    "Southern California\tFontana, CA\t1065432\tMetal stud framing",
    "Drywall & Interiors, Inc.\tand drywall",
    "Baker Plastering, LLC\tRialto, CA\t998877\tExterior plaster",
  ].join("\n");
  const parsed = parseSubListing(wrapped);

  it("reads two subcontractors, not three", () => {
    expect(parsed.reconciliation.rowsParsed).toBe(2);
    expect(parsed.rows.map((row) => row.name)).toEqual([
      "Southern California",
      "Baker Plastering, LLC",
    ]);
    // The phantom is the one that mattered: it would have carried a claim that
    // Swinerton listed it on Lincoln Elementary, about a company nobody has
    // heard of, and a lead with signals cannot be deleted.
    expect(parsed.rows.map((row) => row.name)).not.toContain("Drywall & Interiors, Inc.");
  });

  it("attributes the overflow to the row above and says the row is cut short", () => {
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.ignored[0].why).toBe("read as the continuation of line 3");
    const concerns = parsed.rows[0].concerns;
    expect(concerns.some((concern) => concern.includes("reads as its continuation"))).toBe(true);
    // The hedge `looksCutOff` provides cannot fire here — "Metal stud framing"
    // ends on a word boundary with no dangling token — so this concern is the only
    // thing that tells the reviewer the name and the scope are both truncated.
    expect(concerns.some((concern) => concern.includes("cut short"))).toBe(true);
  });

  it("does NOT swallow a real row that merely has fewer columns", () => {
    // The case the heading-majority defect loses: a sole proprietor with no
    // licence, no entity suffix and a city with no state code. It passes the first
    // two tests of the wrap rule and must fail the third, or this fix would eat
    // the very rows the parser is already worst at.
    const sparse = parseSubListing(
      [
        "Mesa Drywall, Inc.\tNational City, CA\t987654\tDrywall work",
        "Bianchi\tDaly City\tLath and plaster",
      ].join("\n"),
    );
    expect(sparse.rows.map((row) => row.name)).toContain("Bianchi");
    expect(sparse.ignored).toEqual([]);
  });

  it("does NOT swallow a complete row that follows a wider one", () => {
    const complete = parseSubListing(
      [
        "Mesa Drywall, Inc.\tNational City, CA\t987654\t$450,000\tDrywall",
        "Coastal Plastering, Inc.\tChula Vista, CA\t876543\tPlaster",
      ].join("\n"),
    );
    expect(complete.reconciliation.rowsParsed).toBe(2);
    expect(complete.ignored).toEqual([]);
  });

  it("protects a COMPLETE row whose scope is printed lower case — the row-shape test", () => {
    // Added because a mutation survived. Dropping `!looksLikeARow(raw)` broke
    // nothing, so the condition was load-bearing with nothing asserting it. The
    // case that separates the arms needs all of: a genuine row (licence, place and
    // company), FEWER fields than the row above, and a field opening lower case —
    // which a form printing its portion of work in lower case supplies for free.
    const parsed = parseSubListing(
      [
        "Mesa Drywall, Inc.\tNational City, CA\t987654\t$450,000\tDrywall work",
        "Summit Acoustics LLC\tRiverside, CA\t650118\tacoustical ceilings",
      ].join("\n"),
    );
    expect(parsed.reconciliation.rowsParsed).toBe(2);
    expect(parsed.rows[1].name).toBe("Summit Acoustics LLC");
    expect(parsed.rows[1].licence).toBe("650118");
    expect(parsed.ignored).toEqual([]);
  });

  it("protects a row that is WIDER than the one above it — the fewer-columns test", () => {
    // The other surviving mutation. An overflow line can only ever have fewer
    // cells than the row it overflows from, so a line with MORE is a row whatever
    // else it looks like. Rows legitimately vary in width when cells are empty.
    const parsed = parseSubListing(
      [
        "Mesa Drywall, Inc.\tDrywall",
        "Okonkwo Drywall\tFontana\tdrywall and taping",
      ].join("\n"),
    );
    expect(parsed.reconciliation.rowsParsed).toBe(2);
    expect(parsed.rows.map((row) => row.name)).toContain("Okonkwo Drywall");
    expect(parsed.ignored).toEqual([]);
  });

  it("needs all three signals, so a lowercase scope alone is not a wrap", () => {
    // A form that prints its portion of work in lower case is not a wrapped row.
    const lower = parseSubListing(
      [
        "Mesa Drywall, Inc.\tNational City, CA\t987654\tDrywall work",
        "Coastal Plastering, Inc.\tChula Vista, CA\t876543\texterior plaster",
      ].join("\n"),
    );
    expect(lower.reconciliation.rowsParsed).toBe(2);
    expect(lower.rows[1].portionOfWork).toBe("exterior plaster");
  });
});

/**
 * A PERCENTAGE COLUMN THAT DOES NOT SAY WHAT IT IS A PERCENTAGE OF.
 *
 * Every lone percentage became "listed at N% of the bid". A fourth review
 * observed `110%` and `999%` accepted in silence — neither can be a share of
 * anything — and named the plausible values as the worse problem: a payment or
 * performance bond column prints **100%** and a retention column prints **5%**.
 * Both belong on a public bid document and both would have been claimed as this
 * subcontractor's share of the bid.
 */
describe("a percentage is claimed with its ambiguity attached, not silently", () => {
  const withCell = (cell: string) =>
    parseSubListing(`Acme Drywall, Inc.\tFontana, CA\tDrywall\t${cell}`).rows[0];

  it("refuses a percentage that cannot be a share of anything, and says it saw it", () => {
    for (const cell of ["110%", "999%"]) {
      const row = withCell(cell);
      expect(row.percentOfBid).toBeNull();
      // Refused is not the same as unmentioned — this file's standing rule.
      expect(row.concerns.join(" ")).toContain("cannot be a share of a bid");
    }
  });

  it("claims a bare percentage but names what else the column could be", () => {
    // The first version of this fix REFUSED a bare percentage, and two existing
    // tests were right to fail it: a fixture exists because a form may carry a
    // percentage column instead of a dollar column, so refusing deletes that
    // capability on the strength of a guess. Every signal lands PROPOSED and a
    // person confirms it, so the useful move is to tell them what else it may be.
    for (const [cell, value] of [
      ["100%", 100],
      ["5%", 5],
      ["8.4%", 8.4],
    ] as const) {
      const row = withCell(cell);
      expect(row.percentOfBid).toBe(value);
      expect(row.concerns.join(" ")).toContain("does not say what it is a percentage OF");
      expect(row.concerns.join(" ")).toContain("bond column prints 100%");
    }
  });

  it("says nothing when the document labelled the column itself", () => {
    const row = withCell("15% of bid");
    expect(row.percentOfBid).toBe(15);
    expect(row.concerns.join(" ")).not.toContain("does not say what it is a percentage OF");
  });
});

/**
 * A CITY PRINTED WITHOUT ITS STATE CODE, WHICH COST THE SCOPE, THE TRADE, THE
 * GEOGRAPHY CLAIM AND SOMETIMES THE WHOLE ROW.
 *
 * `CITY_WITH_STATE` wants two trailing capitals, deliberately, so that "Culver
 * City, CA" is a city and the heading "City, State" is not. A form printing the
 * place of business without the state therefore had no city at all — and a city
 * is an eligible scope, so it won the portion-of-work slot from `rest.find(...)`,
 * which takes the first match.
 */
describe("a city without a state code is a city, not a portion of work", () => {
  it("reads the city, the real scope and the trade", () => {
    const row = parseSubListing(
      "Bianchi Plastering, Inc.\tUnion City\tInterior plaster work",
    ).rows[0];
    expect(row.city).toBe("Union City");
    expect(row.portionOfWork).toBe("Interior plaster work");
    expect(row.tradeScope).toBe("LATH_PLASTER");
  });

  it("matters because the trade decides whether the row is ticked at all", () => {
    // `shouldInclude` defaults a row to ticked only when `tradeScope` is set. With
    // the city in the scope slot the trade was null, so the prospect arrived
    // unticked and was silently left out of the import — a lost lead that looked
    // like a deliberate exclusion.
    const row = parseSubListing("Okonkwo Drywall, Inc.\tDaly City\tDrywall and taping").rows[0];
    expect(row.tradeScope).toBe("METAL_FRAMING_DRYWALL");
  });

  it("rescues the whole row when nothing else on it is recognisable", () => {
    // These three are the review's own examples, and each has no entity suffix, no
    // licence and no state code — so `hasDataEvidence` had nothing to rescue them
    // with and the heading-majority rule ate them, `agreed: true`. A name ending
    // in the word "City" is now evidence of data, which covers the set that bites:
    // Daly, Union, National, Culver, Redwood, Foster, Cathedral.
    for (const [text, trade] of [
      ["Bianchi Plastering\tUnion City\tInterior plaster work", "LATH_PLASTER"],
      ["Okonkwo Drywall\tDaly City\tDrywall and taping work", "METAL_FRAMING_DRYWALL"],
      ["Vang Acoustical\tNational City\tAcoustical ceiling work", "ACOUSTICAL_CEILINGS"],
    ] as const) {
      const parsed = parseSubListing(text);
      expect(parsed.reconciliation.rowsParsed).toBe(1);
      expect(parsed.rows[0].tradeScope).toBe(trade);
    }
  });

  it("prefers a trade-naming field for the scope even when no city is recognised", () => {
    // The narrower residual: a city that does NOT end in "City". The city is still
    // missed, but preferring a field that names one of our trades keeps it out of
    // the scope slot, so the row is still a usable prospect.
    const row = parseSubListing("Bianchi Plastering\tFontana\tInterior plaster work").rows[0];
    expect(row.portionOfWork).toBe("Interior plaster work");
    expect(row.tradeScope).toBe("LATH_PLASTER");
    expect(row.city).toBeNull();
  });

  it("a line that names one of our trades is never 'the table's column headings'", () => {
    // "Scope: drywall work" is three heading words by the pattern's reckoning —
    // `scope`, `work`, and `description` is not even needed — so a drywall sub in
    // a city with neither a state code nor the word "City" was filed as furniture.
    const parsed = parseSubListing("Northstate Drywall\tChico\tScope: drywall work");
    expect(parsed.reconciliation.rowsParsed).toBe(1);
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
  });

  it("rescues a row in a trade that is NOT one of ours, which only the city can do", () => {
    // Added because a mutation survived: removing the city from `hasDataEvidence`
    // broke nothing, since the trade-naming bail and the entity-marker rescue
    // already covered every case I first tried — "Acme Builders" is rescued by
    // `builders` being an entity marker, and anything naming drywall or plaster is
    // rescued by the bail.
    //
    // The case only the city can reach needs all four: no entity suffix, no trade
    // word, a labelled scope cell supplying two heading words, and a city with no
    // state code. It is not a prospect, and it is still a loss — the reader
    // promises not to lose anything, not merely not to lose prospects.
    const parsed = parseSubListing("Vang Carpentry\tUnion City\tScope of work: trim");
    expect(parsed.reconciliation.rowsParsed).toBe(1);
    expect(parsed.rows[0].city).toBe("Union City");
    expect(parsed.ignored).toEqual([]);
  });

  it("still sets a REAL heading row aside, which is the control that keeps this honest", () => {
    // A heading says what the column IS; a cell says what the work is. None of
    // these names a trade, which is exactly why the discriminator works.
    for (const heading of [
      "Subcontractor\tCity\tLicense\tPortion of Work",
      "Subcontractor Name\tCity, State\tLicense No.\tDescription of Work",
      "Firm\tLocation\tScope",
    ]) {
      const parsed = parseSubListing(heading);
      expect(parsed.reconciliation.rowsParsed).toBe(0);
      expect(parsed.ignored[0].why).toBe("the table's column headings");
    }
  });
});

/**
 * THE FIRST REAL DOCUMENT, AND IT IS NOT A TABLE.
 *
 * Every case in `subListingCases.ts` is a column table and its header says in as
 * many words that no real bid or award document had been read when they were
 * written. One has now been read: a Caltrans Bid Book, pulled from the public
 * Post-Bid Files portal (`ppmoe.dot.ca.gov/cc?id=cc_post_bids`, no login), which
 * carries the state's own `SUBCONTRACTOR LIST` form, `DES-OE-0102.2C`.
 *
 * It is a FORM, not a table — sixty numbered blocks, the labels printed beside
 * the values instead of above them in a heading row. Measured against the real
 * document before this guard existed, `readRow` returned **228 rows for three
 * subcontractors**, and on a clean paste of only the filled blocks it reported
 * `agreed: true` with fifteen rows and not one real company. That is the exact
 * silent-wrong-answer this parser's whole partition design exists to prevent,
 * and it survived 325 tests because every fixture was a guess at the format.
 *
 * **The fixture below is INVENTED and must stay invented.** The real document
 * names real subcontractors who did not agree to be test data; the project rule
 * is that they never enter a committed fixture. What is copied from the real
 * document is the SHAPE — the numbered toggle, the inline labels, the bare
 * licence with no class prefix, the registration label wrapping mid-phrase, the
 * per-item percentage table, and the form's own `Sample Data Entry` block, which
 * a column reader turns into phantom subcontractors called "striping" and
 * "reinforcement".
 */
describe("a filled subcontractor FORM is recognised and refused, not mis-read", () => {
  const FORM = `Contract ID: 06-1C3404                CALIFORNIA DEPARTMENT OF TRANSPORTATION
Bidder: Riverbend Constructors, Inc.                       Bidder ID: VC0000000000

STATE OF CALIFORNIA - DEPARTMENT OF TRANSPORTATION
SUBCONTRACTOR LIST
DES-OE-0102.2C(REV 04/2025)

Sample Data Entry:

Item    %     Description

6       75    striping

42      15    reinforcement

54     100

1) List this subcontractor?        YES      NO
     Business Name VANTAGE WALL SYSTEMS    Location City RIVERBEND  State CA
       California Contractor License Number          712345        Public Works Contractor            Registration
Number    1000447788
     Portion of Work Subcontracted
     Item             %                      Description
   1      50.00%     METAL STUD FRAMING
   5      100.00%     GYPSUM BOARD AND FINISH

2) List this subcontractor?       YES      NO
     Business Name CRESTLINE PLASTERING    Location City FORT HOLLOW  State CA
       California Contractor License Number          448120        Public Works Contractor            Registration
Number    1000552211
     Portion of Work Subcontracted
     Item             %                      Description
   9      100.00%     LATH AND CEMENT PLASTER`;

  it("invents no subcontractor rather than inventing a wrong one", () => {
    const parsed = parseSubListing(FORM);
    expect(parsed.reconciliation.rowsParsed).toBe(0);
    expect(parsed.rows).toEqual([]);
  });

  it("refuses to claim agreement, and names the form in a problem", () => {
    const parsed = parseSubListing(FORM);
    expect(parsed.reconciliation.agreed).toBe(false);
    expect(parsed.problems.join(" ")).toMatch(/looks like a filled subcontractor FORM/);
  });

  it("keeps the partition whole — every non-blank line is still accounted for", () => {
    const parsed = parseSubListing(FORM);
    expect(parsed.reconciliation.accountedFor).toBe(parsed.reconciliation.nonBlankLines);
  });

  it("never turns the form's own Sample Data Entry block into subcontractors", () => {
    // "striping" and "reinforcement" are the sample values the real form prints.
    // A column reader read both as companies; nothing may surface them now.
    const parsed = parseSubListing(FORM);
    const names = parsed.rows.map((row) => row.name.toLowerCase());
    expect(names).not.toContain("striping");
    expect(names).not.toContain("reinforcement");
  });

  /**
   * THE MARKERS ARE DELIBERATELY NOT THE LABELS, AND THIS IS THE CONTROL FOR IT.
   *
   * A legitimate column table may perfectly well head its columns "Business
   * Name", "Location City" and "State". Keying the refusal on those labels would
   * refuse documents this parser reads correctly today, so it keys on the
   * numbered toggle and the form's revision id, neither of which can appear in a
   * pasted table. Without this control the refusal could silently widen until it
   * swallowed the working case.
   */
  it("does NOT refuse a column table whose headings happen to use the same words", () => {
    const table = `Business Name              Location City      State   License
Vantage Wall Systems       Riverbend          CA      712345
Crestline Plastering       Fort Hollow        CA      448120`;
    const parsed = parseSubListing(table);
    expect(parsed.problems.join(" ")).not.toMatch(/looks like a filled subcontractor FORM/);
    expect(parsed.reconciliation.rowsParsed).toBeGreaterThan(0);
  });
});

/**
 * THE SHAPE A CALIFORNIA BUILDING OWNER ACTUALLY POSTS — AND IT IS A TABLE.
 *
 * UCLA Capital Programs publishes "BID SUMMARY SHEET WITH SUBCONTRACTORS" PDFs
 * (`contract.capnet.ucla.edu`) carrying every bidder's filled §4104 list as a
 * COLUMN TABLE with a text layer, columns separated by runs of three or more
 * spaces. Five such PDFs were read: 20 bidder lists, about 149 subcontractor
 * rows. **These five trades are in them** — the cells read "Drywall", "ACT",
 * "Acoustical Ceilings", "Framing Drywall", "Firestopping", "Suspension Ceiling".
 *
 * That matters because Caltrans, whose form `parse.ts` now refuses, builds ROADS:
 * across 14 of its listings these trades appeared in exactly one. Building owners
 * — universities, school districts, cities — are where this product's prospects
 * are, and UCLA posts the shape this parser was written for. Run against the real
 * document, it read all 14 rows of one bidder's list and got 12 of the 14 names
 * right, including the drywall sub with its licence, registration and trade.
 *
 * **FIXED IN THIS FILE'S OWN HISTORY: the two TODAY tests that used to sit here —
 * the name/scope swap and the unread bare city — were reproductions, and the
 * column plan turned them red exactly as the convention says it should. They now
 * assert the right answer instead.**
 *
 * **The real column ORDER is not the one every other fixture here assumes.**
 * UCLA prints `Portion of Work: | Name of Business: | Location: | License #: |
 * DIR #:` — the scope FIRST and the company SECOND. Every other case in
 * `subListingCases.ts` puts the name first. The column-order assumption that
 * file's header flags as a guess was simply wrong, and this is the evidence.
 *
 * Invented names throughout, per the rule; the shape, spacing and column order
 * are copied exactly. A real UCLA sheet names real subcontractors.
 */
/**
 * THE SECOND FORM SHAPE, AND THE REASON THE FIRST REFUSAL WAS NOT ENOUGH.
 *
 * The refusal above is keyed on two Caltrans markers — the numbered toggle and
 * the `DES-OE-0102` revision id — and its own comment argues, correctly, that
 * keying on the LABELS would refuse legitimate column tables. What neither it nor
 * that comment noticed is that those markers belong to ONE publisher. UC Berkeley
 * and UC Davis Health both publish a §4104 list as a different form: the labels
 * down the left, each bidder's answers in a column to the right.
 *
 * Measured against fixtures built from those real documents, BEFORE this change:
 *
 *   | document | rows | **ticked for import** |
 *   | --- | --- | --- |
 *   | Berkeley, 6 bidders | 52 | **6** |
 *   | Berkeley, 2 bidders | 63 | **4** |
 *   | Berkeley, 4 bidders | 41 | **2** |
 *   | Berkeley, 5 bidders | 29 | **2** |
 *   | UC Davis Health | 36 | 0 |
 *   | Berkeley, 1 bidder | 15 | 0 |
 *
 * **The row count is the dramatic number and the ticked count is the dangerous
 * one**, because a row is only imported when its trade matched. Fourteen leads
 * would have been created across four documents, and they are wrong in two
 * distinct ways. A real firm under the WRONG TRADE — a plumbing company ticked as
 * METAL_FRAMING_DRYWALL, a casework company as LATH_PLASTER — where the name is
 * right, the trade is a lie, and the trade is the thing somebody reads down a
 * telephone. And the form's OWN INSTRUCTION TEXT as a company: `(e.g. electrical,
 * mechanical, concrete)` arrived ticked three times in one document.
 *
 * `agreed` already read false on every one of them, which is the honesty signals
 * working — and is not a refusal. A person looking at 52 rows and a warning can
 * still press the button.
 *
 * **WHAT MAKES IT SAFE TO KEY ON THE LABELS AFTER ALL: POSITION.** In a form the
 * label is the first thing on its line and the values are to the right of it. In
 * a column table every label is on ONE line, so only the first of them leads.
 * Matching the LEADING FIELD rather than a substring is what lets this refuse a
 * form without touching the tables — and the thresholds (three families, with the
 * name and licence families twice each) are what makes a table with a single
 * heading row score below it however its columns are ordered. The two tests below
 * that read rather than refuse are the point of the whole design.
 *
 * Invented names throughout. The shape, the labels, the `(e.g. …)` line and the
 * `Subcontractor 2- Location` dash variant are the real documents'.
 */
/**
 * A PLAN THAT FITS BY COUNT AND IS ONE SLOT OUT — THE WORST THING THIS READER CAN
 * DO, AND IT WAS DOING IT.
 *
 * `plan.length === fields.length` is the guard against a shifted index. It is
 * necessary and not sufficient. Four of twenty real bidder lists wrap `License`
 * across two lines, so the heading LINE carries four labels and the plan is four
 * wide — and a row whose portion of work wrapped away has four fields too. It
 * matches by count, every slot shifts one to the left, and **the city lands in the
 * company slot.**
 *
 * Measured on the real corpus: three leads named **"San Diego", "Corona" and
 * "Gardena"**. Not a null and not a concern — a wrong company name, on a lead this
 * importer cannot delete, with a real trade and a real licence beside it making it
 * look entirely credible. The column plan was built to prevent exactly this swap.
 *
 * **The fix is three decisions, and the second came from the first being wrong.**
 *
 * 1. The tell is a PAIR of slots disagreeing with their own kinds — the company
 *    slot reads as a place AND the place slot does not. One slot alone would be a
 *    guess: a firm named after its own town has a place slot that reads perfectly.
 *    There is a control test for that below and it is why the condition is a pair.
 * 2. **The shift disqualifies the PLAN, not the row.** The first version refused
 *    the row outright, and that refused FIVE rows to fix three — two of the others,
 *    and one of the three, carry a company name with an entity marker plainly on
 *    the line. `ENTITY_MARKER` survives a shift because it is a property of the
 *    value rather than of its position. Refusing those threw away an identifiable
 *    prospect to avoid a wrong one, the trade this file argues against everywhere.
 * 3. Only where no field carries one is the row refused — and there the refusal is
 *    right twice over, because the remaining fallback is "the first field that
 *    could be a name", which on these rows is the portion of work. A named gap
 *    beats a lead called "Metals", and both beat one called "Corona".
 *
 * Net on the 20 real lists: 158 rows to 157, three wrong company names gone, one
 * row honestly refused, and not one city lost.
 */
/**
 * WHICH GENERAL CONTRACTOR LISTED THIS SUBCONTRACTOR — the fact that makes a §4104
 * listing worth more than a licence database, and it was reaching no row.
 *
 * A bidder's own table does not contain the bidder's name, and a whole page
 * contains SIX of them, so `header.prime` correctly refuses to name one and every
 * row came back with no GC at all. Measured end to end: a perfect import of a real
 * page, with every signal confirmed, topped out at "Trade and area confirmed, but
 * nothing specific to open with yet" — a list of drywall companies obtainable from
 * a licence database. The only route to a strong lead was a person hand-typing four
 * header lines into the paste before parsing.
 *
 * So the bidder is read per row, and `header.prime` is left alone to do what it
 * does: carry a prime the document LABELLED, and refuse when a page names several.
 *
 * **THREE RULES WERE MEASURED AND REJECTED BEFORE THIS ONE, and each looked right.**
 *
 * 1. "The non-blank line above `Total Bid`" returns the alternate's dollar figure —
 *    `= $ 6,000.00` on six of seven anchors in the real document.
 * 2. "A line indented six or less" works on the file as extracted and cannot
 *    survive a paste, whose indentation may be stripped or shifted wholesale.
 * 3. "Left of the smallest indent of any three-field line" puts the table's edge at
 *    3, because furniture at the left margin has three fields. It attributed zero.
 *
 * What survives is the RELATION: the bidder's name sits to the LEFT of where the
 * table's columns begin, because it is not in the table. The edge comes from the
 * first RECOGNISED LABEL on a heading this parser already finds in 20 of 20 real
 * lists — not the first FIELD, since seven of twenty print "Sub Contractor Listing"
 * at the left margin on that same line, which read 27% of rows against 84%.
 *
 * Two further rules, each from a wrong value it removed:
 *
 * - **A bidder has a bid.** `Example University Capital Programs` is a perfectly
 *   company-shaped left-column line, and ordering alone does not exclude it,
 *   because the preamble's `Vendor Name: (2)Lump Sum:` reads as a column heading
 *   and commits it. Every real bidder is followed by its own figure before its
 *   listing; the title is not. That removed twelve rows attributed to a GC that is
 *   not a GC.
 * - **A name ending in a comma invites the next line.** "Williamson Construction
 *   Co.," wraps to "Inc." — one word, so the shape test rejects it, and the name
 *   shipped truncated at its own comma. The continuation is read from the first
 *   FIELD, because the real one prints the bid figure beside it.
 *
 * Measured on six real whole pages: **188 of 223 rows carry the right GC (84%)**,
 * and the 20 single-bidder blocks are unchanged at 157 rows, because a block
 * contains no bidder line and null is the honest answer there.
 */
describe("which bidder listed each subcontractor", () => {
  /**
   * The fixture lives in `subListingCases.ts` so the shared corpus can see per-row
   * attribution at all — see `two-bidders-one-page` there. It was inline here, and
   * inline it was invisible to every `it.each(SUB_LISTING_CASES)` block in this
   * directory, which is how a claim naming the wrong contractor survived 388 green
   * tests. Read from the corpus rather than copied into it: one definition, so the
   * mechanism's own tests and the corpus-wide ones cannot drift apart.
   */
  const PAGE = caseNamed("two-bidders-one-page");
  it("attributes every row to the bidder whose listing it sat under", () => {
    const parsed = parseSubListing(PAGE);
    expect(parsed.rows.map((r) => [r.name, r.listedBy])).toEqual([
      ["Example Wallworks Inc", "Alpha Example Builders Inc"],
      ["Mock Acoustics Inc", "Alpha Example Builders Inc"],
      ["Crestline Lathing Co", "Bravo Example Construction Co., Inc."],
    ]);
  });

  /**
   * The page names two bidders, so `header.prime` must still refuse to name one.
   * The two mechanisms answer different questions and neither replaces the other.
   */
  it("still refuses to name one prime for a page with two", () => {
    expect(parseSubListing(PAGE).header.prime).toBeNull();
  });

  /** A bidder has a bid; the owner's own title does not. */
  it("does not mistake the page's own title for a bidder", () => {
    expect(parseSubListing(PAGE).rows.map((r) => r.listedBy)).not.toContain(
      "Example University Capital Programs",
    );
  });

  /** A name ending in a comma takes the next line with it. */
  it("joins a bidder name wrapped across two lines", () => {
    expect(parseSubListing(PAGE).rows[2]?.listedBy).toBe(
      "Bravo Example Construction Co., Inc.",
    );
  });

  /**
   * And one bidder's table pasted on its own carries no bidder, because the name is
   * not in it. Null is the honest answer and the reason `header.prime` still exists
   * for a document that labels its prime.
   */
  it("says null when the paste cannot know", () => {
    const table = [
      "Portion of Work:        Name of Business:         Location:      DIR #:",
      "Metal Stud Framing      Example Wallworks Inc     Fairview       1000447788",
    ].join("\n");
    const parsed = parseSubListing(table);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.listedBy).toBeNull();
  });
});

/**
 * ── THE CORPUS CAN NOW SEE WHO LISTED WHOM, WHICH IT COULD NOT ──
 *
 * Every `it.each(SUB_LISTING_CASES)` block in this directory asserts COUNTS: how
 * many rows, how many unread, that the four buckets sum. None of them has ever
 * looked at a row's CONTENT, and `listedBy` is the field that makes a lead worth
 * a telephone call rather than a name off a licence database.
 *
 * It was not an oversight anybody could have spotted from the cases: all sixteen
 * that predate `two-bidders-one-page` parse to `listedBy: null` on every row,
 * because each is one bidder's table pasted alone and a table does not contain its
 * own bidder's name. Null was right in all sixteen. The consequence was that
 * nothing in the corpus could tell `row.listedBy` from `header.prime`, so
 * `signals.ts` building its PROJECT and GC_RELATIONSHIP claims from the page-level
 * prime — which a multi-bidder page REFUSES to name — put the wrong contractor's
 * name in a claim with `problems` empty, and 388 tests stayed green.
 */
describe("across every fixture, each row is attributed to the bidder the case declares", () => {
  const declaring = SUB_LISTING_CASES.filter((subject) => subject.expectListedBy !== undefined);

  it.each(declaring.map((subject) => [subject.id, subject] as const))(
    "%s attributes every row to the bidder its listing sat under",
    (_id, declared) => {
      const parsed = parseSubListing(declared.text);
      expect(parsed.rows.map((row) => row.listedBy)).toEqual(declared.expectListedBy);
    },
  );

  /**
   * AND THE CHECK IS NOT ABOUT AN EMPTY QUESTION — the half CLAUDE.md says every
   * deriving guard here has to assert separately, because nothing is ever missing
   * from a list nobody declares.
   *
   * Two things, not one. That SOME case declares an expectation at all, so deleting
   * `expectListedBy` from the corpus fails here rather than turning the block above
   * into zero tests; and that some case declares two DIFFERENT bidders, because a
   * corpus whose every declared value is the same string cannot tell per-row
   * attribution from a single page-level prime copied onto each row — which is the
   * exact defect this block exists for.
   */
  it("is not vacuous — some case declares attribution, and some case declares two different bidders", () => {
    expect(
      declaring.map((subject) => subject.id),
      "no case declares `expectListedBy`, so the block above asserts nothing",
    ).not.toEqual([]);
    const distinct = declaring.flatMap((subject) =>
      [...new Set(subject.expectListedBy!.filter((name) => name !== null))],
    );
    const perCase = declaring.map(
      (subject) => new Set(subject.expectListedBy!.filter((name) => name !== null)).size,
    );
    expect(distinct.length).toBeGreaterThan(1);
    expect(
      Math.max(...perCase),
      "every case names at most one bidder, so a page-level prime copied onto each row would pass",
    ).toBeGreaterThan(1);
  });
});

/**
 * ── A BIDDER WHOSE OWN NAME VISIBLY DOES NOT FINISH ──
 *
 * `looksCutOff` guarded three fields and not the fourth. The header's prime raised
 * a page-level `problem`; the company name and the portion of work each raised a
 * row `concern`; the row's `listedBy` raised nothing, and `listedBy` is what
 * `importSubListing` writes into `SalesLead.listedByGc` and what the GC column
 * prints.
 *
 * `signals.ts` hedges the SENTENCE — `gcPhrase` appends an ellipsis — and that made
 * it worse rather than better: the sentence a person reads said "Charlie Example
 * Brothers and…" while the field beside it said "Charlie Example Brothers and", and
 * the hedge was the only evidence anything was wrong. The hedge is not what gets
 * stored.
 */
describe("a bidder name read off a row that looks cut off", () => {
  const parsed = parseSubListing(caseNamed("bidder-name-wrapped"));

  /** The wrap is joined only after a COMMA, so this half commits alone. */
  it("still attributes the row, because half a name is better evidence than none", () => {
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].listedBy).toBe("Charlie Example Brothers and");
  });

  it("says on the row itself that the bidding contractor looks cut off", () => {
    expect(parsed.rows[0].concerns.join(" ")).toMatch(/bidding contractor reads/);
    expect(parsed.rows[0].concerns.join(" ")).toContain("Charlie Example Brothers and");
  });

  /**
   * A CONCERN, NOT A PAGE `problem`, AND NOT BOTH.
   *
   * `listedBy` is per row on purpose: a page with six bidders is read correctly
   * instead of refused. Raising a page-level problem would flip `agreed` for the
   * whole page over one bidder, and the five rows that read correctly are not the
   * rows anybody needs warning about.
   */
  it("does not refuse the page over it", () => {
    expect(parsed.problems).toEqual([]);
  });

  /**
   * The control, and it is not optional: a concern that fires on every row is
   * indistinguishable from one that fires on the right row. `two-bidders-one-page`
   * names three bidders, none of which dangles.
   */
  it("is silent about a bidder name that does finish", () => {
    const clean = parseSubListing(caseNamed("two-bidders-one-page"));
    expect(clean.rows).toHaveLength(3);
    for (const row of clean.rows) {
      expect(row.concerns.join(" "), row.name).not.toMatch(/bidding contractor reads/);
    }
  });

  /**
   * The same predicate, not a second rule. `looksCutOff` is the one definition of
   * "visibly does not finish" in `parse.ts` — it already answers for the header's
   * prime, the company name and the portion of work — so a second spelling of the
   * dangling set here would be the "is there a second list" defect. Asserted by
   * showing this concern agrees with the exported predicate on the value it quotes.
   */
  it("agrees with the exported predicate rather than spelling the rule a second time", () => {
    expect(looksCutOff(parsed.rows[0].listedBy)).toBe(true);
    expect(looksCutOff("Charlie Example Brothers")).toBe(false);
  });
});

describe("a column plan that fits by count but is one slot out", () => {
  const WRAPPED = `Sub Contractor Listing                                              License
Portion of Work:        Name of Business:               Location:             DIR #:
                                                                    #:
Metal Stud Framing      Example Wallworks Inc           Fairview              884201            1000447788
                        Crestline Lathing Co Inc.       Fort Hollow           448120            1000889922`;
  const NO_COMPANY = `Sub Contractor Listing                                              License
Portion of Work:        Name of Business:               Location:             DIR #:
                                                                    #:
Metal Stud Framing      Example Wallworks Inc           Fairview              884201            1000447788
                                Lath and Plaster        Fort Hollow           448120            1000889922`;
  const NAMED_AFTER_TOWN = `Portion of Work:        Name of Business:               Location:             License #:        DIR #:
Acoustical Ceilings     Fort Hollow                     Fort Hollow           884201            1000447788
Lath and Plaster        Crestline Lathing Co            Fairview              448120            1000889922`;
  it("reads the company from its own wording when the plan has shifted", () => {
    const parsed = parseSubListing(WRAPPED);
    expect(parsed.rows.map((r) => r.name)).toEqual([
      "Example Wallworks Inc",
      "Crestline Lathing Co Inc.",
    ]);
    const shifted = parsed.rows[1];
    // The plan's place slot holds the licence on this row, and a disagreement is
    // not a licence to invent a city.
    expect(shifted?.city).toBeNull();
    expect(shifted?.concerns.join(" ")).toMatch(/do not line up with this row/);
    /**
     * The COMPLETE row above it keeps its name, trade and licence AND reads its
     * city — which is a correction to this assertion's first version, in two
     * places rather than one.
     *
     * It used to expect `city` to be null, and said so deliberately: the heading
     * line carries four labels where the row has five fields, so no plan applied
     * and "Fairview" has no state code for the fallback patterns. It called that
     * the wrapped-`License` heading, "worth 12 cities on the real corpus and NOT
     * fixed here". It is fixed now — the heading's wrapped label is joined back
     * on from the line above and the line below, and the measured yield was
     * exactly the 12 that sentence predicted (131 to 143 cities of 157 real rows).
     * See the block at the end of this file.
     *
     * The second correction is to the FIXTURE, and it is the more useful one. Its
     * `License` sat at column 60, over the top of `Location:` at 56-65, and its
     * `#:` sat at column 3 at the left margin — neither of which is where the real
     * documents print them. So this fixture was never the wrapped shape it was
     * written to describe, and a join keyed on column position correctly declined
     * to touch it. Both are now in the licence column's own gap, between
     * `Location:` and `DIR #:`, which is what the corpus prints. The three other
     * tests in this block were unaffected by the realignment: the plan-shift
     * behaviour they pin does not depend on where the wrapped label sits.
     */
    expect(parsed.rows[0]?.name).toBe("Example Wallworks Inc");
    expect(parsed.rows[0]?.portionOfWork).toBe("Metal Stud Framing");
    expect(parsed.rows[0]?.city).toBe("Fairview");
  });

  /**
   * THE CONTROL THE PAIR CONDITION EXISTS FOR: a firm named after a town, with its
   * own place column reading correctly. A detector keyed on "the company slot
   * looks like a city" alone refuses this row; keyed on the pair it never fires.
   */
  it("does not fire on a firm legitimately named after a town", () => {
    const parsed = parseSubListing(NAMED_AFTER_TOWN);
    expect(parsed.rows.map((r) => [r.name, r.city, r.portionOfWork])).toEqual([
      ["Fort Hollow", "Fort Hollow", "Acoustical Ceilings"],
      ["Crestline Lathing Co", "Fairview", "Lath and Plaster"],
    ]);
    expect(
      parsed.rows.map((r) => r.concerns.join(" ")).join(" "),
    ).not.toMatch(/do not line up/);
  });

  it("refuses a shifted row that carries no company name at all", () => {
    const parsed = parseSubListing(NO_COMPANY);
    expect(parsed.rows.map((r) => r.name)).toEqual(["Example Wallworks Inc"]);
    expect(
      [...parsed.unread, ...parsed.ignored].map((l) => l.why).join(" "),
    ).toMatch(/no field on it reads as a company name/);
  });

  /**
   * The positional scope fallback is withdrawn on a shifted row, because position
   * is what has gone wrong. Fixing the NAME moved the wrong value rather than
   * removing it: one real row came back correctly named with
   * `portionOfWork: "San Diego"`, and the portion of work is quoted verbatim in the
   * claim somebody reads down a telephone. A scope that names one of our five
   * trades still survives, because that is intrinsic to the value.
   */
  it("quotes no portion of work it can only guess at", () => {
    const parsed = parseSubListing(
      WRAPPED.replace("Crestline Lathing Co Inc.", "Harbor Interiors Inc. "),
    );
    expect(parsed.rows[1]?.name).toBe("Harbor Interiors Inc.");
    expect(parsed.rows[1]?.portionOfWork).toBeNull();
  });

});

describe("the OTHER form: labels on the left, each bidder in a column", () => {
  const LABELLED = `Example University — Final Bid Results
Generated September 16, 2026                            Alpha Example Builders Inc       Bravo Example Construction

LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)           Metal Stud Framing & Drywall     DRYWALL/FRAMING
      Subcontractor 1 - Name of Business                Example Wallworks Inc            Harbor Interiors LLC
      Subcontractor 1 - Location of Business (city)     Fairview                         FAIRVIEW
      Subcontractor 1 - License No.                     884201                           903774
      Subcontractor 1 - DIR Registration No.            1000447788                       2000552211
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)           Lath & Plaster                   N/A
      Subcontractor 2 - Name of Business                Crestline Lathing Co             N/A
      Subcontractor 2- Location of Business (city)      Fort Hollow                      N/A
      Subcontractor 2 - License No.                     448120                           N/A
      Subcontractor 2 - DIR Registration No.            1000889922                       N/A`;

  /**
   * **THESE TWO TESTS USED TO ASSERT A REFUSAL, AND THE CHANGE IS THE POINT.**
   * They were written when this shape was recognised and declined; the reader in
   * the describe below now reads it. What they assert instead is the thing the
   * refusal was protecting — that nothing is INVENTED — which is a property of
   * both the old behaviour and the new one, and the only one that ever mattered.
   * Every name below is a firm the document actually prints.
   */
  it("reads the firms the document names, and invents nothing else", () => {
    const parsed = parseSubListing(LABELLED);
    expect(parsed.rows.map((r) => r.name)).toEqual([
      "Example Wallworks Inc",
      "Harbor Interiors LLC",
      "Crestline Lathing Co",
    ]);
    // Bidder two answered slot 2 with N/A, so there is no third-and-fourth row.
    expect(parsed.rows).toHaveLength(3);
    for (const row of parsed.rows) {
      expect(LABELLED).toContain(row.name);
    }
  });

  it("counts every non-blank line, and refuses to call the counts a partition", () => {
    const parsed = parseSubListing(LABELLED);
    const nonBlank = LABELLED.split("\n").filter((l) => l.trim()).length;
    expect(parsed.reconciliation.nonBlankLines).toBe(nonBlank);
    expect(parsed.unread).toEqual([]);
    // `agreed` is false here for a structural reason rather than a defect: one
    // label line carries several subcontractors' data and one subcontractor is
    // assembled from five lines, so rows and lines cannot be compared at all.
    expect(parsed.reconciliation.agreed).toBe(false);
    expect(parsed.problems.join(" ")).toMatch(/does not attribute a subcontractor/);
  });

  /**
   * THE CONTROL THAT THE WHOLE DESIGN RESTS ON, and the one a substring match
   * fails. This table's heading LEADS with `Name of Business:` — the name family,
   * as the first field on its line — and it must still be read. It is, because a
   * table prints its heading ONCE and the threshold is two.
   */
  it("still reads a column table that LEADS with the company column", () => {
    const parsed = parseSubListing(
      [
        "Name of Business:       Location:      License #:   DIR #:        Portion of Work:",
        "Example Wallworks Inc   Fairview       884201       1000447788    Metal Stud Framing",
        "Crestline Lathing Co    Fort Hollow    448120       1000889922    Lath and Plaster",
      ].join("\n"),
    );
    expect(parsed.reconciliation.rowsParsed).toBe(2);
    expect(parsed.rows.map((r) => r.name)).toEqual([
      "Example Wallworks Inc",
      "Crestline Lathing Co",
    ]);
    expect(parsed.problems.join(" ")).not.toMatch(/this looks like a filled/);
  });

  /**
   * THE CASE THAT MAKES THE LICENCE THRESHOLD LOAD-BEARING, and the only one
   * found that does. Two primes' tables pasted together print the heading TWICE,
   * so the name family leads twice and the `name >= 2` test alone would refuse a
   * document this parser reads. What saves it is that `License #:` is never a
   * leading field in a table — it is always to the right of something.
   */
  it("still reads TWO primes' tables pasted together, each leading with the company", () => {
    const parsed = parseSubListing(
      [
        "Alpha Example Builders Inc — list of subcontractors",
        "Name of Business:       Location:      License #:   DIR #:        Portion of Work:",
        "Example Wallworks Inc   Fairview       884201       1000447788    Metal Stud Framing",
        "",
        "Bravo Example Construction — list of subcontractors",
        "Name of Business:       Location:      License #:   DIR #:        Portion of Work:",
        "Crestline Lathing Co    Fort Hollow    448120       1000889922    Lath and Plaster",
      ].join("\n"),
    );
    expect(parsed.problems.join(" ")).not.toMatch(/this looks like a filled/);
    expect(parsed.rows.map((r) => r.name)).toEqual([
      "Example Wallworks Inc",
      "Crestline Lathing Co",
    ]);
  });

  /**
   * And the prime's own licence block, which every one of these bid-results sheets
   * carries. It uses `Name of Licensee` and `License Number`, neither of which is
   * a family, so it scores zero — stated as a test because the obvious "widen the
   * patterns" tidy-up would make this document refuse and take the tables above
   * with it.
   *
   * **AND IT MUST INVENT NOTHING FROM IT EITHER**, which is a second and sharper
   * assertion than not refusing. The reader recovers a label that has run together
   * with its value by trimming trailing words until what is left is a label —
   * and `Name of Licensee` trims to `Name of`, which is a wrap FRAGMENT of the
   * name family. Before the recovery was restricted to WHOLE labels, this block
   * produced a subcontractor called "Licensee" and took a one-bidder document from
   * three rows to five.
   */
  it("is not triggered by the prime's licence block, and invents nothing from it", () => {
    const BLOCK = [
      "CALIFORNIA CONTRACTOR'S LICENSE",
      "Name of Licensee          Alpha Example Builders Inc     Bravo Example Construction",
      "Classification            A, B                           B",
      "License Number            1250301                        1250308",
      "DIR Registration Number   1900000901                     1900000912",
    ].join("\n");
    expect(parseSubListing(BLOCK).problems.join(" ")).not.toMatch(/this looks like a filled/);
    // And inside a document that IS this form, the block must contribute no row.
    const withBlock = parseSubListing(`${LABELLED}\n\n${BLOCK}`);
    expect(withBlock.rows.map((r) => r.name)).not.toContain("Licensee");
    expect(withBlock.rows.map((r) => r.name)).toEqual([
      "Example Wallworks Inc",
      "Harbor Interiors LLC",
      "Crestline Lathing Co",
    ]);
  });
});

/**
 * READING THAT FORM, HAVING SPENT A COMMIT REFUSING IT.
 *
 * The refusal above is the floor, not the capability: UC Berkeley and UC Davis
 * Health are where this product's trades appear, and a refusal gets nobody a
 * prospect. What this reads is WHICH FIRMS ARE LISTED. What it deliberately does
 * not read is WHICH BIDDER listed them, and the asymmetry is measured rather than
 * cautious — one real document names five bidders and prints four columns, so an
 * ordinal attribution puts every row in it against the wrong GC.
 *
 * Cross-checked against an independent prototype written from the same documents:
 * both return 27, 27, 11, 41, 3 and 4 rows on the six fixtures built from them.
 * Two implementations agreeing is worth more than either one's own test.
 *
 * The offsets below are the real documents' structure at a narrower gauge — the
 * originals put their columns at 132, 203, 279 and 361, which would make every
 * line here 400 characters wide and no clearer. Every identifier is invented.
 */
describe("the labelled-column form, read rather than refused", () => {
  const ALIGNED = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Metal Stud Framing & Drywall  DRYWALL/FRAMING
      Subcontractor 1 - Name of Business            Example Wallworks Inc         Harbor Interiors LLC
      Subcontractor 1 - Location of Business (city) Fairview                      FAIRVIEW
      Subcontractor 1 - License No.                 884201                        903774
      Subcontractor 1 - DIR Registration No.        1000447788                    2000552211
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)
      Subcontractor 2 - Name of Business
      Subcontractor 2 - Location of Business (city)
      Subcontractor 2 - License No.
      Subcontractor 2 - DIR Registration No.`;
  const RAGGED = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Site Demolition               Electrical                    Acoustical Ceilings
      Subcontractor 1 - Name of Business            Dummy Demolition Group        Notional Power Co             Mock Acoustics Inc
      Subcontractor 1 - License No.                 884201                        903774                        771002
      Subcontractor 1 - DIR Registration No.        1000447788                    2000552211                    1000889922
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)                                     Lath and Plaster              Spray Applied Fireproofing
      Subcontractor 2 - Name of Business                                          Crestline Lathing Co          Vantage Fire Protection
      Subcontractor 2 - License No.                                               448120                        662015
      Subcontractor 2 - DIR Registration No.                                      1000330044                    1000770011`;
  const UNUSED = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Metal Stud Framing            N/A
      Subcontractor 1 - Name of Business            Example Wallworks Inc         N/A
      Subcontractor 1 - License No.                 884201                        N/A
      Subcontractor 1 - DIR Registration No.        1000447788                    N/A
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)
      Subcontractor 2 - Name of Business
      Subcontractor 2 - Location of Business (city)
      Subcontractor 2 - License No.
      Subcontractor 2 - DIR Registration No.`;
  const ODD = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Acoustical Ceilings
      Subcontractor 1 - Name of Business            Mock Acoustics Inc
      Subcontractor 1 - Location of Business (city) 1 Example Way, Kestrel, CA 90001
      Subcontractor 1 - License No.                 C-10 1250007
      Subcontractor 1 - DIR Registration No.        19000000550
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)
      Subcontractor 2 - Name of Business
      Subcontractor 2 - Location of Business (city)
      Subcontractor 2 - License No.
      Subcontractor 2 - DIR Registration No.`;
  const PAGED = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Metal Stud Framing            Drywall
      Subcontractor 1 - Name of Business            Example Wallworks Inc         Harbor Interiors LLC
      Subcontractor 1 - License No.                 884201                        903774

  Subcontractor 2 - Portion of the Work Activity
  (e.g. electrical, mechanical, concrete)     Lath and Plaster            Fireproofing
  Subcontractor 2 - Name of Business          Crestline Lathing Co        Vantage Fire Protection
  Subcontractor 2 - License No.               448120                      662015`;
  const DISTANT = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Metal Stud Framing
      Subcontractor 1 - Name of Business            Example Wallworks Inc
      Subcontractor 1 - License No.                 884201
      Subcontractor 1 - DIR Registration No.
      Amount of Subcontract
      Bonding
      Insurance
      SBE                                           9999999999
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)
      Subcontractor 2 - Name of Business
      Subcontractor 2 - Location of Business (city)
      Subcontractor 2 - License No.
      Subcontractor 2 - DIR Registration No.`;

  const GAPPED = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)                                     Lath and Plaster              Spray Applied Fireproofing
      Subcontractor 1 - Name of Business                                                                        Vantage Fire Protection
      Subcontractor 1 - License No.                                               448120                        662015
      Subcontractor 1 - DIR Registration No.                                      1000330044                    1000770011
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)
      Subcontractor 2 - Name of Business
      Subcontractor 2 - License No.
      Subcontractor 2 - DIR Registration No.`;

  const SPLIT_SLOT = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Acoustical Ceilings           Metal Stud Framing
      Subcontractor 1 - Name of Business            Mock Acoustics Inc            Example Wallworks Inc

  Subcontractor 1 - License No.               771002                      884201
  Subcontractor 1 - DIR Registration No.      1000889922                  1000447788
  Subcontractor 2 - Portion of the Work Activity
  (e.g. electrical, mechanical, concrete)
  Subcontractor 2 - Name of Business
  Subcontractor 2 - License No.
  Subcontractor 2 - DIR Registration No.`;
  const DRIFTED = `LIST OF SUBCONTRACTORS:
      Subcontractor 1 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)       Acoustical Ceilings           Metal Stud Framing
      Subcontractor 1 - Name of Business             Mock Acoustics Inc            Example Wallworks Inc
      Subcontractor 1 - License No.                 771002                        884201
      Subcontractor 2 - Portion of the Work Activity
      (e.g. electrical, mechanical, concrete)
      Subcontractor 2 - Name of Business
      Subcontractor 2 - License No.
      Subcontractor 2 - DIR Registration No.`;

  it("reads one row per bidder column, each paired with its OWN answers", () => {
    const parsed = parseSubListing(ALIGNED);
    expect(
      parsed.rows.map((r) => [r.name, r.portionOfWork, r.city, r.licence, r.registration]),
    ).toEqual([
      ["Example Wallworks Inc", "Metal Stud Framing & Drywall", "Fairview", "884201", "1000447788"],
      ["Harbor Interiors LLC", "DRYWALL/FRAMING", "FAIRVIEW", "903774", "2000552211"],
    ]);
    expect(parsed.rows.map((r) => r.tradeScope)).toEqual([
      "METAL_FRAMING_DRYWALL",
      "METAL_FRAMING_DRYWALL",
    ]);
  });

  /**
   * A slot that leaves a COLUMN empty — `ucb_bot`'s real shape, five bidders in
   * the header and four columns on every row. Slot 1 fills three columns; slot 2
   * leaves the first one blank. Every firm must keep its own trade.
   */
  it("reads a slot that leaves a column empty without shifting the rest", () => {
    const parsed = parseSubListing(RAGGED);
    expect(parsed.rows.map((r) => [r.name, r.portionOfWork, r.licence])).toEqual([
      ["Dummy Demolition Group", "Site Demolition", "884201"],
      ["Notional Power Co", "Electrical", "903774"],
      ["Mock Acoustics Inc", "Acoustical Ceilings", "771002"],
      ["Crestline Lathing Co", "Lath and Plaster", "448120"],
      ["Vantage Fire Protection", "Spray Applied Fireproofing", "662015"],
    ]);
  });

  /**
   * AND THE CASE THAT ACTUALLY SEPARATES "NEAREST COLUMN" FROM "ORDINAL", which
   * the test above does NOT. There, every family line in a slot carries the same
   * number of values, so counting from the left and measuring from the left agree.
   * Ordinal reading only breaks when the families DISAGREE within one slot — which
   * is `ucb_dwinelle`'s real shape, a slot whose single value sits in column two.
   *
   * Here the portion line carries two trades and the name line carries one firm,
   * in the SECOND column. Ordinal pairs that firm with the FIRST trade, filing
   * `Vantage Fire Protection` as doing lath and plaster. Nearest-column gives it
   * its own.
   *
   * Written because the obvious test was the wrong test: replacing the column
   * assignment with `values.indexOf(value)` left all 363 tests green, including
   * the one above, which was written for exactly this decision.
   */
  it("pairs a lone value with ITS column, not with the first one", () => {
    const parsed = parseSubListing(GAPPED);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.name).toBe("Vantage Fire Protection");
    expect(parsed.rows[0]?.portionOfWork).toBe("Spray Applied Fireproofing");
    expect(parsed.rows[0]?.tradeScope).toBe("FIREPROOFING");
    expect(parsed.rows[0]?.licence).toBe("662015");
    expect(parsed.rows[0]?.registration).toBe("1000770011");
  });

  it("emits nothing for a slot a bidder answered N/A", () => {
    const parsed = parseSubListing(UNUSED);
    expect(parsed.rows.map((r) => r.name)).toEqual(["Example Wallworks Inc"]);
  });

  /**
   * The grid does not survive a page boundary — one real document's runs
   * {56,133} -> {51,83} -> {50,82} -> {51,76}, with the indentation moving
   * 6 -> 0 -> 5. Derived once for the whole document, page two's columns merge
   * into page one's and the pairing is scrambled.
   */
  it("derives the grid per PAGE, so a form feed cannot scramble the pairing", () => {
    const parsed = parseSubListing(PAGED);
    expect(parsed.rows.map((r) => [r.name, r.portionOfWork])).toEqual([
      ["Example Wallworks Inc", "Metal Stud Framing"],
      ["Harbor Interiors LLC", "Drywall"],
      ["Crestline Lathing Co", "Lath and Plaster"],
      ["Vantage Fire Protection", "Fireproofing"],
    ]);
  });

  /**
   * Every one of these three is a real printed value from the corpus. None is
   * refused: the row is claimed and the oddity is named, because a person is
   * about to read the document anyway and deleting the prospect to avoid being
   * wrong about its licence format costs more than it saves.
   */
  /**
   * A SLOT SPLIT BY THE PAGE BREAK, which is what makes the per-page grid
   * load-bearing rather than tidy. `ucb_minor485` has two form feeds and one of
   * them lands mid-block.
   *
   * Page one's columns are at 52 and 82; page two's at 46 and 74. Derived ONCE
   * for the whole document those are four columns, so this slot's name lands in
   * column three and its licence in column two — the licence is silently lost and
   * the firm arrives with no identifier at all. Derived per page they are both
   * column index one, and the firm keeps its licence.
   *
   * The test above this one does not catch that: there the two pages hold
   * DIFFERENT slots, which are keyed separately anyway, so a single global grid
   * gets the same answer. Removing the page split left all 366 tests green.
   */
  it("keeps a slot together when the page breaks in the middle of it", () => {
    const parsed = parseSubListing(SPLIT_SLOT);
    expect(parsed.rows.map((r) => [r.name, r.portionOfWork, r.licence, r.registration])).toEqual([
      ["Mock Acoustics Inc", "Acoustical Ceilings", "771002", "1000889922"],
      ["Example Wallworks Inc", "Metal Stud Framing", "884201", "1000447788"],
    ]);
  });

  /**
   * And the two-character tolerance the grid is built with, which nothing else
   * here exercises: this fixture puts ONE line's values a single character to the
   * right of the others', the way a form feed shifts the line after it. Without
   * the tolerance those become columns of their own and every firm loses the
   * fields that drifted.
   */
  it("tolerates a one-character drift rather than inventing a column", () => {
    const parsed = parseSubListing(DRIFTED);
    expect(parsed.rows.map((r) => [r.name, r.portionOfWork, r.licence])).toEqual([
      ["Mock Acoustics Inc", "Acoustical Ceilings", "771002"],
      ["Example Wallworks Inc", "Metal Stud Framing", "884201"],
    ]);
  });

  it("claims an odd licence, an odd DIR and an address-in-city, and says so", () => {
    const parsed = parseSubListing(ODD);
    expect(parsed.rows).toHaveLength(1);
    const [row] = parsed.rows;
    expect(row?.name).toBe("Mock Acoustics Inc");
    expect(row?.licence).toBe("C-10 1250007");
    expect(row?.registration).toBe("19000000550");
    expect(row?.concerns.join(" ")).toMatch(/C-10 1250007/);
    expect(row?.concerns.join(" ")).toMatch(/19000000550/);
    expect(row?.concerns.join(" ")).toMatch(/street address/);
  });

  /**
   * A wrapped label's values are on the next line or the one after. Without a
   * bound, "the next line that HAS values" reaches five lines down — and in
   * `ucdavis_9579290` that line is an `SBE` row, so its value becomes a DIR
   * registration. There it is harmless only because the slot has no name and
   * emits no row; here the slot has a name, so the wrong value would ship.
   */
  it("does not let a label five lines up swallow an unrelated value", () => {
    const parsed = parseSubListing(DISTANT);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.name).toBe("Example Wallworks Inc");
    expect(parsed.rows[0]?.registration).toBeNull();
  });

  /** The honesty, as a test rather than a comment, because it is the deliverable. */
  it("says it is not attributing a subcontractor to a bidder", () => {
    const parsed = parseSubListing(ALIGNED);
    expect(parsed.problems.join(" ")).toMatch(/does not attribute a subcontractor/);
    expect(parsed.problems.join(" ")).toMatch(/Treat the GC as unknown/);
  });

  /**
   * Zero subcontractors and a failure to read are DIFFERENT OUTCOMES. Three of
   * nine real Berkeley files legitimately list nobody — a package bid, a courtesy
   * listing — and reporting that as a parse failure makes a correct day look
   * broken.
   */
  it("distinguishes an empty form from an unreadable one", () => {
    const parsed = parseSubListing(
      UNUSED.replace(/Example Wallworks Inc/, "N/A").replace(/Metal Stud Framing/, "N/A"),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems.join(" ")).toMatch(/not one subcontractor was read/);
    expect(parsed.problems.join(" ")).toMatch(/real and ordinary thing/);
  });

  /** And the numbered-block form is still refused; two shapes, two outcomes. */
  it("still refuses the Caltrans numbered-block form", () => {
    const parsed = parseSubListing(
      [
        "DES-OE-0102.2C(REV 04/2025)",
        "1) List this subcontractor?        YES      NO",
        "     Business Name VANTAGE WALL SYSTEMS    Location City RIVERBEND  State CA",
      ].join("\n"),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems.join(" ")).toMatch(/numbered block/);
  });
});

describe("the UCLA shape: scope in column one, company in column two", () => {
  // Three rows chosen to reproduce exactly what the real document exposed:
  // one ordinary company, one whose DIR registration starts with 2, and one
  // with NO entity suffix — which is the row that goes wrong.
  const UCLA = `                    Portion of Work:       Name of Business:                        Location:          License #:    DIR #:
                    Framing Drywall        Halloran Interior Systems, Inc.          Valencia           438612        1000013433
                    Doors/HW               Rosegate Builders, Inc.                  Los Angeles        1130181       2000015618
                    Millwork               Marbury West                             Temple City        1046943       1000062389`;

  it("reads every row and the headings, and claims nothing it did not read", () => {
    const parsed = parseSubListing(UCLA);
    expect(parsed.reconciliation.rowsParsed).toBe(3);
    expect(parsed.reconciliation.accountedFor).toBe(parsed.reconciliation.nonBlankLines);
    expect(parsed.ignored.map((line) => line.why)).toContain("the table's column headings");
  });

  it("reads the drywall sub correctly — name, licence, registration and trade", () => {
    const parsed = parseSubListing(UCLA);
    const drywall = parsed.rows.find((row) => row.licence === "438612");
    expect(drywall?.name).toBe("Halloran Interior Systems, Inc.");
    expect(drywall?.registration).toBe("1000013433");
    expect(drywall?.tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(drywall?.portionOfWork).toBe("Framing Drywall");
  });

  /**
   * A REGRESSION, NOT A REPRODUCTION. `REGISTRATION` was `1\d{9}` and silently
   * dropped this value while every other field on the row read correctly and
   * `agreed` stayed true. Two independent real corpora show `20…`.
   */
  it("reads a DIR registration that starts with 2", () => {
    const parsed = parseSubListing(UCLA);
    const row = parsed.rows.find((candidate) => candidate.licence === "1130181");
    expect(row?.registration).toBe("2000015618");
  });

  /**
   * TODAY: A COMPANY WITH NO ENTITY SUFFIX LOSES ITS NAME TO ITS OWN SCOPE.
   *
   * "Marbury West" carries no `Inc`/`LLC`/`Corp`, so the name predicate prefers
   * the scope cell and the row comes out named "Millwork" with the real company
   * demoted into `portionOfWork`. On the real document this happened to 2 of 14
   * rows — about 14% — and `agreed` read TRUE throughout, so the importer would
   * create leads called "Concrete" and "Millwork".
   *
   * Same root cause as the Caltrans form's lost company: no entity marker, so
   * `hasDataEvidence` and the name predicate cannot see it. The fix is for
   * `splitFields` to learn column POSITIONS from the heading row — which UCLA
   * prints, and which the comment above `accountedFor` names as the actual fix.
   * When that lands this test goes red; change the assertion and delete the TODAY.
   */
  it("reads the company from the NAME column even with no entity suffix", () => {
    const parsed = parseSubListing(UCLA);
    const row = parsed.rows.find((candidate) => candidate.licence === "1046943");
    expect(row?.name).toBe("Marbury West");
    expect(row?.portionOfWork).toBe("Millwork");
  });

  /**
   * TODAY: A BARE CITY WITH NO STATE CODE YIELDS NO GEOGRAPHY.
   *
   * UCLA prints "Valencia", not "Valencia, CA" — `CITY_WITH_STATE` wants two
   * trailing capitals and `CITY_SUFFIXED` wants the word "City", so 13 of 14 real
   * rows read `city: null`. The one that worked was "Temple City", and only
   * because of its name. This is the residual already recorded in
   * `subListingCases.ts`, now measured on a real document instead of predicted.
   */
  /**
   * `ACT` is acoustical ceiling tile and it is one of this product's five trades.
   * It appears on nine of the 154 real rows. The scope predicate requires four
   * letters — right for guessing at an unknown column order, wrong once the
   * document has said which column the scope is. Before the plan this row's scope
   * read as its own CITY; a column that says "Portion of Work" ends that.
   */
  it("reads a three-letter scope like ACT from the scope column", () => {
    const shortScope = `                    Portion of Work:       Name of Business:                        Location:          License #:    DIR #:
                    ACT                    Coastline Ceilings, Inc.                 Simi Valley        585006        1000004348`;
    const parsed = parseSubListing(shortScope);
    expect(parsed.rows[0]?.portionOfWork).toBe("ACT");
    expect(parsed.rows[0]?.name).toBe("Coastline Ceilings, Inc.");
    expect(parsed.rows[0]?.city).toBe("Simi Valley");
  });

  it("reads a bare city with no state code, because the column says it is one", () => {
    const parsed = parseSubListing(UCLA);
    const drywall = parsed.rows.find((row) => row.licence === "438612");
    expect(drywall?.city).toBe("Valencia");
    expect(drywall?.tradeScope).toBe("METAL_FRAMING_DRYWALL");
  });
});

/**
 * THE HEADING LAYOUTS THE REAL CORPUS ACTUALLY PRINTS, AND WHAT EACH ONE COSTS.
 *
 * Counted across 20 real bidder lists in five UCLA PDFs. The column ORDER never
 * varies — `Portion of Work | Name of Business | Location | License # | DIR #`,
 * with no amount or percentage column ever present — but the LAYOUT does, and
 * only two of the four variants give five fields on a 2+-space split:
 *
 *   9 lists  the five labels on their own line                      → plan works
 *   7 lists  the same labels on the same line as "Sub Contractor     → plan works,
 *            Listing"                                                  by trimming
 *   3 lists  `License #:` wrapped across two lines (4 fields)       → no plan
 *   1 list   compact, three labels sharing a field                  → no plan
 *
 * The last two fall back to the predicate path, which is the pre-existing
 * behaviour and is why they are recorded here rather than fixed: a plan built
 * from a heading this parser only half understood would assign columns by an
 * index that is already wrong, confidently. Degrading is the correct answer.
 */
describe("heading layouts: the plan is taken only when the heading is understood", () => {
  const ROWS = `                    Framing Drywall        Halloran Interior Systems, Inc.          Valencia           438612        1000013433
                    Millwork               Marbury West                             Temple City        1046943       1000062389`;

  it("takes the plan when the table's TITLE shares the heading line (7 of 20 real lists)", () => {
    const titleOnSameLine = `   Sub Contractor Listing          Portion of Work:    Name of Business:    Location:    License #:    DIR #:
${ROWS}`;
    const parsed = parseSubListing(titleOnSameLine);
    const row = parsed.rows.find((candidate) => candidate.licence === "1046943");
    expect(row?.name).toBe("Marbury West");
    expect(row?.city).toBe("Temple City");
  });

  /**
   * A heading yielding four fields against five-field rows. The plan is refused
   * and the predicate path runs, so the company without an entity suffix is
   * mis-named exactly as it was before any of this existed. Recorded as the
   * measured cost of degrading rather than guessing.
   */
  it("REFUSES a half-understood heading and degrades to the predicate path", () => {
    const wrappedLicenceHeading = `                    Portion of Work:       Name of Business:                        Location:          DIR #:
${ROWS}`;
    const parsed = parseSubListing(wrappedLicenceHeading);
    const row = parsed.rows.find((candidate) => candidate.licence === "1046943");
    expect(row?.name).toBe("Millwork");
  });

  /**
   * An unrecognised column in the MIDDLE is kept in place, because the rows have
   * a cell for it and dropping it would shift every index after it. Here a real
   * `Item` column sits between the scope and the name.
   */
  it("keeps an unrecognised middle column so later indices do not shift", () => {
    const withMiddleColumn = `                    Portion of Work:    Bid Item    Name of Business:                   Location:     License #:    DIR #:
                    Framing Drywall     14          Halloran Interior Systems, Inc.     Valencia      438612        1000013433`;
    const parsed = parseSubListing(withMiddleColumn);
    expect(parsed.rows[0]?.name).toBe("Halloran Interior Systems, Inc.");
    expect(parsed.rows[0]?.city).toBe("Valencia");
  });

  /**
   * A HEADING THAT LABELS SOME COLUMNS AND NOT OTHERS IS USED FOR THE ONES IT
   * LABELS — which is a correction to this test's first version.
   *
   * It originally asserted that such a heading is refused outright, to defend a
   * `named.includes("name")` condition in `columnPlanFrom`. The mutation deleting
   * that condition left every test green, because `plannedIndex` is already `-1`
   * when no column reads as the name and the name already falls back by itself.
   * The condition was dead, and it was also harmful: it discarded a `Location`
   * column because the same heading had failed to label its company column.
   *
   * So the honest assertion is the mixed one. The name falls back to the
   * predicate and takes the first plausible field — wrong here, and unchanged
   * from before any of this existed. The city, which the heading DOES label, is
   * read.
   */
  it("uses the columns a partial heading does label, and falls back for the rest", () => {
    const noNameColumn = `                    Portion of Work:       Location:          License #:    DIR #:
                    Framing Drywall        Valencia           438612        1000013433`;
    const parsed = parseSubListing(noNameColumn);
    expect(parsed.rows[0]?.name).toBe("Framing Drywall");
    expect(parsed.rows[0]?.city).toBe("Valencia");
  });
});

/**
 * SAYING SO WHEN THE PAGE WAS NOT FULLY READ — THREE SIGNALS, MEASURED.
 *
 * A diagnosis across 20 real bidder lists carrying 154 known rows found
 * `reconciliation.agreed` reading **TRUE on all 20**, including the eight that lost
 * or mangled a row. The partition always sums, because a wrapped cell lands in
 * `ignored` as "one column only" and a two-field fragment becomes a row — so
 * `accountedFor === nonBlankLines` can never notice, and `unread` was empty
 * everywhere. 125 of 154 rows were perfect, 29 were not, and nothing said which.
 *
 * These three signals are what close that, and the measured result on the real
 * corpus is **6 of 8 damaged blocks flagged, 0 of 12 clean blocks wrongly
 * flagged.** Two damaged blocks stay silent; see the note at the end.
 *
 * **None of this is the guard the file says was dead.** That one asked whether a
 * set-aside line LOOKED like a row — a content predicate, and useless here, because
 * a wrap fragment is `Services` or `INC.` or `PW-LR-`. These ask about POSITION and
 * about what the document's own heading promised, neither of which that guard had.
 */
describe("the parser says so when it did not fully read the page", () => {
  it("flags a one-column line stranded BETWEEN two rows as a wrapped cell", () => {
    const wrapped = `                    Portion of Work:       Name of Business:                        Location:          License #:    DIR #:
                    Framing Drywall        Halloran Interior Systems, Inc.          Valencia           438612        1000013433
                    Acoustical
                    Millwork               Marbury West                             Temple City        1046943       1000062389`;
    const parsed = parseSubListing(wrapped);
    expect(parsed.problems.join(" ")).toMatch(/inside the table/);
    expect(parsed.reconciliation.agreed).toBe(false);
  });

  /**
   * The same fragment ABOVE the rows is a heading or prose and must stay quiet —
   * this is the control that keeps the signal positional rather than a blanket
   * complaint about one-column lines, of which a normal document has several.
   */
  it("stays quiet about a one-column line that is NOT between two rows", () => {
    const titled = `   Sub Contractor Listing
                    Portion of Work:       Name of Business:                        Location:          License #:    DIR #:
                    Framing Drywall        Halloran Interior Systems, Inc.          Valencia           438612        1000013433
                    Millwork               Marbury West                             Temple City        1046943       1000062389`;
    const parsed = parseSubListing(titled);
    expect(parsed.problems.join(" ")).not.toMatch(/inside the table/);
    expect(parsed.reconciliation.agreed).toBe(true);
  });

  /**
   * `394`, `88` and `PW-LR-1001079292` are all real printed values that read as
   * NOTHING — the licence pattern wants 6-to-8 digits and the registration wants
   * ten bare ones. Three of 154 real rows lose an identifier this quietly, with
   * every other field fine. The plan is what makes it sayable: the heading named
   * the column, so the disagreement is between the document and this reader.
   */
  it("says when the document names a licence column and the cell does not read", () => {
    const shortLicence = `                    Portion of Work:       Name of Business:                        Location:          License #:    DIR #:
                    Framing Drywall        Halloran Interior Systems, Inc.          Valencia           394           1000013433`;
    const parsed = parseSubListing(shortLicence);
    expect(parsed.rows[0]?.licence).toBeNull();
    expect(parsed.rows[0]?.concerns.join(" ")).toMatch(/heads column \d+ as the contractor's licence/);
    expect(parsed.rows[0]?.concerns.join(" ")).toContain('"394"');
  });

  it("says the same when the registration column carries a prefixed value", () => {
    const prefixed = `                    Portion of Work:       Name of Business:                        Location:          License #:    DIR #:
                    Framing Drywall        Halloran Interior Systems, Inc.          Valencia           438612        PW-LR-1001079292`;
    const parsed = parseSubListing(prefixed);
    expect(parsed.rows[0]?.registration).toBeNull();
    expect(parsed.rows[0]?.concerns.join(" ")).toMatch(/public-works registration/);
  });

  /**
   * A heading whose columns cannot be matched to the rows means the rows were read
   * by guessing. Three real lists wrap `License` onto the line above its `#:`.
   *
   * **THE LIMIT THIS COMMENT RECORDED HAS BEEN MEASURED AGAIN AND BOTH HALVES OF
   * IT WERE WRONG.** It said this warning reaches "NONE of the four real wrapped or
   * compact lists, because their heading lines are not recognised as headings in the
   * first place". `furnitureReason` detects a heading on 20 of 20 real lists and
   * did when that was written; the heading was always found, and what failed was
   * one step later, in matching its columns to the rows. And the figure moved with
   * the fix: 26 of 157 real rows read `city: null`, not 23 of 154, and it is 14 now
   * that a wrapped label is joined back on from the adjacent line.
   *
   * Recorded rather than quietly rewritten, because the wrong half is the half that
   * stops anyone looking: a note saying the heading is never even recognised sends
   * the next reader to `furnitureReason`, which is working, instead of to the
   * column plan, which was not.
   */
  it("flags a recognised heading whose columns do not fit the rows", () => {
    const unusable = `                    Portion of Work:       Name of Business:                        Location:          DIR #:
                    Framing Drywall        Halloran Interior Systems, Inc.          Valencia           438612        1000013433`;
    const parsed = parseSubListing(unusable);
    expect(parsed.problems.join(" ")).toMatch(/could not be matched to the rows/);
  });

  /**
   * The compact heading, where the last three labels share one field. Reading the
   * heading as TEXT rather than as whitespace-separated fields is what recovers it.
   * Worth 3 cities on the real corpus — 128 to 131 of 157 — which is the honest
   * figure and smaller than it looks, for the reason in the test above. (The
   * denominator read 154 here and 157 is what the corpus harness counts; the three
   * rows are not new, the earlier figure was.)
   */
  it("takes the plan from a COMPACT heading whose labels share a field", () => {
    const compact = `                    Portion of Work:       Name of Business:                        Location: License #: DIR #:
                    Millwork               Marbury West                             Temple City        1046943       1000062389`;
    const parsed = parseSubListing(compact);
    expect(parsed.rows[0]?.name).toBe("Marbury West");
    expect(parsed.rows[0]?.city).toBe("Temple City");
  });
});

/**
 * A COLUMN LABEL WRAPPED ONTO THE LINE ABOVE OR BELOW ITS OWN HEADING.
 *
 * ── THE DEFECT, AND WHY IT WAS NOT WHERE THE FILE SAID IT WAS ──
 *
 * Three of the 20 real bidder lists print the licence column's label across three
 * physical lines — the word `License` on the line above, the `#:` on the line
 * below, and nothing at all on the heading line between them:
 *
 *        Sub Contractor Listing                              License
 *             Portion of Work: Name of Business:   Location:            DIR #:
 *                                                           #:
 *
 * The heading line therefore names four columns while the rows beneath it are
 * ordinary five-column rows, no plan matches, and `readRow` falls back to a
 * positional read that has no city slot at all. Those rows came back `city: null`
 * with nothing said about it.
 *
 * Earlier notes in this file and in `parse.ts` put the blame on heading DETECTION —
 * that these lines "are not recognised as headings in the first place". They are,
 * on 20 of 20 lists. The heading was always found; what could not be built from it
 * was the plan.
 *
 * ── WHAT THE FIX READS, AND WHAT IT REFUSES TO INVENT ──
 *
 * `planByLabels` in `parse.ts` declined to insert a fifth column on the grounds
 * that "inserting a column where a label is missing is inventing the order rather
 * than reading it". That is right, and the label is not missing: it is PRINTED, at
 * the same character offset as the column it belongs to, one line away. So a
 * fragment's tokens are joined to the heading column whose horizontal span they
 * overlap, and a token overlapping nothing becomes a column at its own offset —
 * which is exactly what `License`, sitting in the gap between `Location:` and
 * `DIR #:`, is. Every position comes off the page.
 *
 * ── MEASURED, ON THE REAL CORPUS, BEFORE AND AFTER ──
 *
 * | | rows | names | cities | scopes |
 * | --- | --- | --- | --- | --- |
 * | before | 157 | 157 | 131 | 151 |
 * | after | 157 | 157 | **143** | 151 |
 *
 * The 12 cities are 5 on one list and 7 on another, and every one was checked
 * against the document it came from. Nothing else moved: row for row, the parse is
 * identical apart from those twelve and one name/scope swap that the now-complete
 * plan also corrects. No row lost a field it had.
 *
 * ── NO REAL COMPANY, LICENCE OR REGISTRATION APPEARS BELOW ──
 *
 * Same rule as the rest of this directory. A real award packet names real
 * subcontractors who did not agree to be test data, so every fixture here is
 * synthesised: the LAYOUT is copied from the real documents to the character,
 * which is the part under test, and the CONTENT is invented.
 */
describe("a column label wrapped onto the line above or below its own heading", () => {
  /**
   * The corpus shape, laid out at the offsets the real lists use: the scope at 0,
   * the company at 24, the place at 56, the licence at 72 and the registration at
   * 88. `License` and `#:` both sit at 72, in the gap the heading line leaves
   * between `Location:` (ending at 65) and `DIR #:` (starting at 88).
   */
  const LICENCE_ABOVE = `Sub Contractor Listing                                                  License
Portion of Work:        Name of Business:               Location:                       DIR #:
                                                                        #:
Metal Stud Framing      Example Wallworks Inc           Fairview        884201          1000447788
Lath and Plaster        Crestline Lathing Co            Fort Hollow     448120          1000889922`;

  /**
   * A DIFFERENT LABEL, WRAPPED THE OTHER WAY UP, so that nothing here can pass by
   * knowing the word "License".
   *
   * `Place of Business` is one of the place column's own labels, and split across
   * two lines neither half reads as a place: `Place of` matches no column kind at
   * all, and `Business:` on its own matches the NAME column. So the heading line
   * names four columns and the one it cannot name is the city — the same shape as
   * the licence case, reached through a completely different label, and with the
   * fragment BELOW the heading rather than above it.
   *
   * This fixture also pins the part of the fix that is easiest to get wrong: the
   * heading line here yields FIVE fields, so the unjoined plan already matched
   * these rows by width and simply did not know what its third column was. A fix
   * that only offered the joined plan to rows nothing else fitted would leave this
   * one reading `city: null`. Measured: it did, until the plan that names more of
   * its own columns was preferred at equal width.
   */
  const CITY_WRAPPED = `Portion of Work:        Name of Business:               Place of        License #:      DIR #:
                                                        Business:
Metal Stud Framing      Example Wallworks Inc           Fairview        884201          1000447788
Lath and Plaster        Crestline Lathing Co            Fort Hollow     448120          1000889922`;

  /** A heading that names all five columns on one line, with a row directly beneath it. */
  const COMPLETE = `Portion of Work:        Name of Business:               Location:       License #:      DIR #:
Metal Stud Framing      Example Wallworks Inc           Fairview        884201          1000447788
Lath and Plaster        Crestline Lathing Co            Fort Hollow     448120          1000889922`;

  /**
   * BOTH DEFECTS AT ONCE, which is what one real list actually prints: the scope
   * and company labels share a field (single-spaced) AND the licence label is
   * wrapped. The second row has no place cell — its city wrapped onto a line of its
   * own in the source — so it is a FOUR-field row under a five-column heading.
   *
   * This is the regression fixture for the whole block. Joining the wrapped label
   * makes the heading's field split four wide, because `Portion of Work: Name of
   * Business:` is one field — and a four-wide plan matches this second row by count
   * while being one slot out. Measured, when the joined field plan was allowed to
   * win that match, it read the scope as the company, the company as the city and a
   * licence number into the city slot.
   */
  const COMPACT_AND_WRAPPED = `Sub Contractor Listing                                                  License
Portion of Work: Name of Business:                      Location:                       DIR #:
                                                                        #:
Metal Stud Framing      Example Wallworks Inc           Fairview        884201          1000447788
Lath and Plaster        Crestline Lathing Co                            448120          1000889922`;

  it("reads the place column the heading only half prints on its own line", () => {
    const parsed = parseSubListing(LICENCE_ABOVE);
    expect(parsed.rows.map((row) => [row.portionOfWork, row.name, row.city])).toEqual([
      ["Metal Stud Framing", "Example Wallworks Inc", "Fairview"],
      ["Lath and Plaster", "Crestline Lathing Co", "Fort Hollow"],
    ]);
  });

  /**
   * And it stops SAYING the columns could not be matched, because they now can.
   * Asserted separately from the reads above: the warning and the data are two
   * different promises, and a fix that quietly keeps warning about a page it has
   * read correctly teaches an owner to ignore the warning.
   */
  it("stops warning that the columns could not be matched to the rows", () => {
    expect(parseSubListing(LICENCE_ABOVE).problems.join(" ")).not.toMatch(
      /could not be matched to the rows/,
    );
    expect(parseSubListing(LICENCE_ABOVE).rows.every((row) => row.concerns.length === 0)).toBe(true);
  });

  it("joins a label wrapped DOWNWARD, and one that is not the licence", () => {
    const parsed = parseSubListing(CITY_WRAPPED);
    expect(parsed.rows.map((row) => row.city)).toEqual(["Fairview", "Fort Hollow"]);
    expect(parsed.rows.map((row) => row.name)).toEqual([
      "Example Wallworks Inc",
      "Crestline Lathing Co",
    ]);
  });

  /**
   * THE CONTROL, and it is the gate the whole join rests on: the line next to a
   * heading is normally the table's FIRST ROW. Joining one in would wreck a plan
   * that was already working, so a join is kept only when it names strictly MORE
   * columns than the heading line did alone — which a row's cells cannot do.
   *
   * Asserted as an equality against the same rows read from a heading with nothing
   * adjacent to join, rather than as a list of expected values, so that it cannot
   * drift into agreeing with whatever the parser happens to return.
   */
  it("does not join the first data row into the heading above it", () => {
    const parsed = parseSubListing(COMPLETE);
    const alone = parseSubListing(`${COMPLETE.split("\n")[0]}\n\n${COMPLETE.split("\n").slice(1).join("\n")}`);
    const shape = (text: string) =>
      parseSubListing(text).rows.map((row) => [
        row.portionOfWork,
        row.name,
        row.city,
        row.licence,
        row.registration,
      ]);
    expect(shape(COMPLETE)).toEqual(shape(`${COMPLETE.split("\n")[0]}\n\n${COMPLETE.split("\n").slice(1).join("\n")}`));
    expect(parsed.rows.map((row) => row.name)).toEqual(alone.rows.map((row) => row.name));
    expect(parsed.rows[0]?.city).toBe("Fairview");
  });

  it("reads the complete rows of a heading that is BOTH compact and wrapped", () => {
    const parsed = parseSubListing(COMPACT_AND_WRAPPED);
    expect(parsed.rows[0]?.portionOfWork).toBe("Metal Stud Framing");
    expect(parsed.rows[0]?.name).toBe("Example Wallworks Inc");
    expect(parsed.rows[0]?.city).toBe("Fairview");
  });

  /**
   * And the row a column short keeps the honest read it already had. Not an
   * assertion that it is PERFECT — its city is genuinely not on the line, so null
   * is the right answer — but that nothing was moved into the wrong slot and that
   * the row says the heading did not line up.
   */
  it("does not shift the narrower row of the same list into the wrong columns", () => {
    const parsed = parseSubListing(COMPACT_AND_WRAPPED);
    const narrow = parsed.rows[1];
    expect(narrow?.name).toBe("Crestline Lathing Co");
    expect(narrow?.portionOfWork).toBe("Lath and Plaster");
    expect(narrow?.city).toBeNull();
    expect(narrow?.licence).toBe("448120");
    expect(narrow?.concerns.join(" ")).toMatch(/do not line up with this row/);
  });

  /**
   * ── THE FOUR CONDITIONS THAT KEEP A ROW OUT OF THE HEADING, ONE TEST EACH ──
   *
   * Every test below is a MUTATION DEFENCE and names the measured alternative, not
   * because four conditions deserve four tests on principle but because all four
   * were written first and then found to be live only by breaking them. The gate
   * clauses survived every mutation against the real corpus and against the four
   * fixtures above — the corpus simply has no adversarial list in it — so each case
   * here is the narrowest input that distinguishes ONE condition from the three
   * beside it. Without them this would be four conditions nothing defends, which is
   * the shape CLAUDE.md names as written-documented-and-never-called.
   *
   * No fixture below is a shape anybody has seen on a real document. They are
   * constructions, and that is what they are for: the question "what does the join
   * do when handed something that is not a wrapped label" has a definite answer
   * whether or not an agency ever prints one.
   */

  /**
   * A LINE AS WIDE AS THE HEADING IS A ROW, WHATEVER IT CONTAINS — and this one
   * contains nothing that says so. No licence number, no registration, no entity
   * suffix, no "City, ST": a draft listing with `pending` where the identifiers go.
   * So only its WIDTH gives it away, which is why the join requires a fragment to
   * be narrower than the heading — the same "an overflow must be narrower" rule the
   * wrapped-row continuation branch above rests on.
   *
   * Measured without that condition: the line is joined, the word `License` inside
   * `Pacific License Works` names a licence column at the NAME column's offset, and
   * the resulting five-wide plan reads the licence cell as the place —
   * `city: "pending"`. An invented geography on a GC-facing claim, from a cell that
   * is not a place and does not contain one.
   */
  const AS_WIDE_AS_THE_HEADING = `Portion of Work:        Name of Business:               Location:                       DIR #:
Striping                Pacific License Works           San Marcos      pending         pending
Paint Striping          Baldwin Paving Inc              Fort Hollow     448120          1000889922`;

  it("refuses a line as wide as the heading, even with no identifier on it", () => {
    const parsed = parseSubListing(AS_WIDE_AS_THE_HEADING);
    // Both null is the honest answer here: this heading has no licence column, so
    // its five-field rows match no plan and a bare city has no pattern to rescue it.
    // The point is the value that must NOT appear.
    expect(parsed.rows.map((row) => row.city)).toEqual([null, null]);
    expect(parsed.rows.map((row) => row.city)).not.toContain("pending");
  });

  /**
   * A ROW NARROWER THAN THE HEADING IS STILL A ROW, and width can no longer tell.
   * This one lost its `Area` cell to a wrap, so it is four fields under a five-field
   * heading — and it carries a registration number, which is what gives it away.
   *
   * Measured without the data-evidence test: `Pacific License Co` is joined into the
   * name column, so the heading is read as naming a licence column THERE, the plan
   * comes out `scope, name, licence, city, registration` — licence and place
   * swapped — and the complete row beneath loses its correct city and gains a
   * concern saying the columns did not line up. A row's own contents are not a
   * column label.
   */
  const NARROWER_ROW_WITH_A_LABEL_WORD = `Portion of Work:        Name of Business:               Location:       Area:           DIR #:
Striping                Pacific License Co              San Marcos                      1000447788
Paint Striping          Baldwin Paving Inc              Fort Hollow     448120          1000889922`;

  it("refuses a narrower row that carries an identifier", () => {
    const parsed = parseSubListing(NARROWER_ROW_WITH_A_LABEL_WORD);
    expect(parsed.rows[1]?.city).toBe("Fort Hollow");
    expect(parsed.rows[1]?.name).toBe("Baldwin Paving Inc");
    expect(parsed.rows[1]?.concerns).toEqual([]);
  });

  /**
   * AND THE SAME ROW WITH NO IDENTIFIER AT ALL — the sole-proprietor row this
   * directory keeps losing, with no licence, no registration and no entity suffix.
   * The data-evidence test cannot see it. What gives it away is that its first cell
   * NAMES ONE OF OUR FIVE TRADES, which is the same evidence `furnitureReason` uses
   * to tell a heading from a row: a heading says what a column IS, a cell says what
   * the work is, and no column was ever headed "Acoustical Ceiling".
   *
   * Measured without the trade test: the identical damage as above — the complete
   * row below loses "Fort Hollow" and gains a concern.
   */
  const NARROWER_ROW_NAMING_A_TRADE = `Portion of Work:        Name of Business:               Location:       Area:           DIR #:
Acoustical Ceiling      Finest License Works            San Marcos
Paint Striping          Baldwin Paving Inc              Fort Hollow     448120          1000889922`;

  it("refuses a narrower row with no identifier, because it names a trade", () => {
    const parsed = parseSubListing(NARROWER_ROW_NAMING_A_TRADE);
    expect(parsed.rows[1]?.city).toBe("Fort Hollow");
    expect(parsed.rows[1]?.name).toBe("Baldwin Paving Inc");
    expect(parsed.rows[1]?.concerns).toEqual([]);
  });

  /**
   * AND THE CONDITION THAT IS NOT ABOUT ROWS AT ALL: a fragment can be a perfectly
   * innocent piece of furniture and still ruin the plan by being joined.
   *
   * `Notes` above the table names no column this parser knows. Joined, it lands in
   * the gap between the place and the licence as a column of its OWN — so the plan
   * grows to six while still naming only five, and a six-field row now matches it.
   * The row here is six fields for a reason that has nothing to do with any Notes
   * column: `Metal  Stud Framing` is double-spaced, so the scope cell splits in two.
   *
   * Measured without the improvement gate: the row reads `name: "Stud Framing"` —
   * half a trade, as a company, written into `SalesLead.companyName` — instead of
   * falling back to the predicate, which prefers the entity marker and gets
   * `Baldwin Paving Inc` right. The gate is the defect stated as a measurement: a
   * wrapped heading names FEWER columns than its table has, so a join that names no
   * more than the line did alone has taught nothing and is discarded.
   */
  const PHANTOM_COLUMN = `                                                                    Notes
Portion of Work:        Name of Business:               Location:               License #:      DIR #:
Metal  Stud Framing     Baldwin Paving Inc              Fort Hollow             884201          1000447788`;

  it("discards a join that names no more columns than the heading line did", () => {
    const parsed = parseSubListing(PHANTOM_COLUMN);
    expect(parsed.rows[0]?.name).toBe("Baldwin Paving Inc");
    expect(parsed.rows[0]?.name).not.toBe("Stud Framing");
  });

  /**
   * THE PARTITION STILL HOLDS ON EVERY SHAPE ABOVE, which is this file's standing
   * check that nothing was invented: every non-blank line is either a row, a header
   * line, ignored under a named reason, or unread. A join that swallowed a line
   * without accounting for it would show up here and nowhere else — the join reads
   * adjacent lines but must not consume them, and each of these fragments is still
   * filed under its own reason.
   */
  it("accounts for every line of every shape above, fragments included", () => {
    for (const text of [LICENCE_ABOVE, CITY_WRAPPED, COMPLETE, COMPACT_AND_WRAPPED]) {
      const parsed = parseSubListing(text);
      const { nonBlankLines, rowsParsed, headerLines, ignoredLines, unreadLines } =
        parsed.reconciliation;
      expect(rowsParsed + headerLines + ignoredLines + unreadLines).toBe(nonBlankLines);
      expect(parsed.ignored.every((line) => line.why.length > 0)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * THE THIRD FORM SHAPE: NUMBERED BOXES, ONE SUBCONTRACTOR PER BLOCK.
 *
 * SF Public Works publishes its Proposed Subcontractor List as SECTION 00 43 36.
 * An overnight source survey recommended it as the FIRST source a scheduled
 * fetcher should walk, and called its shape "already supported" because this file
 * already refuses something called `numbered-blocks`.
 *
 * **BOTH HALVES OF THAT WERE WRONG, AND THE SECOND HALF IS THE DANGEROUS ONE.**
 * The suspicion was that SF would trip the Caltrans refusal and yield nothing. It
 * did not trip it: Caltrans writes `1)` and carries `DES-OE-0102`, SF writes `1.`
 * and carries no revision id, and every SF label is prefixed with its own box
 * number so none of them leads a `BC_FAMILIES` line either. The document fell
 * through into `readRow` and produced **412 rows for 7 subcontractors, none of
 * them a subcontractor** — the commonest names were "Lower Tier;",
 * "12. IF LBE, CHECK" and "Proposed Subcontractors Form". Measured on the real
 * 60-page file, not argued.
 *
 * So the risk was never zero rows. It was 412 undeletable leads from the source
 * somebody was about to point a scheduler at.
 *
 * **WHY THE COUNT IS SEVEN, ON THREE SIGNALS THAT SHARE NO CODE WITH THE PARSER.**
 * 43 of 60 pages are the blank template — the form says "Copy this page as needed"
 * — so the document holds 167 complete sets of labels. Distinct email addresses: 7.
 * Distinct telephone numbers: 7. Blocks with a filled box 2: 7. A block is
 * therefore recognised by a FILLED FIELD and never by the presence of a label,
 * which is the whole defence and is what every fixture below is built to break.
 *
 * **THE FIXTURE IS LAYOUT ONLY.** Every company name, licence, DIR registration,
 * email, telephone number, address and dollar figure below is synthesised. The
 * real packet names real subcontractors who did not agree to be test data; what is
 * copied is the geometry — which box sits at which column, which values are inline
 * beside their label and which are on the line beneath, and where the blank
 * templates fall. Columns are faithful to the character: box one at 0, the second
 * box of a row at 40, the third at 89, and the value of each inside its own span.
 * ------------------------------------------------------------------------- */
describe("the THIRD form: numbered boxes, one subcontractor per block", () => {
  /**
   * Five filled blocks and four blank templates, interleaved with the real page
   * furniture. Each filled block carries one hazard measured in the real document:
   *
   *   | block | the hazard it reproduces |
   *   | --- | --- |
   *   | Vantage Wall Systems | licence printed INLINE on its own label line; a `PW-LR-` prefixed DIR; box 10 empty |
   *   | Crestline Plastering & Lath | licence BENEATH box 8 with the tax registration beneath box 9; the amount split into a bare `$` and a figure four columns away |
   *   | Harrow Trucking | **box 8 EMPTY and box 9 FILLED** — the only value under the licence row is not a licence |
   *   | Meridian Ceiling Systems | a company name that came out of the PDF as TWO runs on one line |
   *   | Penlow Firestopping | **box 5 EMPTY and box 6 FILLED** — the only value under the registration row is not a registration |
   */
  const SF = `Fairhaven Plaza Improvement Project (Rebid)                                   Sourcing Event ID: 00000099999


   Copy this page as needed to provide a complete listing.                                           Page _____ of _____
1. TYPE OF SUBCONTRACTOR:
                                      X First Tier;          Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL
                              Vantage Wall Systems                                               bids@vantagewall.test
3. ADDRESS                                                                               PHONE NO.
                 140 Quarry Mill Road, Riverbend, CA, 90001                                       415-555-0100
4. BID ITEMS/PORTION OF WORK
                                  Metal Stud Framing and Drywall
5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.
     PW-LR-1000000011                                    0000000071                                          00-0000001
8. LICENSE NO. 900001                   9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                  0300001                   CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL

3. ADDRESS                                                                               PHONE NO.

4. BID ITEMS/PORTION OF WORK

5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.

8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                                            CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

  * MBE = Minority Business Enterprise, WBE = Women Business Enterprise, OBE = Other Business Enterprise.

                                                        00 43 36 - 3                 Proposed Subcontractors Form
Fairhaven Plaza Improvement Project (Rebid)                                   Sourcing Event ID: 00000099999

   Copy this page as needed to provide a complete listing.                                           Page _____ of _____
1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL
                          Crestline Plastering & Lath                                            estimating@crestlinelath.test
3. ADDRESS                                                                               PHONE NO.
             22 Harbour Street, Suite 800, Fort Hollow, CA 90002                                  415-555-0101
4. BID ITEMS/PORTION OF WORK
                                                              Lath and Cement Plaster
5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.
                 1000000022                          0000000072                                              00-0000002
8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                          900002                                  0300002                   CONTRACT WORK:
                                                                                                                    $   2,481,350.00
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL
                          Harrow Trucking                                                        dispatch@harrowtrucking.test
3. ADDRESS                                                                               PHONE NO.
             7 Tanner Lane, Riverbend, CA 90001                                                   415-555-0102
4. BID ITEMS/PORTION OF WORK
                               Trucking
5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.
                 1000000033                                                                                  00-0000003
8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                          0300003           CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL

3. ADDRESS                                                                               PHONE NO.

4. BID ITEMS/PORTION OF WORK

5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.

8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                                            CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL

3. ADDRESS                                                                               PHONE NO.

4. BID ITEMS/PORTION OF WORK

5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.

8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                                            CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL
                             Meridian                Ceiling Systems                             office@meridianceilings.test
3. ADDRESS                                                                               PHONE NO.
                 305 Falls Avenue, Lakeview, CA 90003                                             415-555-0103
4. BID ITEMS/PORTION OF WORK
                                  Acoustical Ceilings
5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.
                 1000000044                                                                                  00-0000004
8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                          900004                                  0300004                   CONTRACT WORK:       $ 37,500.00
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL
                          Penlow Firestopping                                                    bids@penlowfirestop.test
3. ADDRESS                                                                               PHONE NO.
                  88 Quarry Road, Fort Hollow, CA 90002                                           415-555-0104
4. BID ITEMS/PORTION OF WORK
                               Firestopping
5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.
                                                     0000000075                                              00-0000005
8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                      900005                                                                CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL

3. ADDRESS                                                                               PHONE NO.

4. BID ITEMS/PORTION OF WORK

5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.

8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                                            CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

  * MBE = Minority Business Enterprise, WBE = Women Business Enterprise, OBE = Other Business Enterprise.

                                                        00 43 36 - 3                 Proposed Subcontractors Form`;

  /**
   * THE SAME FORM WITH NOTHING FILLED IN — which is 43 of the real 60 pages, and
   * the shape that turned into 160 of the 167 blocks a naive split returns.
   *
   * Written out in full rather than derived from `SF` by splitting it: a derived
   * fixture is a set whose size nobody asserted, and the first version of this
   * sliced two chunks off `SF` and silently kept half of a FILLED block, so the
   * test it feeds went red naming a row that should not have been in the input.
   * CLAUDE.md's rule about a check that derives its own input, arriving in the
   * fixture rather than in the guard.
   */
  const SF_BLANK = `Fairhaven Plaza Improvement Project (Rebid)                                   Sourcing Event ID: 00000099999


   Copy this page as needed to provide a complete listing.                                           Page _____ of _____
1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL

3. ADDRESS                                                                               PHONE NO.

4. BID ITEMS/PORTION OF WORK

5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.

8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                                            CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

1. TYPE OF SUBCONTRACTOR:
                                      First Tier;            Lower Tier;   Supplier;    Service Contractor (e.g. Trucker)
2. SUBCONTRACTOR NAME                                                                    EMAIL

3. ADDRESS                                                                               PHONE NO.

4. BID ITEMS/PORTION OF WORK

5. DIR REGISTRATION NO.                 6. SUPPLIER ID                                   7. FEDERAL ID NO.

8. LICENSE NO.                          9. SF BUSINESS TAX REG. NO.                      10. AMOUNT OF SUB-
                                                                                            CONTRACT WORK:       $
11. CERTIFIED                           12. IF LBE, CHECK
                    Yes;      No                              Small LBE;    Micro LBE;        SBA-LBE
    LBE?                                   APPLICABLE:

  * MBE = Minority Business Enterprise, WBE = Women Business Enterprise, OBE = Other Business Enterprise.`;

  const rowNamed = (name: string) => {
    const parsed = parseSubListing(SF);
    return parsed.rows.find((row) => row.name === name)!;
  };

  /**
   * THE SIZE OF THE SET BEFORE ANYTHING IS READ OUT OF IT. Every test below looks
   * up a row by name, so a reader that returned four rows instead of five would
   * make four of them pass and throw a TypeError in the fifth, which reads as the
   * parser breaking rather than as a row going missing.
   */
  it("reads exactly the five filled blocks, and names them", () => {
    const parsed = parseSubListing(SF);
    expect(parsed.rows.map((row) => row.name)).toEqual([
      "Vantage Wall Systems",
      "Crestline Plastering & Lath",
      "Harrow Trucking",
      "Meridian Ceiling Systems",
      "Penlow Firestopping",
    ]);
  });

  /**
   * THE 24-FOLD INFLATION, AND THE ONLY CLAUSE THAT STOPS IT. Break the filled-box
   * test — count a block wherever `2. SUBCONTRACTOR NAME` appears — and this goes
   * from five to nine on a nine-block fixture, and from 7 to 167 on the real file.
   */
  it("counts a block by a FILLED name box, not by the label being present", () => {
    const parsed = parseSubListing(SF);
    const labels = SF.split("\n").filter((line) =>
      line.startsWith("2. SUBCONTRACTOR NAME"),
    ).length;
    expect(labels).toBe(9);
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.problems.join(" ")).toMatch(/4 blank copies of the form were skipped/);
  });

  it("says so, and invents nothing, when every block on the page is the blank template", () => {
    const parsed = parseSubListing(SF_BLANK);
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems.join(" ")).toMatch(/not one filled block was found/);
    expect(parsed.reconciliation.agreed).toBe(false);
  });

  /**
   * THE CLAUSE THAT KEEPS A TAX REGISTRATION OUT OF THE LICENCE FIELD, and the
   * reason this reader assigns by COLUMN SPAN rather than by nearest value.
   *
   * One real block has box 8 empty and box 9 filled, so the single value on the
   * line under `8. LICENSE NO.` is the SF business tax registration. A
   * nearest-value or first-number-after-the-label reader claims it as a contractor
   * licence — a wrong public identifier on a lead, which is worse than none
   * because it joins to somebody else's CSLB record.
   */
  it("leaves the licence NULL when box 8 is empty and box 9 is not", () => {
    expect(rowNamed("Harrow Trucking").licence).toBeNull();
    expect(rowNamed("Harrow Trucking").registration).toBe("1000000033");
  });

  /** The same clause one row up: box 5 empty, box 6 filled, DIR must stay null. */
  it("leaves the DIR registration NULL when box 5 is empty and box 6 is not", () => {
    expect(rowNamed("Penlow Firestopping").registration).toBeNull();
    expect(rowNamed("Penlow Firestopping").licence).toBe("900005");
  });

  /**
   * One real block prints `8. LICENSE NO. 900001` — label and value run together on
   * one field, because a single space separates them and a field only breaks on
   * two. Reading the label without consuming it loses the licence; reading the
   * field as a value loses every other box.
   */
  it("reads a licence printed INLINE on its own label line", () => {
    expect(rowNamed("Vantage Wall Systems").licence).toBe("900001");
  });

  /** And the ordinary case, where it is on the line beneath its own label. */
  it("reads a licence printed BENEATH its label, with the tax registration beside it", () => {
    expect(rowNamed("Crestline Plastering & Lath").licence).toBe("900002");
  });

  /**
   * A real company name arrived as two runs on one line — the form's box is wider
   * than the text and the extractor broke it at the gap. Taking the first value
   * ships half a company name; the values that landed in THIS span are joined, and
   * the span is what keeps the email on the same line out of it.
   */
  it("reconstructs a company name that arrived as two runs on one line", () => {
    expect(rowNamed("Meridian Ceiling Systems").name).toBe("Meridian Ceiling Systems");
  });

  /**
   * THE EXTRA FIELDS ARE THE REASON THIS SOURCE WAS RECOMMENDED. The CSLB licence
   * file carries no email at all and automated dialling is not an option, so an
   * email printed on the award document is the only automatable contact channel
   * found anywhere in the survey. `EMAIL` and `PHONE NO.` carry no box number, so
   * they are recognised only on a line that already has one — without that, box 2's
   * span runs to the end of the line and the email is read as part of the name.
   */
  it("keeps the email out of the company name and reads it as the email", () => {
    for (const row of parseSubListing(SF).rows) {
      expect(row.name).not.toMatch(/@/);
      expect(row.email).toMatch(/^[^\s@]+@[^\s@]+$/);
    }
    expect(rowNamed("Meridian Ceiling Systems").email).toBe("office@meridianceilings.test");
  });

  it("reads the telephone number out of box 3 without taking the address with it", () => {
    expect(rowNamed("Harrow Trucking").phone).toBe("415-555-0102");
    expect(rowNamed("Harrow Trucking").city).toBe("Riverbend");
  });

  /**
   * There is no city BOX on this form — box 3 is one free-text postal address — so
   * the city is read out of it, and the two postcode spellings in the one real
   * document are both here: `Riverbend, CA, 90001` and `Fort Hollow, CA 90002`.
   * The suite number in Crestline's address is the control: a comma group holding
   * digits must not be mistaken for the city.
   */
  it("reads the city out of the one-line address, in both postcode spellings", () => {
    expect(rowNamed("Vantage Wall Systems").city).toBe("Riverbend");
    expect(rowNamed("Crestline Plastering & Lath").city).toBe("Fort Hollow");
    expect(rowNamed("Meridian Ceiling Systems").city).toBe("Lakeview");
  });

  /**
   * THE OBJECTION THAT KEPT `Amount of Subcontract` UNREAD IN THE OTHER FORM, AND
   * WHY IT DOES NOT APPLY HERE — ESTABLISHED BY MEASUREMENT, NOT BY THE ARGUMENT.
   *
   * `readLabelledColumnsForm` refuses the amount because in that shape the figures
   * sit on their own offset grid beside up to six bidders' columns, so
   * nearest-column attribution hangs bidder one's figure on bidder two's
   * subcontractor. Here box 10 is inside the same block as box 2, bounded by the
   * next block's own box 1.
   *
   * This asserts both directions, because only the second one can fail: that the
   * two figures land on their own rows, AND that the three blocks whose box 10 is
   * empty read null rather than inheriting a neighbour's. The second is what a
   * leaking block boundary would break, and it is the one that would ship a wrong
   * dollar figure on a GC-facing claim.
   */
  it("attributes each subcontract amount to its own block, and claims none where box 10 is empty", () => {
    expect(parseSubListing(SF).rows.map((row) => row.amount)).toEqual([
      null,
      2481350,
      null,
      37500,
      null,
    ]);
  });

  /**
   * Box 10's label wraps mid-word, so the string `CONTRACT WORK:` sits in its span
   * on the value line of EVERY block, and a bare `$` sits there on every block
   * whose amount was left out. Reading the span's first value makes the label the
   * amount; reading its last makes a currency symbol one.
   */
  it("does not turn box 10's own wrapped label or a bare currency symbol into an amount", () => {
    expect(SF).toMatch(/CONTRACT WORK:/);
    expect(rowNamed("Vantage Wall Systems").amount).toBeNull();
    expect(rowNamed("Harrow Trucking").amount).toBeNull();
  });

  /**
   * The real form carries one DIR registration written `PW-LR-` plus ten digits.
   * Claimed with the oddity named rather than dropped: a person confirms every
   * signal this writes, and `null` tells them nothing while the printed string
   * tells them what to look at. The same call the other reader makes.
   */
  it("claims a prefixed DIR registration and names the oddity instead of dropping it", () => {
    const row = rowNamed("Vantage Wall Systems");
    expect(row.registration).toBe("PW-LR-1000000011");
    expect(row.concerns.join(" ")).toMatch(/not the ten bare digits/);
  });

  /**
   * THE FIELD THIS SOURCE DOES NOT CARRY, which matters more than any it does: the
   * GC relationship is the whole pitch, and the form's firm-name line is a
   * signature block that is EMPTY in the text layer of all three bidders'
   * submittals in the real packet.
   */
  it("never names a prime, because the form does not print one", () => {
    const parsed = parseSubListing(SF);
    expect(parsed.header.prime).toBeNull();
    expect(parsed.rows.every((row) => row.listedBy === null)).toBe(true);
    expect(parsed.problems.join(" ")).toMatch(/WITHOUT SAYING WHICH BIDDER LISTED WHOM/);
  });

  /**
   * THE EVIDENCE A ROW QUOTES MUST BE THE ROW'S OWN BLOCK.
   *
   * `sourceText` is what a person reads back against the document before believing
   * the row, so a quotation running on into the NEXT subcontractor's first two
   * lines is worse than a short one: it shows them text that belongs to somebody
   * else. Blocks open on box 2 and CLOSE on the next box 1 for this reason alone —
   * nothing else in the read depends on the close, which is why it needs its own
   * assertion.
   */
  it("quotes only its own block as the row's evidence", () => {
    for (const row of parseSubListing(SF).rows) {
      expect(row.sourceText).toMatch(/^2\. SUBCONTRACTOR NAME/);
      expect(row.sourceText).not.toMatch(/1\. TYPE OF SUBCONTRACTOR/);
      /**
       * The EMAIL rather than the name, because one of these names is joined out of
       * two runs and so appears in the row and not in the document. The first
       * version of this assertion used the name and went red on exactly that row —
       * a harness failure, not a defect, and it is left documented here because the
       * next person to tighten this test will reach for the name too.
       */
      expect(row.sourceText).toContain(row.email);
    }
  });

  /**
   * The partition, which is this file's standing check that nothing was invented.
   * Reported the same way the labelled-column reader reports it and for the same
   * structural reason: one subcontractor is assembled from thirteen lines, so
   * `rowsParsed` and `nonBlankLines` are not comparable and `agreed` is false
   * rather than claiming a completeness it cannot compute.
   */
  it("accounts for every non-blank line, and refuses to call the counts a partition", () => {
    const parsed = parseSubListing(SF);
    expect(parsed.reconciliation.accountedFor).toBe(parsed.reconciliation.nonBlankLines);
    expect(parsed.ignored.every((line) => line.why.length > 0)).toBe(true);
    expect(parsed.unread).toEqual([]);
    expect(parsed.reconciliation.agreed).toBe(false);
  });

  /**
   * MANDATORY CONTROL: THE CALTRANS REFUSAL IS UNTOUCHED.
   *
   * That refusal exists because reading its form produced 228 rows for three
   * subcontractors while reporting agreement. A reader added for a different
   * publisher's numbered form must not be able to reach it — so this asserts the
   * Caltrans shape still returns nothing and still names itself a form.
   *
   * Honest about what this control does and does not prove: the two shapes are
   * DISJOINT, so it would pass whichever detector ran first. It is a regression pin
   * on the refusal, not evidence that the ordering in `formShapedListing` is
   * load-bearing — see the mutation note in that function.
   */
  it("still refuses the Caltrans numbered-block form", () => {
    const caltrans = `STATE OF CALIFORNIA - DEPARTMENT OF TRANSPORTATION
SUBCONTRACTOR LIST
DES-OE-0102.2C(REV 04/2025)

1) List this subcontractor?        YES      NO
     Business Name VANTAGE WALL SYSTEMS    Location City RIVERBEND  State CA
       California Contractor License Number          900001
     Portion of Work Subcontracted
   1      50.00%     METAL STUD FRAMING`;
    const parsed = parseSubListing(caltrans);
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems.join(" ")).toMatch(/looks like a filled subcontractor FORM/);
    expect(parsed.reconciliation.accountedFor).toBe(parsed.reconciliation.nonBlankLines);
  });

  /**
   * CONTROL: THE BOX NUMBER IS THE DISCRIMINATOR, NOT THE WORDS.
   *
   * A column table may perfectly well head its columns with these exact labels, and
   * the two entries above this one in `parse.ts` both exist because keying a
   * refusal on label WORDS would swallow tables this parser reads at 20 of 20. So
   * this table uses SUBCONTRACTOR NAME, ADDRESS, LICENSE NO. and DIR REGISTRATION
   * NO. as a heading row and must still be read as a table.
   */
  it("does NOT divert a column table whose headings use the same words without box numbers", () => {
    const table = `SUBCONTRACTOR NAME         ADDRESS          LICENSE NO.   DIR REGISTRATION NO.
Vantage Wall Systems       Riverbend        900001        1000000011
Crestline Plastering       Fort Hollow      900002        1000000022`;
    const parsed = parseSubListing(table);
    expect(parsed.problems.join(" ")).not.toMatch(/blank copies of the form/);
    expect(parsed.rows.map((row) => row.name)).toEqual([
      "Vantage Wall Systems",
      "Crestline Plastering",
    ]);
  });

  /**
   * CONTROL: THE FOUR-FAMILY THRESHOLD, AND THE DISTINGUISHING CASE TOOK THREE
   * TRIES TO FIND.
   *
   * Lowering the threshold to one family survived every other test in this file,
   * because across 64 documents — the 20 real bidder lists and every fixture in
   * this directory — not one scores even a single numbered-box family, so no input
   * in hand could tell four from one. The obvious candidates each proved nothing:
   * `1. ADDRESS verification` does not match `^address$` and scores zero, and a
   * numbered list with no name box fails the name clause whatever the threshold is.
   *
   * What distinguishes them is a table that MENTIONS a box label once, in prose, in
   * a line's leading field — a footnote under a perfectly ordinary column table,
   * which is a real thing for a bid package to print. That scores the name family
   * exactly once and nothing else, so a one-family threshold diverts a table this
   * parser reads at 20 of 20 and returns nothing from it.
   */
  it("does NOT divert a column table that merely MENTIONS a box label in a footnote", () => {
    const table = `Portion of Work:          Name of Business:        City:          License #:
Metal Stud Framing        Vantage Wall Systems     Riverbend      900001
Lath and Cement Plaster   Crestline Plastering     Fort Hollow    900002
Notes
2. SUBCONTRACTOR NAME must match the licence record exactly.`;
    const parsed = parseSubListing(table);
    expect(parsed.problems.join(" ")).not.toMatch(/blank copies of the form/);
    expect(parsed.problems.join(" ")).not.toMatch(/not one filled block was found/);
    expect(parsed.rows.map((row) => row.name)).toEqual([
      "Vantage Wall Systems",
      "Crestline Plastering",
    ]);
  });
});

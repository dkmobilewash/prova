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
   * **MEASURED LIMIT, recorded so nobody reads more into this than it does.** This
   * fires on the shape above but on NONE of the four real wrapped or compact lists,
   * because their heading lines are not recognised as headings in the first place —
   * so neither the plan nor this warning reaches them, and 23 of 154 rows still
   * read `city: null` without a word said. Fixing `furnitureReason`'s heading
   * detection for those shapes is the next gap, not this one.
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
   * Worth 3 cities on the real corpus — 128 to 131 of 154 — which is the honest
   * figure and smaller than it looks, for the reason in the test above.
   */
  it("takes the plan from a COMPACT heading whose labels share a field", () => {
    const compact = `                    Portion of Work:       Name of Business:                        Location: License #: DIR #:
                    Millwork               Marbury West                             Temple City        1046943       1000062389`;
    const parsed = parseSubListing(compact);
    expect(parsed.rows[0]?.name).toBe("Marbury West");
    expect(parsed.rows[0]?.city).toBe("Temple City");
  });
});

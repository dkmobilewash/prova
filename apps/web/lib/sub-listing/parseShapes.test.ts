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

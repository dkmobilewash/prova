import { describe, expect, it } from "vitest";
import { parseSubListing, tradeMatchFor, tradeScopeFor } from "./parse";
import { LOAD_BEARING_CASES, SUB_LISTING_CASES } from "./subListingCases";

/**
 * WHAT THIS SUITE CAN AND CANNOT TELL YOU.
 *
 * It can tell you the parser accounts for every line it was handed. It CANNOT
 * tell you it reads a real agency's form, because no real form was available —
 * the egress proxy answered 403 for every host. `subListingCases.ts` says so in
 * its own header and that remains the honest headline of this slice.
 *
 * ── THE "SILENTLY LOST" BLOCK IS THE IMPORTANT ONE ──
 *
 * Its cases are not invented. Every one is a reproduction handed over by an
 * adversarial review of the first version of this parser, which demonstrated
 * that the completeness guarantee the file's header claimed was false in three
 * ways. The old design counted "candidate" lines with a predicate and computed
 * `unread` as candidates minus rows — so a line the predicate rejected was in
 * neither set, and `agreed` read `true` while subcontractors went missing.
 *
 * They are kept verbatim because a defect that was once real and is now fixed is
 * the only kind of test case you know is worth having.
 */

const caseNamed = (id: string) => SUB_LISTING_CASES.find((subject) => subject.id === id)!.text;

describe("every non-blank line is accounted for", () => {
  /**
   * THE PARTITION. This replaces the assertion that was wrong.
   *
   * Four buckets — rows, header lines, named furniture, unread — and their sum
   * must equal the number of non-blank lines. There is no predicate that can
   * decline to admit a line, so there is nowhere for one to hide.
   */
  it.each(SUB_LISTING_CASES)("partitions $id — $why", ({ text }) => {
    const parsed = parseSubListing(text);
    const { reconciliation: r } = parsed;
    expect(r.accountedFor).toBe(r.nonBlankLines);
    expect(r.rowsParsed + r.headerLines + r.ignoredLines + r.unreadLines).toBe(r.nonBlankLines);
    expect(r.rowsParsed).toBe(parsed.rows.length);
    expect(r.unreadLines).toBe(parsed.unread.length);
    expect(r.ignoredLines).toBe(parsed.ignored.length);
  });

  it("gives every ignored line a reason, because one without is indistinguishable from a lost one", () => {
    for (const subject of SUB_LISTING_CASES) {
      for (const line of parseSubListing(subject.text).ignored) {
        expect(line.why, `${subject.id} line ${line.line}`).toBeTruthy();
      }
    }
  });

  it("reports a line it cannot read rather than dropping it", () => {
    const parsed = parseSubListing("$100,000    $250,000\n");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.unread).toHaveLength(1);
    expect(parsed.unread[0].why).toMatch(/name/);
    expect(parsed.reconciliation.agreed).toBe(false);
  });

  it("says nothing at all about an empty document", () => {
    const parsed = parseSubListing("");
    expect(parsed.rows).toEqual([]);
    expect(parsed.unread).toEqual([]);
    expect(parsed.ignored).toEqual([]);
    expect(parsed.reconciliation.nonBlankLines).toBe(0);
    expect(parsed.reconciliation.agreed).toBe(true);
  });
});

describe("the subcontractors that used to be silently lost", () => {
  /**
   * The California shape, and the worst of the three. §4104 carries NO dollar
   * field, so whether a row has any numeric token at all depends on whether the
   * licence column happened to be inside the paste. Four subs in, ONE out, with
   * the screen printing a green "every line was read".
   */
  it("reads a row carrying no money, licence or registration at all", () => {
    const parsed = parseSubListing(
      [
        "Project: Lincoln Elementary",
        "Prime: Swinerton Builders",
        "Acme Drywall, Inc.\tFontana, CA\tMetal stud framing and drywall\tLic. 1045723",
        "Baker Plastering Co.\tRialto, CA\tLath and plaster",
        "Western Fireproofing\tOntario, CA\tSpray-applied fireproofing",
        "Valley Ceilings\tColton, CA\tAcoustical ceilings",
      ].join("\n"),
    );
    expect(parsed.rows.map((row) => row.name)).toEqual([
      "Acme Drywall, Inc.",
      "Baker Plastering Co.",
      "Western Fireproofing",
      "Valley Ceilings",
    ]);
    expect(parsed.rows.map((row) => row.tradeScope)).toEqual([
      "METAL_FRAMING_DRYWALL",
      "LATH_PLASTER",
      "FIREPROOFING",
      "ACOUSTICAL_CEILINGS",
    ]);
  });

  /** The totals words matched anywhere on the line, so a sub listed under an
   *  alternate vanished — and subs listed per bid alternate are ordinary. */
  it("keeps a subcontractor whose scope mentions an alternate", () => {
    const parsed = parseSubListing(
      "Acme Drywall, Inc.\tFontana, CA\tAlternate No. 2 — gypsum board\t$85,000",
    );
    expect(parsed.rows.map((row) => row.name)).toEqual(["Acme Drywall, Inc."]);
    expect(parsed.rows[0].amount).toBe(85000);
  });

  /** Total Western, Inc. is a real California contractor. So are companies
   *  whose names carry "allowance" and "alternate". */
  it("keeps a subcontractor whose NAME contains a totals word", () => {
    const parsed = parseSubListing(
      "Total Western, Inc.\tFontana, CA\tMetal stud framing and drywall\t$1,200,000",
    );
    expect(parsed.rows.map((row) => row.name)).toEqual(["Total Western, Inc."]);
  });

  it("still ignores a real totals line, and names it as one", () => {
    const parsed = parseSubListing(
      [
        "Acme Drywall, Inc.\tFontana, CA\tDrywall\t$1,200,000",
        "Total Base Bid: $18,450,000",
      ].join("\n"),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.ignored[0].why).toMatch(/total or an alternate/);
  });

  /** Washington's registration/UBI shapes are neither 6–8 digits nor 1+9, and
   *  the old predicate lost every sub on the page because of it. */
  it("reads rows whose identifiers are in a shape it does not recognise", () => {
    const parsed = parseSubListing(
      [
        "Acme Drywall, Inc.\tSeattle, WA\tMetal stud framing and drywall\tACMEDRY123456789",
        "Baker Plastering\tTacoma, WA\tLath and plaster\t602123456789",
      ].join("\n"),
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.reconciliation.agreed).toBe(true);
  });

  /** An UNINDENTED wrap. The old continuation pass keyed on indentation and
   *  walked straight past this, truncating the one field the outreach hangs on. */
  it("flags an unindented wrapped company name and attributes the orphan line", () => {
    const parsed = parseSubListing(
      [
        "Southern California Drywall &\tFontana, CA\tDrywall\t$1,200,000",
        "Acoustical Systems, Inc.",
      ].join("\n"),
    );
    expect(parsed.rows).toHaveLength(1);
    const concerns = parsed.rows[0].concerns.join(" ");
    expect(concerns).toMatch(/company name .* looks cut off/);
    expect(concerns).toMatch(/Acoustical Systems, Inc\./);
    expect(parsed.ignored[0].why).toMatch(/continuation of line 1/);
  });
});

describe("the claims that used to assert what the document does not say", () => {
  /**
   * An agency posting every bid for one project in one PDF is the normal case.
   * The old header took the FIRST `Prime:` line, so all three primes' subs were
   * attributed to the first — and ticking "awarded" congratulated two of three
   * subs on a job they did not get.
   */
  it("refuses to name a prime when the document names several", () => {
    const parsed = parseSubListing(
      [
        "Project: Lincoln Elementary Modernization",
        "Prime: Swinerton Builders",
        "Acme Drywall, Inc.\tFontana, CA\tDrywall\t$1,200,000",
        "Prime: Bernards Bros. Inc.",
        "Valley Interior Systems\tOntario, CA\tDrywall\t$1,310,000",
        "Prime: McCarthy Building Companies",
        "Baker Drywall Co.\tRialto, CA\tDrywall and taping\t$1,415,000",
      ].join("\n"),
    );
    expect(parsed.header.prime).toBeNull();
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatch(/names 3 prime contractors/);
    expect(parsed.problems[0]).toMatch(/Swinerton Builders/);
    expect(parsed.reconciliation.agreed).toBe(false);
    // The rows still read — the problem is about attribution, not about reading.
    expect(parsed.rows).toHaveLength(3);
  });

  it("names the prime when there is exactly one, however often it is repeated", () => {
    const parsed = parseSubListing(
      ["Prime: Swinerton Builders", "Prime: Swinerton Builders", "Acme\tFontana, CA\tDrywall"].join("\n"),
    );
    expect(parsed.header.prime).toBe("Swinerton Builders");
    expect(parsed.problems).toEqual([]);
  });

  /** A ZIP in the place-of-business column beat the real licence, so the claim
   *  read "Listed with licence 92335". */
  it("does not read a ZIP code as a licence number", () => {
    const parsed = parseSubListing(
      "Acme Drywall, Inc.\tMetal stud framing and drywall\t1420 Sierra Ave, Fontana, CA 92335\tLic. 1045723",
    );
    expect(parsed.rows[0].licence).toBe("1045723");
    expect(parsed.rows[0].portionOfWork).toBe("Metal stud framing and drywall");
  });

  /** "12,500 SF" became "$12,500" in a claim. Money now requires a currency
   *  symbol: missing a real amount costs a clause, inventing one costs the
   *  prospect. */
  it("does not read a quantity column as a dollar amount", () => {
    const parsed = parseSubListing(
      "Acme Drywall, Inc.\tFontana, CA\tMetal stud framing and drywall\t12,500 SF",
    );
    expect(parsed.rows[0].amount).toBeNull();
  });

  it("reads an abbreviated amount at its real size rather than truncating it", () => {
    const amountOf = (cell: string) =>
      parseSubListing(`Acme Drywall\tFontana, CA\tDrywall\t${cell}`).rows[0].amount;
    expect(amountOf("$1.2M")).toBe(1_200_000);
    expect(amountOf("$1.2 million")).toBe(1_200_000);
    expect(amountOf("$850K")).toBe(850_000);
    expect(amountOf("$0.5M")).toBe(500_000);
    expect(amountOf("$1,200,000")).toBe(1_200_000);
  });

  /** `$1200000` is seven digits and it won the licence slot. */
  it("does not read an unformatted dollar figure as a licence", () => {
    const parsed = parseSubListing("Acme Drywall, Inc.\tFontana, CA\tDrywall\t$1200000");
    expect(parsed.rows[0].amount).toBe(1_200_000);
    expect(parsed.rows[0].licence).toBeNull();
  });

  /** A form ordered "Item of work | Subcontractor | …" produced a lead named
   *  after a scope of work, ticked by default, with no warning at all. */
  /**
   * A form ordered "Item of work | Subcontractor | …" used to produce a lead
   * named after a scope of work, ticked by default, with no warning. It is now
   * READ CORRECTLY when anything identifies the company — which is better than
   * a warning, and is why this test changed shape rather than being deleted.
   */
  it("reads a reversed column order correctly when an entity marker identifies the company", () => {
    const parsed = parseSubListing(
      "Metal stud framing and drywall\tAcme Drywall, Inc.\tFontana, CA\t1045723",
    );
    expect(parsed.rows[0].name).toBe("Acme Drywall, Inc.");
    expect(parsed.rows[0].portionOfWork).toBe("Metal stud framing and drywall");
    expect(parsed.rows[0].city).toBe("Fontana, CA");
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
  });

  /**
   * THE KNOWN LIMIT, PINNED RATHER THAN PAPERED OVER.
   *
   * With no entity marker anywhere on the row, the only thing separating the
   * name column from the scope column is position — and position is exactly
   * what is wrong on a reversed form. Both fields match a trade keyword, so
   * the pairwise discriminator cannot fire either.
   *
   * A heuristic that guessed here would fire on ordinary rows too
   * ("Northstate Drywall / Chico, CA / Drywall assemblies" has the same shape
   * and is correct), so the parser does not guess. This test asserts the WRONG
   * answer on purpose, so the limit is visible in the suite rather than
   * discovered by somebody on a real document — and so that anybody who fixes
   * it sees a red test telling them they have.
   *
   * It is bounded: the row is still READ, so nothing is lost, and the review
   * screen shows the verbatim source line beside the name it chose.
   */
  it("cannot tell a reversed order apart when nothing identifies the company", () => {
    const parsed = parseSubListing("Metal stud framing and drywall\tNorthstate Drywall\tFontana, CA");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Metal stud framing and drywall");
    expect(parsed.rows[0].portionOfWork).toBe("Northstate Drywall");
    // Not lost, and the city is still right.
    expect(parsed.rows[0].city).toBe("Fontana, CA");
  });

  it("never names a lead after a bid item number or a city", () => {
    // Both WITHOUT an entity marker anywhere, because the marker preference
    // would otherwise pick the right field on its own and the exclusions would
    // never be exercised — which is exactly how both mutations survived.
    const item = parseSubListing("Item 4\tNorthstate Drywall\tLic. 684213\tFontana, CA\tDrywall");
    expect(item.rows[0].name).toBe("Northstate Drywall");

    const cityFirst = parseSubListing("Fontana, CA\tNorthstate Drywall\tDrywall");
    expect(cityFirst.rows[0].name).toBe("Northstate Drywall");
    expect(cityFirst.rows[0].city).toBe("Fontana, CA");
  });
});

describe("the counter-metric", () => {
  /**
   * A parser that returned NOTHING would satisfy every partition assertion
   * above: nothing is ever missing from an empty list. The vacuity has to be a
   * named failure from the first run, not something discovered later.
   */
  it.each(SUB_LISTING_CASES)("reads the expected rows from $id", ({ text, expectRows, expectUnread }) => {
    const parsed = parseSubListing(text);
    expect(parsed.rows).toHaveLength(expectRows);
    expect(parsed.unread).toHaveLength(expectUnread);
  });

  it("keeps the load-bearing cases, named rather than counted", () => {
    const ids = SUB_LISTING_CASES.map((subject) => subject.id);
    for (const required of LOAD_BEARING_CASES) {
      expect(ids, `${required} may not be deleted — read its "why"`).toContain(required);
    }
  });
});

describe("reading a California listing", () => {
  const parsed = parseSubListing(caseNamed("clean-five"));

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
    expect(valley.line).toBe(11);
    expect(valley.concerns).toEqual([]);
  });

  it("carries the verbatim line, because that is what a claim quotes", () => {
    expect(parsed.rows[0].sourceText).toContain("Metal stud framing & drywall");
  });

  it("finds no amount, because the California form has no amount to find", () => {
    for (const row of parsed.rows) {
      expect(row.amount, `${row.name} should carry no amount`).toBeNull();
      expect(row.percentOfBid).toBeNull();
    }
  });

  it("treats the column headings as furniture and says so", () => {
    expect(parsed.ignored.some((line) => /column headings/.test(line.why))).toBe(true);
  });

  it("keeps the sub whose trade is not one of ours, unclassified", () => {
    const delta = parsed.rows.find((row) => row.name.startsWith("Delta Electric"))!;
    expect(delta.portionOfWork).toBe("Electrical");
    expect(delta.tradeScope).toBeNull();
  });
});

describe("the shapes that lose a row quietly", () => {
  it("flags a scope that wrapped, and attributes the orphan line to its row", () => {
    const parsed = parseSubListing(caseNamed("wrapped-row"));
    const sierra = parsed.rows.find((row) => row.name === "Sierra Wall Systems")!;
    expect(sierra.concerns.join(" ")).toMatch(/cut off/);
    expect(sierra.concerns.join(" ")).toMatch(/interior finish carpentry/);
    expect(parsed.rows.map((row) => row.name)).toContain("Kings Acoustical");
  });

  it("costs the licence FIELD and never the row when the format is unknown", () => {
    const parsed = parseSubListing(caseNamed("odd-licence"));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].licence).toBeNull();
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
  });

  it("reads a bare table and invents no project for it", () => {
    const parsed = parseSubListing(caseNamed("no-header"));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.header).toEqual({ project: null, agency: null, prime: null, bidDate: null });
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(parsed.rows[1].tradeScope).toBe("LATH_PLASTER");
  });

  it("separates on tabs and on pipes, not only on space runs", () => {
    const tabs = parseSubListing(caseNamed("tab-delimited"));
    expect(tabs.rows.map((row) => row.name)).toEqual([
      "Bayline Drywall Systems",
      "Monterey Plastering",
    ]);
    expect(tabs.rows[0].amount).toBe(744300);

    const pipes = parseSubListing(caseNamed("pipe-delimited"));
    expect(pipes.rows.map((row) => row.name)).toEqual([
      "Diablo Ceiling & Partition",
      "Brightwall EIFS",
    ]);
    expect(pipes.rows[1].tradeScope).toBe("EIFS");
  });

  it("reads a percentage when that is what the form carries", () => {
    const parsed = parseSubListing(caseNamed("percent-not-dollars"));
    expect(parsed.rows[0].percentOfBid).toBe(8.4);
    expect(parsed.rows[0].amount).toBeNull();
    expect(parsed.rows[1].percentOfBid).toBe(2.15);
  });

  it("reads Oregon's dollar value, which is the only one that is real", () => {
    const parsed = parseSubListing(caseNamed("oregon-with-amounts"));
    expect(parsed.rows[0].name).toBe("Cascade Interior Systems");
    expect(parsed.rows[0].amount).toBe(2140000);
    expect(parsed.rows[1].amount).toBe(385500);
  });

  it("does not turn page furniture into a subcontractor", () => {
    const parsed = parseSubListing(caseNamed("noise-only"));
    expect(parsed.rows).toEqual([]);
    expect(parsed.unread).toEqual([]);
    expect(parsed.ignored).toHaveLength(3);
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

  it.each([["Electrical"], ["Plumbing"], ["Structural steel"], ["Earthwork and grading"], ["Site concrete"]])(
    "leaves %s unclassified rather than forcing it into one of ours",
    (portion) => {
      expect(tradeScopeFor(portion)).toBeNull();
    },
  );

  it("says nothing when there is nothing to read", () => {
    expect(tradeScopeFor(null)).toBeNull();
    expect(tradeScopeFor("")).toBeNull();
  });

  /**
   * THE ONE THAT MATTERED MOST, and it was returning `null`.
   *
   * `drywall` and `ceiling` are both seven characters, so the commonest wording
   * of a drywall sub's own scope tied and resolved to "not one of our trades" —
   * which defaulted the row to unticked on a screen whose checkbox could not
   * then be ticked. A tie between two of OUR trades is not an unknown.
   */
  it.each([
    ["Drywall and ceilings"],
    ["Ceilings and drywall"],
    ["Drywall & ceilings"],
    ["Framing, drywall, ceilings"],
    ["Plaster and drywall"],
    ["Lath, plaster and drywall"],
  ])("resolves %s to one of ours rather than to nothing", (portion) => {
    const match = tradeMatchFor(portion);
    expect(match.scope).not.toBeNull();
    expect(match.alsoMatched.length).toBeGreaterThan(0);
  });

  it("prefers metal framing and drywall on a tie, and reports the other match", () => {
    const match = tradeMatchFor("Drywall and ceilings");
    expect(match.scope).toBe("METAL_FRAMING_DRYWALL");
    expect(match.alsoMatched).toContain("ACOUSTICAL_CEILINGS");
  });

  it("still lets a longer keyword beat the priority order", () => {
    // "synthetic stucco" (16) is EIFS and outranks "stucco" (6) for plaster,
    // even though plaster sorts earlier in the priority list.
    expect(tradeScopeFor("EIFS and synthetic stucco")).toBe("EIFS");
    expect(tradeScopeFor("Spray-applied fireproofing and insulation")).toBe("FIREPROOFING");
  });

  it("raises a concern on a row whose scope spans two of our trades", () => {
    const parsed = parseSubListing("Acme Interiors\tFontana, CA\tDrywall and ceilings\t$900,000");
    expect(parsed.rows[0].tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(parsed.rows[0].concerns.join(" ")).toMatch(/more than one of our trades/);
  });
});

describe("furniture is only furniture — the converse nobody asserted", () => {
  /**
   * THE MISSING HALF, AND THE REASON THE REWRITE SHIPPED BROKEN.
   *
   * The suite asserted that a column-heading line IS ignored. It never asserted
   * that a data row is NOT. One guard written, its converse not — and a second
   * review proved `furnitureReason` ate six of seven ordinary rows, because its
   * heading branch required the line to carry no money, percent or registration
   * and a §4104 listing has no dollar column at all.
   *
   * Every row below is one the reviewer demonstrated being eaten. They are kept
   * verbatim: a defect that was real and is now fixed is the only kind of case
   * you know is worth having.
   */
  const SHOULD_BE_ROWS: [string, string][] = [
    ["a licence label plus a city containing 'City'", "Acme Drywall, Inc.\tLic. 684213\tDaly City, CA\tDrywall"],
    ["no number at all — the plain §4104 shape", "Acme Drywall, Inc.\tCulver City, CA\tInterior finish work"],
    ["'License' spelled out, plus 'Scope:'", "Acme Drywall, Inc.\tLicense 684213\tFontana, CA\tScope: drywall"],
    ["a numbered bid item in the first column", "Item 4\tAcme Drywall, Inc.\tLic. 684213\tFontana, CA\tDrywall"],
    ["'Company' in the name and 'work' in the scope", "Acme Drywall Company\tFontana, CA\tFinish carpentry and drywall work"],
    ["a company whose name contains 'City'", "National City Plastering\tLic. 684213\tSan Diego, CA\tLath and plaster"],
    ["a non-DIR-shaped registration", "Acme Drywall, Inc.\tLic. 684213\tReg. 2000012345\tFontana, CA\tDrywall"],
  ];

  it.each(SHOULD_BE_ROWS)("reads a row, not furniture: %s", (_why, line) => {
    const parsed = parseSubListing(line);
    expect(parsed.ignored, `"${line}" was filed as furniture`).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).not.toMatch(/^(Lic|License|Item|Reg)\b/);
  });

  it("reads all five subs off a realistic California listing with no dollar column", () => {
    const parsed = parseSubListing(
      [
        "Project: Mission Bay Middle School Modernization",
        "Agency: San Diego Unified School District",
        "Prime Contractor: Swinerton Builders",
        "",
        "Name of Subcontractor            City, State          Licence        Portion of Work",
        "Valley Interior Systems          Fontana, CA          C-9 884201     Metal stud framing & drywall",
        "National City Plastering         San Diego, CA        Lic. 771903    Lath and cement plaster",
        "Harbor Acoustical Company        Chula Vista, CA      C-2 650118     Acoustical ceilings",
        "Pacific Coast Interiors          Culver City, CA      C-9 912004     Interior finish work",
        "Summit Fireproofing, Inc.        Ontario, CA          C-2 334455     Spray-applied fireproofing",
      ].join("\n"),
    );
    expect(parsed.rows.map((row) => row.name)).toEqual([
      "Valley Interior Systems",
      "National City Plastering",
      "Harbor Acoustical Company",
      "Pacific Coast Interiors",
      "Summit Fireproofing, Inc.",
    ]);
    // Exactly one line set aside, and it is the heading.
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.ignored[0].why).toMatch(/column headings/);
  });

  it("still recognises a genuine heading row, in every delimiter", () => {
    for (const heading of [
      "Name of Subcontractor          City, State        Licence       Portion of Work",
      "Subcontractor\tCity\tLicence\tWork\tAmount",
      "Firm | Location | Lic. | Scope | Value",
    ]) {
      const parsed = parseSubListing(heading);
      expect(parsed.rows, `"${heading}" should not be a row`).toEqual([]);
      expect(parsed.ignored[0]?.why).toMatch(/column headings/);
    }
  });
});

describe("each signal that rescues a row from being called furniture", () => {
  /**
   * WRITTEN BECAUSE FOUR MUTATIONS SURVIVED.
   *
   * `hasDataEvidence` has several signals and the cases above happen to satisfy
   * more than one at a time, so removing any single signal changed no outcome —
   * a suite that cannot tell which part of a guard is doing the work. Each case
   * here is built to leave exactly ONE signal standing.
   */
  it("rescues a row on the CITY alone — no digits, no entity marker", () => {
    const line = "Acme Drywall\tCulver City, CA\tInterior finish work";
    expect(/\d{4,}/.test(line), "this case must carry no 4-digit run").toBe(false);
    const parsed = parseSubListing(line);
    expect(parsed.ignored).toEqual([]);
    expect(parsed.rows[0].name).toBe("Acme Drywall");
    expect(parsed.rows[0].city).toBe("Culver City, CA");
  });

  it("rescues a row on the ENTITY MARKER alone — no digits, no city, heading words in the majority", () => {
    // The first version of this case was not isolating: with only one heading
    // word in three fields the majority rule already saved it, so removing the
    // entity-marker signal changed nothing and the mutation survived. This one
    // carries TWO heading words in three fields, so the majority rule would
    // condemn it and the marker is the only thing left standing.
    const line = "Acme Drywall, Inc.\tInterior finish work\tScope: level 5 taping";
    expect(/\d{4,}/.test(line), "must carry no 4-digit run").toBe(false);
    const parsed = parseSubListing(line);
    expect(parsed.ignored, "the entity marker must rescue this row").toEqual([]);
    expect(parsed.rows[0].name).toBe("Acme Drywall, Inc.");
  });

  it("rescues a row on DIGITS alone — no city, no entity marker, heading words in the majority", () => {
    // Isolating for the same reason the marker case needed rewriting: two
    // heading words in three fields, so the majority rule condemns it and the
    // digit run is the only signal left.
    const line = "Acme Drywall\t684213\tScope of work";
    const parsed = parseSubListing(line);
    expect(parsed.ignored, "the licence digits must rescue this row").toEqual([]);
    expect(parsed.rows[0].licence).toBe("684213");
  });

  /**
   * The majority rule, isolated. Two heading words out of five fields: enough
   * for the old `>= 2` test to eat the row, not enough to be a majority. No
   * other data evidence, so the majority rule is the only thing saving it.
   */
  it("needs heading words to be a MAJORITY, not merely two of them", () => {
    const line = "Northstate Drywall\tChico\tInterior finish work\tTaping and texture\tScope: level 5";
    expect(/\d{4,}/.test(line)).toBe(false);
    const parsed = parseSubListing(line);
    expect(parsed.ignored, "two heading words in five fields is not a heading row").toEqual([]);
    expect(parsed.rows[0].name).toBe("Northstate Drywall");
  });

  it("does not name a lead after a city even when nothing carries an entity marker", () => {
    const parsed = parseSubListing("Fontana, CA\tNorthstate Drywall\tDrywall");
    expect(parsed.rows[0].name).toBe("Northstate Drywall");
    expect(parsed.rows[0].city).toBe("Fontana, CA");
  });
});

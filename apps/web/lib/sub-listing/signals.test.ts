import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSubListing } from "./parse";
import { shouldInclude, signalsForSub, importSummaryFor } from "./signals";
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

describe("whether a row is imported", () => {
  /**
   * The rule that shipped as an inert checkbox. An explicit choice must always
   * win, or the control does nothing for exactly the rows a person most needs to
   * correct — the ones whose trade did not match.
   */
  it("defaults to the trade match when nobody has chosen", () => {
    expect(shouldInclude({ tradeScope: "METAL_FRAMING_DRYWALL" }, undefined)).toBe(true);
    expect(shouldInclude({ tradeScope: null }, undefined)).toBe(false);
  });

  it("lets an explicit choice override the default, in BOTH directions", () => {
    // This is the half that was broken: a row the trade match excluded could
    // never be included, because `false` and "unset" were the same value.
    expect(shouldInclude({ tradeScope: null }, true)).toBe(true);
    expect(shouldInclude({ tradeScope: "METAL_FRAMING_DRYWALL" }, false)).toBe(false);
  });
});

describe("a scope that ran off the end of the line", () => {
  /**
   * CAUGHT BY MUTATION, and it is the second time on this feature that the fix
   * was written and the assertion was not. The row already carried an amber
   * concern about the wrap — but the concern is read on screen and the CLAIM is
   * what gets read down a telephone, so for a while the warning reached
   * everywhere except the one place it mattered.
   */
  const wrapped = parseSubListing(
    [
      "Project: Fresno Courthouse Interior Buildout",
      "Prime Contractor: Harris Construction",
      "Sierra Wall Systems\tFresno, CA\tC-9 448120\tMetal stud framing, drywall and\t$968,000",
      "\tinterior finish carpentry",
    ].join("\n"),
  );

  it("marks the fragment in the claim, not only in the concern", () => {
    const sierra = wrapped.rows[0];
    expect(sierra.concerns.join(" ")).toMatch(/cut off/);

    const trade = signalsForSub(sierra, wrapped.header).find((s) => s.kind === "TRADE")!;
    expect(trade.claim).toContain("…");
    expect(trade.claim).toMatch(/runs on past the end of the line/);
    // And it must not present the severed phrase as a whole scope.
    expect(trade.claim).not.toMatch(/Listed for "Metal stud framing, drywall and"(?!…)/);
  });

  it("still names the trade, because the keyword match survives a wrap", () => {
    const trade = signalsForSub(wrapped.rows[0], wrapped.header).find((s) => s.kind === "TRADE")!;
    expect(trade.claim).toContain("Metal framing / drywall");
  });
});

/**
 * A WRAPPED PROJECT NAME, WHICH IS THE SAME DEFECT AS A WRAPPED SCOPE ON THE
 * HALF OF THE SENTENCE THAT NAMES THE MAN'S JOB.
 *
 * `looksCutOff` is exported from `parse.ts` with a comment saying it exists so a
 * claim can MARK a fragment rather than quote it, and for three reviews it was
 * applied to `portionOfWork` only. A project name wraps the same way — "Project:
 * Lincoln Elementary School Modernization and" with "Site Improvements, Phase 2"
 * on the next line — and the truncation went into the two claims that name the
 * job, with nothing on screen to say so.
 */
describe("a project name that visibly does not finish is marked, not quoted whole", () => {
  const wrapped = [
    "Project: Lincoln Elementary School Modernization and",
    "Site Improvements, Phase 2",
    "Prime: Swinerton Builders",
    "Acme Interiors, Inc.\tFontana, CA\tLic. 884201\tDrywall",
  ].join("\n");

  it("raises a problem naming the truncated value, so the screen says so", () => {
    const parsed = parseSubListing(wrapped);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain("visibly does not finish");
    expect(parsed.problems[0]).toContain("Lincoln Elementary School Modernization and");
    // And the verdict cannot read clean over it.
    expect(parsed.reconciliation.agreed).toBe(false);
  });

  it("marks the fragment in the PROJECT and GC claims rather than asserting it whole", () => {
    const parsed = parseSubListing(wrapped);
    const claims = signalsForSub(parsed.rows[0], parsed.header, "AWARDED");
    const project = claims.find((claim) => claim.kind === "PROJECT")!.claim;
    const gc = claims.find((claim) => claim.kind === "GC_RELATIONSHIP")!.claim;
    // The ellipsis is the whole fix: it is the difference between naming a job
    // and naming a job we have only half of.
    expect(project).toContain("Modernization and…");
    expect(gc).toContain("Modernization and…");
  });

  it("leaves a project name that DOES finish completely alone", () => {
    const clean = parseSubListing(
      [
        "Project: Lincoln Elementary Modernization",
        "Prime: Swinerton Builders",
        "Acme Interiors, Inc.\tFontana, CA\tLic. 884201\tDrywall",
      ].join("\n"),
    );
    expect(clean.problems).toEqual([]);
    expect(clean.reconciliation.agreed).toBe(true);
    const claims = signalsForSub(clean.rows[0], clean.header, "AWARDED");
    const project = claims.find((claim) => claim.kind === "PROJECT")!.claim;
    expect(project).toContain("Lincoln Elementary Modernization,");
    expect(project).not.toContain("…");
  });

  it("guards the agency and the bid date the same way", () => {
    const parsed = parseSubListing(
      [
        "Agency: Fontana Unified School District and",
        "Acme Interiors, Inc.\tFontana, CA\tLic. 884201\tDrywall",
      ].join("\n"),
    );
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain("agency");
    expect(parsed.problems[0]).toContain("visibly does not finish");
  });
});

/**
 * WHICH GENERAL CONTRACTOR LISTED THIS SUB — the sentence the whole feature is
 * for, and the one thing this file read from the wrong place.
 *
 * The opening line of the call is "I saw <GC> listed you on <job>". `parse.ts`
 * reads the bidding contractor PER ROW because the common published shape is a
 * bid summary naming every prime who bid, and `readHeader` NULLS `header.prime`
 * when a page names more than one. This file built both GC-naming claims from
 * `header.prime` alone, so on exactly those documents the stored column knew the
 * right GC and the sentence a person reads down a telephone did not.
 *
 * Both fixtures below are synthetic. No real company, project, licence or
 * registration appears in this file.
 */
describe("the GC a claim names is the one that listed THIS row", () => {
  /** A bid summary: two primes, each with its own table. No `Prime:` label at all. */
  const TWO_BIDDERS = [
    "Project: Riverbend Transit Center",
    "Agency: Riverbend Transit Authority",
    "Bid Date: March 11, 2026",
    "",
    "Northgate Builders, Inc.",
    "      Total Bid  $12,400,000.00",
    "      Subcontractor          City            License        Portion of Work",
    "      Valley Interior Partners   Fontana, CA    C-9 701455    Metal stud framing & drywall",
    "",
    "Pinecrest Construction Group",
    "      Total Bid  $12,910,000.00",
    "      Subcontractor          City            License        Portion of Work",
    "      Summit Wall Systems        Rialto, CA     C-9 712338    Drywall and acoustical ceilings",
  ].join("\n");

  /**
   * THE DANGEROUS SHAPE, AND THE REASON IT RAISES NO PROBLEM.
   *
   * One `Prime:` label at the top and further bidders printing their own tables
   * below. `readHeader` sees a single prime, so there is no conflict to null and
   * no problem to warn anybody — and before the fix every row in every later
   * block was attributed to the first prime. A false sentence, silently.
   */
  const LABEL_THEN_ANOTHER_BIDDER = [
    "Project: Riverbend Transit Center",
    "Prime Contractor: Northgate Builders, Inc.",
    "",
    "      Subcontractor          City            License        Portion of Work",
    "      Valley Interior Partners   Fontana, CA    C-9 701455    Metal stud framing & drywall",
    "",
    "Pinecrest Construction Group",
    "      Total Bid  $12,910,000.00",
    "      Subcontractor          City            License        Portion of Work",
    "      Summit Wall Systems        Rialto, CA     C-9 712338    Drywall and acoustical ceilings",
  ].join("\n");

  function claimsFor(text: string, index: number, outcome?: "AWARDED") {
    const parsed = parseSubListing(text);
    const row = parsed.rows[index];
    const found = signalsForSub(row, parsed.header, outcome);
    return {
      row,
      project: found.find((signal) => signal.kind === "PROJECT")?.claim ?? null,
      gc: found.find((signal) => signal.kind === "GC_RELATIONSHIP")?.claim ?? null,
    };
  }

  it("reads the bidder off the row on a page with several, where the header has none", () => {
    const parsed = parseSubListing(TWO_BIDDERS);
    // The premise: the page labels no prime, and each row carries its own bidder.
    // Without this the assertions below could pass on a document that never
    // exercised per-row attribution at all.
    expect(parsed.header.prime).toBeNull();
    expect(parsed.rows.map((row) => row.listedBy)).toEqual([
      "Northgate Builders, Inc.",
      "Pinecrest Construction Group",
    ]);

    const first = claimsFor(TWO_BIDDERS, 0);
    expect(first.gc).toMatch(/^Northgate Builders, Inc\. listed them as their subcontractor/);
    expect(first.project).toMatch(/Named on Northgate Builders, Inc\.'s bid for Riverbend Transit Center/);
    expect(first.gc).not.toMatch(/Pinecrest/);
    expect(first.project).not.toMatch(/Pinecrest/);

    const second = claimsFor(TWO_BIDDERS, 1);
    expect(second.gc).toMatch(/^Pinecrest Construction Group listed them as their subcontractor/);
    expect(second.project).toMatch(/Named on Pinecrest Construction Group's bid for Riverbend Transit Center/);
    expect(second.gc).not.toMatch(/Northgate/);
    expect(second.project).not.toMatch(/Northgate/);
  });

  it("names GC_RELATIONSHIP at all on a multi-prime page, which it could not before", () => {
    // The band needs PROJECT or GC_RELATIONSHIP on top of the baseline to reach
    // "Call this one". With the GC read from the header alone this kind was
    // dropped entirely here, so the lead that is most worth ringing — one on a
    // document naming its GC per row — was the one with no opener.
    for (const index of [0, 1]) {
      const kinds = (() => {
        const parsed = parseSubListing(TWO_BIDDERS);
        return signalsForSub(parsed.rows[index], parsed.header).map((signal) => signal.kind);
      })();
      expect(kinds).toContain("GC_RELATIONSHIP");
    }
  });

  it("does not attribute a later bidder's sub to the prime the page labelled", () => {
    const parsed = parseSubListing(LABEL_THEN_ANOTHER_BIDDER);
    // The premise again, and the reason this shape is the dangerous one: nothing
    // is wrong enough for the reader to complain about.
    expect(parsed.header.prime).toBe("Northgate Builders, Inc.");
    expect(parsed.rows[1].listedBy).toBe("Pinecrest Construction Group");
    expect(parsed.problems).toEqual([]);

    const second = claimsFor(LABEL_THEN_ANOTHER_BIDDER, 1);
    expect(second.gc).toMatch(/^Pinecrest Construction Group listed them/);
    expect(second.project).toMatch(/Named on Pinecrest Construction Group's bid/);
    // The specific false sentence the fix exists to stop.
    expect(second.gc).not.toMatch(/Northgate/);
    expect(second.project).not.toMatch(/Northgate/);
  });

  it("says 'works under' the ROW's bidder once an award is declared, not the page's", () => {
    const second = claimsFor(LABEL_THEN_ANOTHER_BIDDER, 1, "AWARDED");
    expect(second.gc).toMatch(/^Works under Pinecrest Construction Group/);
    expect(second.project).toMatch(/under Pinecrest Construction Group/);
    expect(second.gc).not.toMatch(/Northgate/);
    expect(second.project).not.toMatch(/Northgate/);
  });

  it("falls back to the page's prime for a row the document did not attribute", () => {
    // The other half of the precedence, and the half every existing fixture
    // exercises: a §4104 listing filed by one prime labels it in the header and
    // attributes no row, so dropping the fallback would silently un-name the GC
    // on the ordinary document.
    const parsed = parseSubListing(LABEL_THEN_ANOTHER_BIDDER);
    expect(parsed.rows[0].listedBy).toBeNull();

    const first = claimsFor(LABEL_THEN_ANOTHER_BIDDER, 0);
    expect(first.gc).toMatch(/^Northgate Builders, Inc\. listed them as their subcontractor/);
    expect(first.project).toMatch(/Named on Northgate Builders, Inc\.'s bid/);
  });
});

describe("a GC nobody can name", () => {
  /**
   * Two labelled primes and no table heading: `readHeader` nulls the prime
   * because nothing in a flat paste says which prime a row sits under, and with
   * no heading there is no table edge, so no row can be attributed either.
   * Genuinely unknown — the one case where guessing would be the wrong answer.
   */
  const NOBODY = [
    "Project: Riverbend Transit Center",
    "Prime Contractor: Northgate Builders, Inc.",
    "Prime Contractor: Pinecrest Construction Group",
    "Valley Interior Partners\tFontana, CA\tC-9 701455\tMetal stud framing & drywall",
  ].join("\n");

  const parsed = parseSubListing(NOBODY);

  it("is genuinely unknown in this fixture, from both sources", () => {
    expect(parsed.header.prime).toBeNull();
    expect(parsed.rows[0].listedBy).toBeNull();
  });

  it("proposes no GC_RELATIONSHIP, because a relationship with nobody is a rumour", () => {
    const kinds = signalsForSub(parsed.rows[0], parsed.header).map((signal) => signal.kind);
    expect(kinds).not.toContain("GC_RELATIONSHIP");
    // And it invents nothing from the two names the page did print.
    for (const signal of signalsForSub(parsed.rows[0], parsed.header)) {
      expect(signal.claim, signal.kind).not.toMatch(/Northgate|Pinecrest/);
    }
  });

  it("still claims the project, and says in the claim that the GC is not known", () => {
    // Claim it and say what is doubtful, rather than refuse it: the project is a
    // real sourced fact, and the danger is a reviewer supplying one of the two
    // primes from memory because the sentence left a hole where a GC goes.
    const project = signalsForSub(parsed.rows[0], parsed.header).find(
      (signal) => signal.kind === "PROJECT",
    )!.claim;
    expect(project).toMatch(/^Named on a bid for Riverbend Transit Center/);
    expect(project).toMatch(/the paste does not say which prime bidder listed them/);
    // Both doubts, in one sentence, and the older one not displaced by the new.
    expect(project).toMatch(/does not say whether that bid won/);
  });

  it("keeps the unknown-GC doubt once an award is declared, where the bid doubt goes", () => {
    const project = signalsForSub(parsed.rows[0], parsed.header, "AWARDED").find(
      (signal) => signal.kind === "PROJECT",
    )!.claim;
    expect(project).toMatch(/^On Riverbend Transit Center/);
    expect(project).toMatch(/the paste does not say which prime bidder listed them/);
    expect(project).not.toMatch(/whether that bid won/);
  });

  /**
   * CAUGHT BY MUTATION, AND NOTHING ELSE WAS DOING THIS WORK.
   *
   * Removing the `if (!prime)` guard — so the doubt is appended to every PROJECT
   * claim — left all 403 tests green. Every assertion about a named GC checks what
   * the sentence SAYS; none checked that it does not then take it back. A claim
   * reading "Named on Northgate Builders, Inc.'s bid … — the paste does not say
   * which prime bidder listed them" contradicts itself in the one sentence that is
   * read aloud, and the hedge is the half a listener believes.
   */
  it("does not hedge a GC it has just named", () => {
    const named = [
      ...signalsForSub(valley, california.header),
      ...signalsForSub(valley, california.header, "AWARDED"),
      ...signalsForSub(cascade, oregon.header),
    ];
    expect(named.length).toBeGreaterThan(6);
    for (const signal of named) {
      expect(signal.claim, signal.kind).not.toMatch(/which prime bidder/);
    }
  });

  it("says nothing about a GC when there is no project either", () => {
    // Nothing to attach a doubt to, so no claim at all rather than a sentence
    // whose only content is what it does not know.
    const bare = parseSubListing(
      "Valley Interior Partners\tFontana, CA\tC-9 701455\tMetal stud framing & drywall",
    );
    const kinds = signalsForSub(bare.rows[0], bare.header).map((signal) => signal.kind);
    expect(kinds).not.toContain("PROJECT");
    expect(kinds).not.toContain("GC_RELATIONSHIP");
  });
});

describe("a GC name that visibly does not finish", () => {
  /**
   * The same defect as a wrapped scope and a wrapped project, on the half of the
   * sentence that names a man by name. "I saw Hutchinson Brothers and listed
   * you" is worse than saying nothing, because it is read aloud.
   */
  const HEADER_WRAP = [
    "Project: Riverbend Transit Center",
    "Prime Contractor: Beaumont Construction and",
    "Sons, Inc.",
    "Valley Interior Partners\tFontana, CA\tC-9 701455\tMetal stud framing & drywall",
  ].join("\n");

  /** The same wrap on a bidder line, which `parse.ts` joins only after a comma. */
  const BIDDER_WRAP = [
    "Project: Riverbend Transit Center",
    "",
    "Hutchinson Brothers and",
    "      Total Bid  $9,100,000.00",
    "      Subcontractor          City            License        Portion of Work",
    "      Valley Interior Partners   Fontana, CA    C-9 701455    Metal stud framing & drywall",
  ].join("\n");

  it("marks a wrapped prime from the header in both claims", () => {
    const parsed = parseSubListing(HEADER_WRAP);
    expect(parsed.header.prime).toBe("Beaumont Construction and");
    const claims = signalsForSub(parsed.rows[0], parsed.header);
    for (const kind of ["PROJECT", "GC_RELATIONSHIP"] as const) {
      const claim = claims.find((signal) => signal.kind === kind)!.claim;
      expect(claim, kind).toContain("Beaumont Construction and…");
    }
  });

  it("marks a wrapped bidder read off the row, which raises no problem of its own", () => {
    const parsed = parseSubListing(BIDDER_WRAP);
    expect(parsed.rows[0].listedBy).toBe("Hutchinson Brothers and");
    const claims = signalsForSub(parsed.rows[0], parsed.header);
    for (const kind of ["PROJECT", "GC_RELATIONSHIP"] as const) {
      const claim = claims.find((signal) => signal.kind === kind)!.claim;
      expect(claim, kind).toContain("Hutchinson Brothers and…");
    }
  });

  it("leaves a GC name that does finish completely alone", () => {
    const parsed = parseSubListing(
      [
        "Project: Riverbend Transit Center",
        "Prime Contractor: Beaumont Construction",
        "Valley Interior Partners\tFontana, CA\tC-9 701455\tMetal stud framing & drywall",
      ].join("\n"),
    );
    const gc = signalsForSub(parsed.rows[0], parsed.header).find(
      (signal) => signal.kind === "GC_RELATIONSHIP",
    )!.claim;
    expect(gc).toContain("Beaumont Construction listed them");
    expect(gc).not.toContain("…");
  });
});

/**
 * ONE HOME FOR THE PRECEDENCE, ASSERTED ACROSS THE TWO FILES THAT NEED IT.
 *
 * `sales.ts` writes the stored `listedByGc` column and this file writes the
 * sentence; both must read the row's own bidder first and fall back to the page
 * prime. #526's lesson is that a completeness guard cannot see a second copy of a
 * list, so the guard that works asks whether there IS a second one. Here the copy
 * is unavoidable for now — `signals.ts` exports `listedByGcFor` and the action is
 * another agent's file tonight — so this asserts the two agree, and names the
 * one-line change that would remove the copy altogether.
 */
describe("the stored column and the spoken sentence agree about the GC", () => {
  const salesSource = readFileSync(
    fileURLToPath(new URL("../actions/sales.ts", import.meta.url)),
    "utf8",
  );

  /**
   * Every `listedByGc:` in that file EXCEPT the ones that are not writes: the
   * field's own type, and the `true` of a Prisma `select`. Those two exclusions
   * are named rather than pattern-dodged, because the first version of this
   * census matched the TYPE DECLARATION — 500 lines above the write — and
   * reported the rule broken while it was perfectly intact. A census that reads
   * the wrong line is the shape this repo keeps paying for; the count below is
   * what turns it into a loud failure instead of a confident wrong answer.
   */
  const writeSites = [...salesSource.matchAll(/listedByGc\s*:\s*([^\n]+)/g)]
    .map((match) => match[1].trim())
    .filter((rhs) => !/^(?:string|number|boolean)\b/.test(rhs))
    .filter((rhs) => !/^(?:true|false)\s*,?$/.test(rhs));

  it("can still see the write site, or nothing below means anything", () => {
    // The vacuity guard: without it a renamed field makes the assertion below
    // pass over an empty list. Nothing is ever missing from a list of none.
    expect(salesSource.length).toBeGreaterThan(1000);
    expect(
      writeSites.length,
      "no listedByGc write site found in sales.ts — either the field was renamed or " +
        "this census can no longer see it, and until that is settled the agreement " +
        "below is unverified rather than true",
    ).toBeGreaterThanOrEqual(1);
  });

  it("reads the row's own bidder first and the page prime only as a fallback", () => {
    for (const rhs of writeSites) {
      const callsTheHelper = /listedByGcFor\s*\(/.test(rhs);
      // Tolerant of renames, strict about the ORDER: row first, prime second.
      const spellsItOut = /listedBy[\s\S]{0,40}\?\?[\s\S]{0,40}prime/i.test(rhs);
      expect(
        callsTheHelper || spellsItOut,
        `sales.ts stores listedByGc as \`${rhs}\`, which no longer reads the ` +
          "row's own bidder before the page prime. The claim in signals.ts does, so the " +
          "column a person reads on screen and the sentence they read down a telephone " +
          "would name different general contractors. Either fix the order or — better — " +
          "call listedByGcFor from signals.ts, which is the single home for this rule.",
      ).toBe(true);
    }
  });
});

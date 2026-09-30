/**
 * WH-347 page 2.
 *
 * Three things this file is written to catch, in the order they would hurt:
 *
 *   1. REPRODUCED STATUTORY PROSE PRESENTED AS CHECKED. Every paragraph is
 *      `verified: false` because not one was read off a DOL page, and if
 *      somebody flips one the test demands the primary URL that would justify
 *      it. Same guard `das-forms.test.ts` puts on the DAS rules, same reason.
 *   2. THE FRINGE ELECTION BEING GUESSED. Section 4(a) versus 4(b) is a
 *      statement about how a company pays, off a column the schema does not
 *      have. An unelected statement must BLOCK, not default.
 *   3. A BOX THAT LOOKS FILLED IN. A blank signatory, a whitespace title, an
 *      exception naming a craft with no explanation — each has to read as
 *      absent rather than present, on a document a federal agency receives.
 */

import { describe, expect, it } from "vitest";

import {
  WH347_FRINGE_MODE_CITATION,
  WH347_FRINGE_MODE_LABEL,
  WH347_STATEMENT_BLOCKING_REASON,
  WH347_STATEMENT_CITATIONS,
  WH347_STATEMENT_FOR_COUNSEL,
  buildWh347Statement,
  wh347StatementCitation,
  type Wh347StatementRecord,
} from "./wh347-statement";

const PERIOD_START = new Date("2026-09-20T00:00:00.000Z");
const PERIOD_END = new Date("2026-09-26T00:00:00.000Z");

const build = (statement: Wh347StatementRecord | null) =>
  buildWh347Statement({
    contractorName: "Ithy Drywall & Acoustics LLC",
    projectName: "Riverside Medical Office Building",
    projectLocation: "7500 Friars Rd, San Diego, CA",
    payrollNumber: 3,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    statement,
  });

const filled = (over: Partial<Wh347StatementRecord> = {}): Wh347StatementRecord => ({
  signatoryName: "Cyrus Obi",
  signatoryTitle: "Owner",
  fringeMode: "PAID_TO_PLANS",
  remarks: null,
  exceptions: [],
  ...over,
});

describe("the reproduced prose keeps saying it is unverified", () => {
  it("has not been read off a DOL page, and every entry says so", () => {
    // If this ever legitimately changes, it changes because a person opened
    // the form and read it — which is an edit to the table with a source, not
    // an edit to this assertion.
    expect(WH347_STATEMENT_CITATIONS.every((c) => c.verified === false)).toBe(true);
    expect(WH347_STATEMENT_FOR_COUNSEL).toHaveLength(WH347_STATEMENT_CITATIONS.length);
  });

  it("demands a primary DOL URL from anything claiming to be verified", () => {
    for (const citation of WH347_STATEMENT_CITATIONS) {
      if (!citation.verified) continue;
      expect(citation.primaryUrl, citation.key).toMatch(/^https:\/\/(www\.)?dol\.gov\//);
    }
  });

  it("gives every paragraph a question somebody can actually answer", () => {
    // A citation with no question is an unverified claim nobody can retire.
    for (const citation of WH347_STATEMENT_CITATIONS) {
      expect(citation.question.length, citation.key).toBeGreaterThan(20);
      expect(citation.authority.length, citation.key).toBeGreaterThan(3);
      expect(citation.primaryUrl, citation.key).toMatch(/^https:\/\//);
      expect(citation.text.length, citation.key).toBeGreaterThan(10);
    }
  });

  it("carries the paragraphs the form actually has, by key", () => {
    // The size assertion. A table that lost a paragraph would pass every
    // property above it — nothing is ever unverified in an empty list.
    const keys = WH347_STATEMENT_CITATIONS.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "opening",
        "paragraph-1",
        "paragraph-2",
        "paragraph-3",
        "paragraph-4a",
        "paragraph-4b",
        "paragraph-4c",
        "falsification-warning",
      ]),
    );
    expect(new Set(keys).size, "duplicate citation keys").toBe(keys.length);
  });

  it("names the falsification warning, because that is the whole difference from page 1", () => {
    const warning = wh347StatementCitation("falsification-warning");
    expect(warning.text).toContain("CRIMINAL PROSECUTION");
    expect(warning.authority).toContain("18 U.S.C. 1001");
  });

  it("throws on a paragraph nobody wrote rather than rendering nothing", () => {
    expect(() => wh347StatementCitation("paragraph-9")).toThrow(/no citation named/);
  });

  it("keeps the unverified prose OUT of the blocking decision", () => {
    // Deliberate, and the one thing most likely to be "fixed" by mistake.
    // Unverified prose is disclosed the way the pay app discloses G702-style;
    // it does not stop a filing. A fully recorded statement is complete even
    // though every paragraph is unverified.
    const form = build(filled());
    expect(form.proseUnverified).toBe(true);
    expect(form.blocking).toEqual([]);
    expect(form.complete).toBe(true);
  });
});

describe("the fringe election", () => {
  it("blocks while unelected, and never defaults to a section", () => {
    const form = build(filled({ fringeMode: null }));
    expect(form.fringeMode).toBeNull();
    expect(form.fringeParagraph).toBeNull();
    expect(form.blocking).toContain("fringeMode");
    expect(form.complete).toBe(false);
  });

  it("prints the elected paragraph and only that one", () => {
    const plans = build(filled({ fringeMode: "PAID_TO_PLANS" }));
    expect(plans.fringeParagraph?.key).toBe("paragraph-4a");
    expect(plans.fringeParagraph?.text).toContain("APPROVED PLANS");

    const cash = build(filled({ fringeMode: "PAID_IN_CASH" }));
    expect(cash.fringeParagraph?.key).toBe("paragraph-4b");
    expect(cash.fringeParagraph?.text).toContain("PAID IN CASH");
  });

  it("has a label and a paragraph for both modes, and no third mode", () => {
    // Two, because the form offers two. A third would be this app inventing
    // an election.
    expect(Object.keys(WH347_FRINGE_MODE_LABEL).sort()).toEqual(["PAID_IN_CASH", "PAID_TO_PLANS"]);
    expect(Object.keys(WH347_FRINGE_MODE_CITATION).sort()).toEqual([
      "PAID_IN_CASH",
      "PAID_TO_PLANS",
    ]);
    for (const key of Object.keys(WH347_FRINGE_MODE_CITATION)) {
      const citationKey = WH347_FRINGE_MODE_CITATION[key as keyof typeof WH347_FRINGE_MODE_CITATION];
      expect(() => wh347StatementCitation(citationKey)).not.toThrow();
    }
  });
});

describe("a box that looks filled in", () => {
  it("treats a missing statement row as every fact absent", () => {
    const form = build(null);
    expect(form.blocking).toEqual(["fringeMode", "signatoryName", "signatoryTitle"]);
    expect(form.complete).toBe(false);
  });

  it("treats whitespace as absent, in the name and the title", () => {
    const form = build(filled({ signatoryName: "   ", signatoryTitle: "" }));
    expect(form.signatoryName).toBeNull();
    expect(form.signatoryTitle).toBeNull();
    expect(form.blocking).toContain("signatoryName");
    expect(form.blocking).toContain("signatoryTitle");
  });

  it("trims what it prints, so no stray space reaches the form", () => {
    const form = build(filled({ signatoryName: "  Cyrus Obi  ", remarks: "  none  " }));
    expect(form.signatoryName).toBe("Cyrus Obi");
    expect(form.remarks).toBe("none");
  });

  it("blocks an exception that names a craft and explains nothing", () => {
    const form = build(
      filled({ exceptions: [{ craftName: "Drywall Installer", explanation: "   " }] }),
    );
    expect(form.exceptions).toHaveLength(1);
    expect(form.exceptions[0].explanation).toBeNull();
    expect(form.blocking).toContain("exceptionExplanation");
    expect(form.complete).toBe(false);
  });

  it("drops an exception row with no craft rather than printing a blank line", () => {
    // Somebody added a row and left it. There is nothing for a reader to act
    // on, and section 4(c) should not carry an empty line.
    const form = build(filled({ exceptions: [{ craftName: "  ", explanation: "" }] }));
    expect(form.exceptions).toEqual([]);
    expect(form.blocking).toEqual([]);
    expect(form.complete).toBe(true);
  });

  it("accepts a complete exception", () => {
    const form = build(
      filled({
        exceptions: [
          { craftName: "Drywall Installer", explanation: "Vacation paid in cash, not to the fund." },
        ],
      }),
    );
    expect(form.complete).toBe(true);
    expect(form.exceptions[0].explanation).toContain("Vacation paid in cash");
  });
});

describe("what it does not decide", () => {
  it("passes the payroll period straight through, never recomputing it", () => {
    // Page 1 and page 2 are one filing. A period derived twice is a period
    // free to disagree with itself across two pages.
    const form = build(filled());
    expect(form.periodStart).toBe(PERIOD_START);
    expect(form.periodEnd).toBe(PERIOD_END);
  });

  it("reports an unissued payroll number as null rather than inventing one", () => {
    const form = buildWh347Statement({
      contractorName: "Ithy Drywall & Acoustics LLC",
      projectName: "Riverside Medical Office Building",
      projectLocation: null,
      payrollNumber: null,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      statement: filled(),
    });
    expect(form.payrollNumber).toBeNull();
    // NOT blocking here: page 1 already blocks on payrollNumber, and two
    // blocking entries for one missing fact would report one problem twice.
    expect(form.blocking).toEqual([]);
  });

  it("has no signature of any kind on it", () => {
    // The page prints a line for wet ink. A row asserting somebody certified
    // a federal filing is a claim about a legal act.
    const form = build(filled());
    expect(Object.keys(form)).not.toContain("signedAt");
    expect(Object.keys(form)).not.toContain("signature");
    expect(Object.keys(form)).not.toContain("signedBy");
  });

  it("gives every blocking field a sentence that says what to do", () => {
    const fields = Object.keys(WH347_STATEMENT_BLOCKING_REASON);
    expect(fields.length).toBeGreaterThanOrEqual(4);
    for (const field of fields) {
      const reason = WH347_STATEMENT_BLOCKING_REASON[field as keyof typeof WH347_STATEMENT_BLOCKING_REASON];
      expect(reason.length, field).toBeGreaterThan(40);
    }
  });
});

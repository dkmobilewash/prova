// Page 2's words, and the guarantee that only one copy of them exists.
//
// Two surfaces render this text — the printed sheet and the form that
// signs it — and the whole reason the strings live in a module is that
// those two must never be able to differ. So the interesting tests here
// are not "the constant contains the sentence" (which cannot fail against
// a constant it reads from the same file). They are the SOURCE SCANS at
// the bottom, which fail if either surface starts carrying its own copy.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CERTIFIED_PAYROLL_FRINGE_METHODS } from "./actions/shared";
import {
  WH347_FALSIFICATION_WARNING,
  WH347_FRINGE_CLAUSES,
  WH347_STATEMENT_PARAGRAPH_2,
  WH347_STATEMENT_PARAGRAPH_3,
  wh347FringeClauseApplies,
  wh347StatementParagraph1,
  type Wh347FringeClauseKey,
} from "./wh347-statement";

describe("the two lettered fringe clauses", () => {
  it("prints both, always, because the paper form does", () => {
    // The defect: rendering only the clause the signer chose. An agency
    // reviewer comparing against a pre-printed WH-347 finds a form with a
    // paragraph missing, and nothing on it records that a choice was made.
    expect(WH347_FRINGE_CLAUSES.map((c) => c.key)).toEqual(["APPROVED_PLANS", "PAID_IN_CASH"]);
    expect(WH347_FRINGE_CLAUSES.map((c) => c.letter)).toEqual(["(a)", "(b)"]);
  });

  it("asserts exactly the clause the signer answered, and BOTH asserts both", () => {
    // The defect that matters most here is the quiet one: a method that
    // marks NEITHER clause. That prints a page 2 where the fringe question
    // was answered in the database and appears unanswered on the document.
    expect(wh347FringeClauseApplies("APPROVED_PLANS", "APPROVED_PLANS")).toBe(true);
    expect(wh347FringeClauseApplies("APPROVED_PLANS", "PAID_IN_CASH")).toBe(false);
    expect(wh347FringeClauseApplies("PAID_IN_CASH", "PAID_IN_CASH")).toBe(true);
    expect(wh347FringeClauseApplies("PAID_IN_CASH", "APPROVED_PLANS")).toBe(false);
    expect(wh347FringeClauseApplies("BOTH", "APPROVED_PLANS")).toBe(true);
    expect(wh347FringeClauseApplies("BOTH", "PAID_IN_CASH")).toBe(true);
  });

  it("marks at least one clause for EVERY recorded answer, iterating the enum itself", () => {
    // Iterates CERTIFIED_PAYROLL_FRINGE_METHODS -- the constant the action
    // validates against and the radio buttons are built from -- rather
    // than the keys of the map under test. A loop over the map's own keys
    // is the "loop over an empty table" test this repo already found once:
    // it passes by construction and would not notice a fourth method being
    // added with no clause mapping.
    expect(CERTIFIED_PAYROLL_FRINGE_METHODS.length).toBeGreaterThan(0);
    for (const method of CERTIFIED_PAYROLL_FRINGE_METHODS) {
      const asserted = WH347_FRINGE_CLAUSES.filter((c) => wh347FringeClauseApplies(method, c.key));
      expect(asserted.length, `${method} marks no clause on page 2`).toBeGreaterThan(0);
    }
  });

  it("never marks a clause that is not printed", () => {
    const printed = new Set<Wh347FringeClauseKey>(WH347_FRINGE_CLAUSES.map((c) => c.key));
    for (const method of CERTIFIED_PAYROLL_FRINGE_METHODS) {
      for (const key of printed) {
        if (wh347FringeClauseApplies(method, key)) expect(printed.has(key)).toBe(true);
      }
    }
    expect(printed.size).toBe(2);
  });
});

describe("paragraph (1)", () => {
  const rendered = wh347StatementParagraph1({
    contractorName: "Ridgeline Drywall Inc",
    projectName: "Maple Street Medical Office",
    periodStartLabel: "Aug 23, 2026",
    periodEndLabel: "Aug 29, 2026",
  });

  it("names the contractor, the project and BOTH ends of the period", () => {
    // The defect: dropping one of the two dates, or rendering the same one
    // twice. The paper form has a blank for each, and a payroll period
    // with one end is not a period.
    expect(rendered).toContain("Ridgeline Drywall Inc");
    expect(rendered).toContain("Maple Street Medical Office");
    expect(rendered).toContain("commencing on Aug 23, 2026");
    expect(rendered).toContain("ending on Aug 29, 2026");
  });

  it("keeps the rebates and deductions claims, which are the substance of it", () => {
    // The defect: trimming paragraph (1) to its first clause because the
    // rest is long. Those clauses are what a Copeland Act kickback case
    // turns on; a signer who was shown the short version signed something
    // else.
    expect(rendered).toContain("no rebates have been or will be made");
    expect(rendered).toContain("no deductions have been made");
    expect(rendered).toContain("40 U.S.C. § 3145");
  });

  it("substitutes its inputs rather than leaving the form's blanks", () => {
    expect(rendered).not.toContain("____");
  });
});

describe("paragraphs (2) and (3), and the warning", () => {
  it("keeps the wage-determination and classification claims of (2)", () => {
    expect(WH347_STATEMENT_PARAGRAPH_2).toContain("not less than the applicable wage rates");
    expect(WH347_STATEMENT_PARAGRAPH_2).toContain("conform with the work");
  });

  it("keeps the apprentice-registration claim of (3)", () => {
    expect(WH347_STATEMENT_PARAGRAPH_3).toContain("duly registered in a bona fide");
    expect(WH347_STATEMENT_PARAGRAPH_3).toContain("State apprenticeship agency");
  });

  it("carries the criminal-prosecution warning with its statutory citations", () => {
    // The defect: softening this to "signed under penalty of perjury", or
    // dropping it because it is shouty. The citations are what make it a
    // warning rather than a tone.
    expect(WH347_FALSIFICATION_WARNING).toContain("WILLFUL FALSIFICATION");
    expect(WH347_FALSIFICATION_WARNING).toContain("CIVIL OR CRIMINAL PROSECUTION");
    expect(WH347_FALSIFICATION_WARNING).toContain("SECTION 1001 OF TITLE 18");
    expect(WH347_FALSIFICATION_WARNING).toContain("SECTION 231 OF TITLE 31");
  });
});

/* ------------------------------------------------------------------ *
 * One copy of the statement, not two
 * ------------------------------------------------------------------ */

const SHEET = join(
  __dirname,
  "../app/(app)/jobs/[id]/certified-payroll/wh-347/page.tsx",
);
const FORM = join(__dirname, "../components/StatementOfComplianceForm.tsx");

/** Comments are stripped first. Both files EXPLAIN what page 2 says, in
 * prose, using the same words the scan looks for -- so without this the
 * check fails on its own documentation and gets "fixed" by deleting the
 * explanation. PR #176's census was disarmed by exactly that shape. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Fragments that may exist in exactly one place in this repo: here. */
const STATEMENT_FRAGMENTS = [
  /WHERE FRINGE BENEFITS ARE PAID/,
  /WILLFUL FALSIFICATION/,
  /no rebates have been/,
  /duly registered in a bona fide/,
  /not less than the applicable wage rates/,
];

describe("the sheet and the signing form render ONE statement", () => {
  it("proves the fragments match a real copy of the text, so a clean sweep means something", () => {
    // Guards the guard. A typo in any pattern below reads exactly like a
    // file with no duplicated text in it.
    const real = [
      WH347_FRINGE_CLAUSES[0].heading,
      WH347_FALSIFICATION_WARNING,
      wh347StatementParagraph1({
        contractorName: "c",
        projectName: "p",
        periodStartLabel: "s",
        periodEndLabel: "e",
      }),
      WH347_STATEMENT_PARAGRAPH_3,
      WH347_STATEMENT_PARAGRAPH_2,
    ];
    STATEMENT_FRAGMENTS.forEach((pattern, i) => {
      expect(pattern.test(real[i]), `${pattern} matches nothing in the module`).toBe(true);
    });
  });

  it("has both files to scan, at the paths this test names", () => {
    // Without this, a renamed file turns every scan below into a silent
    // pass over an empty string.
    for (const path of [SHEET, FORM]) {
      expect(stripComments(readFileSync(path, "utf8")).length, path).toBeGreaterThan(500);
    }
  });

  it("neither the sheet nor the form hard-codes any of page 2's text", () => {
    for (const path of [SHEET, FORM]) {
      const source = stripComments(readFileSync(path, "utf8"));
      for (const pattern of STATEMENT_FRAGMENTS) {
        expect(
          pattern.test(source),
          `${path} carries its own copy of page 2 (${pattern}). Two copies of a ` +
            "perjury-bearing statement drift, and then cstream shows a signer one " +
            "statement and files another under their name. Import it from lib/wh347-statement.ts.",
        ).toBe(false);
      }
    }
  });

  it("both files actually import the statement module", () => {
    // The other half. Without this, deleting every rendering of page 2
    // passes the scan above perfectly.
    for (const path of [SHEET, FORM]) {
      const source = stripComments(readFileSync(path, "utf8"));
      expect(source, path).toMatch(/from "@\/lib\/wh347-statement"/);
    }
  });
});

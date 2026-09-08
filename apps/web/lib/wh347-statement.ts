// The words on page 2 of Form WH-347 — the Statement of Compliance.
//
// A separate module from lib/wh347.ts, and from the page that prints it,
// for ONE reason: two places render this text and they must not be able to
// disagree. The sheet prints what was signed; the signing form shows what
// is about to be signed. If those two drifted, cstream would be showing a
// person one statement and filing another under their name, on a document
// carrying a criminal-prosecution warning. `wh347-statement.test.ts` scans
// both files and fails if either hard-codes any of this instead of
// importing it.
//
// The text is the federal form's own, reproduced in substance. It is a
// U.S. Government work. Two liberties are taken and both are named here
// rather than buried:
//
//   - the fill-in-the-blank rules of paragraph (1) ("commencing on the
//     ____ day of ____") are rendered as the dates themselves, because
//     cstream knows them and a blank on a filed form reads as a zero;
//   - the paper form's REMARKS box is not rendered. Nothing in cstream
//     sources it, and an empty labelled box invites somebody to believe
//     the app asked.
//
// WHAT THIS MODULE DOES NOT DO IS SOFTEN ANY OF IT. Paragraphs (1), (2)
// and (3) are substantive assertions about rebates, deductions,
// classifications and apprentice registration that cstream cannot verify
// and does not try to. They are printed in full precisely because the
// signer is the one making them: a page 2 that showed only the fringe
// question would let somebody sign three claims they were never shown.

import type { CERTIFIED_PAYROLL_FRINGE_METHODS } from "./actions/shared";

export type Wh347FringeMethod = (typeof CERTIFIED_PAYROLL_FRINGE_METHODS)[number];

/** The two lettered fringe clauses. `BOTH` is not one of these — it is an
 * answer that selects both, which is why the clause keys and the method
 * values are deliberately different types. */
export type Wh347FringeClauseKey = "APPROVED_PLANS" | "PAID_IN_CASH";

export interface Wh347FringeClause {
  key: Wh347FringeClauseKey;
  /** "(a)" or "(b)" — the letter the form and every agency call it by. */
  letter: string;
  heading: string;
  body: string;
}

/** Printed in this order, both of them, always.
 *
 * The paper form prints (a) and (b) side by side and the signer marks the
 * one that applies; it does not delete the other. Rendering only the
 * chosen clause would produce a document that looks like a different form
 * from the one an agency reviewer is holding, and would hide the fact that
 * a choice was made at all. So both are printed and the applicable one is
 * marked — see `wh347FringeClauseApplies`.
 */
export const WH347_FRINGE_CLAUSES: readonly Wh347FringeClause[] = [
  {
    key: "APPROVED_PLANS",
    letter: "(a)",
    heading: "WHERE FRINGE BENEFITS ARE PAID TO APPROVED PLANS, FUNDS, OR PROGRAMS",
    body:
      "In addition to the basic hourly wage rates paid to each laborer or mechanic listed in the above referenced payroll, payments of fringe benefits as listed in the contract have been or will be made to appropriate programs for the benefit of such employees, except as noted in section 4(c) below.",
  },
  {
    key: "PAID_IN_CASH",
    letter: "(b)",
    heading: "WHERE FRINGE BENEFITS ARE PAID IN CASH",
    body:
      "Each laborer or mechanic listed in the above referenced payroll has been paid, as indicated on the payroll, an amount not less than the sum of the applicable basic hourly wage rate plus the amount of the required fringe benefits as listed in the contract, except as noted in section 4(c) below.",
  },
];

/** Which lettered clauses each recorded answer asserts.
 *
 * A `Record` keyed by the method union rather than a `switch` or an
 * `includes`, so a fourth value added to
 * `CERTIFIED_PAYROLL_FRINGE_METHODS` is a TYPE ERROR here rather than a
 * clause that silently stops being printed on a filed federal form.
 */
const CLAUSES_ASSERTED_BY: Record<Wh347FringeMethod, readonly Wh347FringeClauseKey[]> = {
  APPROVED_PLANS: ["APPROVED_PLANS"],
  PAID_IN_CASH: ["PAID_IN_CASH"],
  BOTH: ["APPROVED_PLANS", "PAID_IN_CASH"],
};

export function wh347FringeClauseApplies(
  method: Wh347FringeMethod,
  clause: Wh347FringeClauseKey,
): boolean {
  return CLAUSES_ASSERTED_BY[method].includes(clause);
}

/** Paragraph (1). The only one carrying names and dates, so it is a
 * function and the other two are constants. */
export function wh347StatementParagraph1(input: {
  contractorName: string;
  projectName: string;
  periodStartLabel: string;
  periodEndLabel: string;
}): string {
  return (
    `That I pay or supervise the payment of the persons employed by ${input.contractorName} ` +
    `on the ${input.projectName}; that during the payroll period commencing on ` +
    `${input.periodStartLabel} and ending on ${input.periodEndLabel}, all persons employed on ` +
    "said project have been paid the full weekly wages earned, that no rebates have been or " +
    "will be made either directly or indirectly to or on behalf of said contractor or " +
    "subcontractor from the full weekly wages earned by any person, and that no deductions " +
    "have been made either directly or indirectly from the full wages earned by any person, " +
    "other than permissible deductions as defined in Regulations, Part 3 (29 C.F.R. Subtitle " +
    "A), issued by the Secretary of Labor under the Copeland Act, as amended (40 U.S.C. " +
    "§ 3145)."
  );
}

export const WH347_STATEMENT_PARAGRAPH_2 =
  "That any payrolls otherwise under this contract required to be submitted for the above " +
  "period are correct and complete; that the wage rates for laborers or mechanics contained " +
  "therein are not less than the applicable wage rates contained in any wage determination " +
  "incorporated into the contract; that the classifications set forth therein for each " +
  "laborer or mechanic conform with the work he or she performed.";

export const WH347_STATEMENT_PARAGRAPH_3 =
  "That any apprentices employed in the above period are duly registered in a bona fide " +
  "apprenticeship program registered with a State apprenticeship agency recognized by the " +
  "Office of Apprenticeship, United States Department of Labor, or if no such recognized " +
  "agency exists in a State, are registered with the Office of Apprenticeship, United States " +
  "Department of Labor.";

/** The line that makes this a perjury-bearing document rather than a
 * summary. Printed on the sheet AND above the submit button.
 *
 * It is the reason every other decision in this area looks over-careful —
 * the entered signature date, the counter-issued payroll number, the
 * absence of an edit path. Anyone loosening one of those should have read
 * this sentence first, which is why it is a named export rather than a
 * string literal in a JSX file. */
export const WH347_FALSIFICATION_WARNING =
  "THE WILLFUL FALSIFICATION OF ANY OF THE ABOVE STATEMENTS MAY SUBJECT THE CONTRACTOR OR " +
  "SUBCONTRACTOR TO CIVIL OR CRIMINAL PROSECUTION. SEE SECTION 1001 OF TITLE 18 AND SECTION " +
  "231 OF TITLE 31 OF THE UNITED STATES CODE.";

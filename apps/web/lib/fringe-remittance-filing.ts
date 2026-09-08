// What a fringe remittance still needs before it can be put in an
// envelope — enumerated, so the document can refuse to look finished.
//
// lib/fringe-remittance.ts computes the money and, since the member
// dimension landed, WHO the hours belong to. That is the whole of the
// arithmetic and none of the paperwork. A trust fund's remittance form
// also carries things cstream has never held a field for: the account
// number that fund issued this employer, the address the report and the
// cheque are actually sent to, and the member number each person is
// credited under. None of those can be derived from hours.
//
// The failure this module exists to prevent is a sheet that LOOKS
// complete. A blank on a remittance is indistinguishable from a zero, and
// a zero on a remittance is a statement to a trust fund that nothing is
// owed for that fund or that person. So every gap is carried as DATA —
// a named field with a sentence — rather than rendered as a dash by the
// page, which lets the page print it in place, lets a banner enumerate
// all of them, and lets a test assert on WHICH field is missing. Same
// shape and same reasoning as WH347_BLOCKING_FIELD_REASON in lib/wh347.ts.
//
// Everything here is per LOCAL, because one hall gets one report and one
// cheque. A field that is missing on Local 300's sheet is not thereby
// missing on Local 12's — a company can have a name recorded for every
// member who worked under one hall and not the other — and a combined
// "what's missing" list across halls would be a list about a document
// nobody sends.

import type { RemittanceLocalRow } from "./fringe-remittance";

/**
 * A field a real remittance carries that this sheet cannot fill in.
 *
 * Two kinds, deliberately in one type because the reader's question is
 * "what stops me sending this", not "whose fault is it":
 *
 *   - STRUCTURAL — cstream holds no field for it at all, so it is missing
 *     on every sheet ever printed until somebody models it.
 *   - RECORDED-BUT-EMPTY — the field exists and nobody has filled it in,
 *     so it is missing on this company's sheets and not on another's.
 */
export type RemittanceBlockingField =
  | "employerAddress"
  | "employerEin"
  | "fundEmployerNumber"
  | "fundRemitAddress"
  | "memberIdNumber"
  | "memberName"
  | "unpricedHours"
  | "duesCheckoff";

/**
 * Printed order. Fixed and declared rather than derived from whatever
 * order the checks below happen to run in, so the same month prints the
 * same sheet twice and a diff between two prints means something changed.
 */
/** The one order these are printed in, so two prints of a month match.
 * Exported because a test must be able to iterate what the page can
 * EMIT — iterating the reason table instead proves nothing about a
 * field the table is missing, and that gap printed `undefined` into a
 * red blocking-field box before it was closed. */
export const REMITTANCE_FIELD_ORDER: RemittanceBlockingField[] = [
  "employerAddress",
  "employerEin",
  "fundEmployerNumber",
  "fundRemitAddress",
  "memberIdNumber",
  "memberName",
  "unpricedHours",
  "duesCheckoff",
];

/**
 * Sentences, not labels.
 *
 * A label ("Fund account number") tells a reader what is absent. A
 * sentence tells them what to do about it and what happens if they send
 * it anyway, which is the only version anybody acts on. Same call
 * lib/worker-name.ts makes with "Name not recorded".
 */
export const REMITTANCE_BLOCKING_FIELD_REASON: Record<RemittanceBlockingField, string> = {
  employerAddress:
    "No address is recorded on the company record. A fund matches a report to an employer by name and address, and an unaddressed report is one somebody has to phone about. Settings → Company.",
  employerEin:
    "No EIN is recorded on the company record. Most funds key the employer's account to it, and it is what a delinquency notice quotes back at you. Settings → Company.",
  fundEmployerNumber:
    "Each trust fund issues this employer its own account number and prints it at the top of that fund's report. cstream records no fund account numbers, so every fund line below is unnumbered — copy them from last month's report before sending.",
  fundRemitAddress:
    "Each fund's report and cheque go to that fund's own address, which is usually a third-party administrator rather than the hall itself. cstream records no fund addresses, so there is nothing here to address an envelope from.",
  memberIdNumber:
    "A fund credits hours to a member by their member number, not by their name. cstream records no member identifiers, so every line below identifies a person by name alone and the fund will have to match them by hand.",
  memberName:
    "At least one member on this report has no name recorded on their account. A fund cannot credit hours to \"Name not recorded\", and those hours sit uncredited against that person's vesting and their health & welfare eligibility.",
  unpricedHours:
    "Some hours on this report have no rate schedule in force on the day they were worked. They are shown as unpriced rather than as $0.00, and the total below is short by whatever they turn out to be worth.",
  duesCheckoff:
    "Many halls collect working dues and other wage deductions on this same report. cstream does not model them, so this sheet covers employer fringe contributions only — check the hall's own form before sending.",
};

/** The parts of `Company` a remittance header prints. Structural rather
 * than the Prisma row, so the rule is testable without a database and so
 * this module cannot quietly start reading a field nobody meant it to. */
export interface RemittanceFilingCompany {
  name: string;
  dbaName: string | null;
  hqAddressLine1: string | null;
  hqAddressLine2: string | null;
  hqCity: string | null;
  hqState: string | null;
  hqZip: string | null;
  ein: string | null;
}

/**
 * The employer's address as printed lines, or null when it is not
 * complete enough to print.
 *
 * ALL FOUR of line 1, city, state and zip are required, and a partial
 * address is treated as no address at all. That is the deliberate part: a
 * header reading "1400 Industrial Way" with no city looks like a
 * formatting bug and gets sent, whereas the red sentence this null
 * produces gets fixed. Line 2 is genuinely optional — plenty of addresses
 * have no suite number — so its absence is not a gap.
 */
export function employerAddressLines(company: RemittanceFilingCompany): string[] | null {
  const line1 = company.hqAddressLine1?.trim();
  const city = company.hqCity?.trim();
  const state = company.hqState?.trim();
  const zip = company.hqZip?.trim();
  if (!line1 || !city || !state || !zip) return null;

  const line2 = company.hqAddressLine2?.trim();
  return [line1, ...(line2 ? [line2] : []), `${city}, ${state} ${zip}`];
}

/**
 * Every field this local's sheet cannot fill in, in printing order.
 *
 * Never empty: `fundEmployerNumber`, `fundRemitAddress`, `memberIdNumber`
 * and `duesCheckoff` are structural and hold on every sheet, so a caller
 * that renders "ready to file" when this returns nothing would be
 * rendering a state that cannot occur. That is on purpose — this report
 * is a prepared draft an office manager completes, and the honest
 * document says so rather than implying an envelope can be sealed on it.
 */
export function remittanceBlockingFields(
  company: RemittanceFilingCompany,
  local: RemittanceLocalRow,
): RemittanceBlockingField[] {
  const missing = new Set<RemittanceBlockingField>([
    "fundEmployerNumber",
    "fundRemitAddress",
    "memberIdNumber",
    "duesCheckoff",
  ]);

  if (employerAddressLines(company) === null) missing.add("employerAddress");
  if (!company.ein?.trim()) missing.add("employerEin");

  // Checked across every classification on the sheet, not just the first:
  // one person with no name recorded makes the whole report unfileable,
  // and they are as likely to be on the last craft row as the first.
  const anyNameMissing = local.crafts.some((craft) =>
    craft.employees.some((employee) => employee.nameMissing),
  );
  if (anyNameMissing) missing.add("memberName");

  if (local.uncomputedHours > 0) missing.add("unpricedHours");

  return REMITTANCE_FIELD_ORDER.filter((field) => missing.has(field));
}

// The G702 / G703 as a DOCUMENT: every figure the two sheets print, in the
// order and under the label they print it, derived once from
// lib/pay-application.ts and handed to two renderers — the page and the PDF.
//
// Pure. No Prisma, no React, no pdf-lib. The page passes this object to the
// download button as a prop, so it has to be plain data, and the test for
// the PDF reads the drawn strings back out of the bytes and compares them
// with what this function says they should be.
//
// WHAT IS AND IS NOT COMPUTED HERE. Lines 3–9 are the engine's own numbers,
// untouched. Line 1 (original contract sum) is the ONE figure the engine
// does not have: it is line 3 minus line 2, where line 2 is the net value
// of the job's approved change orders from `changeOrderValueDelta` — the
// same function the estimate tab prints. That keeps the form's own identity
// (line 3 = line 1 + line 2) true by construction rather than by hoping two
// separate reads agree. Retainage is printed as the TOTAL (line 5) only: the
// per-invoice snapshots are the source of truth and nothing here reaches for
// a rate to split them into 5a/5b, which is why those two sub-lines are
// blank fields on the sheet. Column I of the G703 (retainage, if variable
// rate) is blank for the same reason.

import type { PayAppLineItemResult, PayAppSummaryResult } from "@/lib/pay-application";

export interface G702Party {
  name: string;
  /** Address and phone, one per line, blanks already dropped. */
  lines: string[];
}

export interface G702Header {
  project: string;
  projectLocation: string | null;
  /** On a subcontractor's application the GC sits in the TO slot. */
  to: G702Party;
  from: G702Party;
  contractFor: string | null;
  applicationNumber: number;
  /** Already rendered for the reader — the page decides the zone, not this
   * module, which has no clock and no cookie. */
  applicationDate: string;
  /** Rendered calendar day, or null for an application that predates the
   * column. The sheet then prints a blank to be written in, never a guess. */
  periodTo: string | null;
  contractDate: string | null;
  projectNumber: string | null;
}

export interface G702Input {
  header: G702Header;
  lineItems: PayAppLineItemResult[];
  summary: PayAppSummaryResult;
  /** SUM of `changeOrderValueDelta` over the job's APPROVED change orders. */
  netChangeByChangeOrders: number;
}

/** The nine numbered lines of the G702, in form order. ONE list, read by
 * the page and the PDF, so the two cannot label a figure differently — and
 * the e2e rehearsal asserts several of these labels by exact text. */
export const G702_LINES = [
  { key: "originalContractSum", number: "1", label: "Original contract sum" },
  { key: "netChangeByChangeOrders", number: "2", label: "Net change by change orders" },
  { key: "contractSumToDate", number: "3", label: "Contract sum to date" },
  { key: "totalCompletedAndStoredToDate", number: "4", label: "Total completed & stored to date" },
  { key: "retainageToDate", number: "5", label: "Retainage to date" },
  { key: "totalEarnedLessRetainage", number: "6", label: "Total earned less retainage" },
  { key: "previousCertificatesForPayment", number: "7", label: "Less previous certificates for payment" },
  { key: "currentPaymentDue", number: "8", label: "Current payment due" },
  { key: "balanceToFinishIncludingRetainage", number: "9", label: "Balance to finish, including retainage" },
] as const;

export type G702LineKey = (typeof G702_LINES)[number]["key"];

export interface G703Row {
  /** Column A. The row's position on the sheet, 1-based. */
  itemNo: number;
  /** Column B. */
  description: string;
  /** Column C. */
  scheduledValue: number;
  /** Column D — work completed from previous applications. */
  fromPrevious: number;
  /** Column E — work completed this period. */
  thisPeriod: number;
  /** Column F — materials presently stored, not in D or E. The RUNNING
   * stored balance (`materialsStoredToDate`), not this period's delta: the
   * form's column G is D + E + F, and only the running figure makes that
   * identity hold. Mapping the delta here is the exact mistake the engine's
   * own header warns about. */
  materialsStored: number;
  /** Column G = D + E + F. */
  totalCompletedAndStored: number;
  /** G ÷ C as a 0–1 ratio, null when C is zero. */
  percent: number | null;
  /** Column H = C − G. */
  balanceToFinish: number;
}

export interface G703Totals {
  scheduledValue: number;
  fromPrevious: number;
  thisPeriod: number;
  materialsStored: number;
  totalCompletedAndStored: number;
  percent: number | null;
  balanceToFinish: number;
}

export interface G702Document {
  header: G702Header;
  lines: Record<G702LineKey, number>;
  continuation: { rows: G703Row[]; totals: G703Totals };
}

export function g702Document(input: G702Input): G702Document {
  const { summary } = input;
  const lines: Record<G702LineKey, number> = {
    originalContractSum: summary.contractSumToDate - input.netChangeByChangeOrders,
    netChangeByChangeOrders: input.netChangeByChangeOrders,
    contractSumToDate: summary.contractSumToDate,
    totalCompletedAndStoredToDate: summary.totalCompletedAndStoredToDate,
    retainageToDate: summary.retainageToDate,
    totalEarnedLessRetainage: summary.totalEarnedLessRetainage,
    previousCertificatesForPayment: summary.previousCertificatesForPayment,
    currentPaymentDue: summary.currentPaymentDue,
    balanceToFinishIncludingRetainage: summary.balanceToFinishIncludingRetainage,
  };

  const rows: G703Row[] = input.lineItems.map((item, index) => ({
    itemNo: index + 1,
    description: item.description,
    scheduledValue: item.scheduledValue,
    fromPrevious: item.previousBilled,
    thisPeriod: item.thisPeriodBilled,
    materialsStored: item.materialsStoredToDate,
    totalCompletedAndStored: item.totalCompletedAndStoredToDate,
    percent: item.percentOfScheduledValue,
    balanceToFinish: item.balanceToFinish,
  }));

  const sum = (pick: (row: G703Row) => number) => rows.reduce((acc, row) => acc + pick(row), 0);
  const scheduledValue = sum((r) => r.scheduledValue);
  const totalCompletedAndStored = sum((r) => r.totalCompletedAndStored);
  const totals: G703Totals = {
    scheduledValue,
    fromPrevious: sum((r) => r.fromPrevious),
    thisPeriod: sum((r) => r.thisPeriod),
    materialsStored: sum((r) => r.materialsStored),
    totalCompletedAndStored,
    percent: scheduledValue > 0 ? totalCompletedAndStored / scheduledValue : null,
    balanceToFinish: sum((r) => r.balanceToFinish),
  };

  return { header: input.header, lines, continuation: { rows, totals } };
}

/** `0.6` → "60.0%". One place, because the page used to own this and the
 * PDF would otherwise grow its own. */
export function formatPercent(ratio: number | null): string {
  return ratio != null ? `${(ratio * 100).toFixed(1)}%` : "";
}

/** Name and address lines for a party block, blanks dropped. */
export function party(name: string, ...lines: Array<string | null | undefined>): G702Party {
  return {
    name,
    lines: lines.map((line) => (line ?? "").trim()).filter((line) => line.length > 0),
  };
}

import { describe, expect, it } from "vitest";
import {
  calculatePayAppLineItem,
  calculatePayAppSummary,
  type PayAppLineItemInput,
} from "@/lib/pay-application";
import { formatPercent, g702Document, G702_LINES, party, type G702Input } from "./g702";

/**
 * The G702/G703 document is a MAPPING from the engine's figures to the
 * form's cells, and a mapping is exactly the thing that can be wrong while
 * every number in it is right: column F filled from this period's stored
 * DELTA instead of the running balance would make G stop equalling D+E+F
 * on every application after the first, and the sheet would still look
 * like a sheet. So the fixture is built THROUGH the engine, with a line
 * whose delta and running balance differ, and every cell is checked
 * against the engine field it must come from.
 */

const INPUTS: PayAppLineItemInput[] = [
  // Ordinary line, second application.
  {
    lineItemId: "framing",
    description: "Metal stud framing",
    scheduledValue: 100_000,
    previousBilled: 40_000,
    thisPeriodBilled: 25_000,
    previousMaterialsStored: 0,
    materialsStoredValue: 0,
  },
  // Stored material: $12,000 stored last period, $3,000 released this
  // period, so the delta is -3,000 and the running balance is 9,000. The
  // two MUST land in different cells.
  {
    lineItemId: "board",
    description: "Gypsum board",
    scheduledValue: 60_000,
    previousBilled: 10_000,
    thisPeriodBilled: 3_000,
    previousMaterialsStored: 12_000,
    materialsStoredValue: -3_000,
  },
  // A cost-only line with no contract value: percent is null, not NaN.
  {
    lineItemId: "gc",
    description: "General conditions",
    scheduledValue: 0,
    previousBilled: 0,
    thisPeriodBilled: 0,
    previousMaterialsStored: 0,
    materialsStoredValue: 0,
  },
];

const lineItems = INPUTS.map(calculatePayAppLineItem);
const summary = calculatePayAppSummary({
  lineItems,
  previousRetainageWithheld: 6_200,
  thisPeriodRetainageWithheld: 2_500,
});

const input: G702Input = {
  header: {
    project: "Riverside Clinic",
    projectLocation: "12 River Rd",
    to: party("Acme General", "1 Main St"),
    from: party("Drywall Co", "9 Shop Ln", null, "Phone 555-0100"),
    contractFor: "Framing and drywall",
    applicationNumber: 2,
    applicationDate: "Oct 30, 2026",
    periodTo: "Oct 31, 2026",
    contractDate: null,
    projectNumber: "SC-44",
  },
  lineItems,
  summary,
  netChangeByChangeOrders: 15_000,
};

describe("the G702 lines", () => {
  const { lines } = g702Document(input);

  it("are the engine's summary, line for line", () => {
    expect(lines.contractSumToDate).toBe(summary.contractSumToDate);
    expect(lines.totalCompletedAndStoredToDate).toBe(summary.totalCompletedAndStoredToDate);
    expect(lines.retainageToDate).toBe(summary.retainageToDate);
    expect(lines.totalEarnedLessRetainage).toBe(summary.totalEarnedLessRetainage);
    expect(lines.previousCertificatesForPayment).toBe(summary.previousCertificatesForPayment);
    expect(lines.currentPaymentDue).toBe(summary.currentPaymentDue);
    expect(lines.balanceToFinishIncludingRetainage).toBe(summary.balanceToFinishIncludingRetainage);
  });

  it("foot: line 1 plus line 2 is line 3, with line 2 the approved change orders", () => {
    expect(lines.netChangeByChangeOrders).toBe(15_000);
    expect(lines.originalContractSum + lines.netChangeByChangeOrders).toBeCloseTo(lines.contractSumToDate, 2);
    expect(lines.originalContractSum).toBe(160_000 - 15_000);
  });

  it("carry the labels the rehearsal reads by exact text, in form order", () => {
    expect(G702_LINES.map((l) => l.label)).toEqual([
      "Original contract sum",
      "Net change by change orders",
      "Contract sum to date",
      "Total completed & stored to date",
      "Retainage to date",
      "Total earned less retainage",
      "Less previous certificates for payment",
      "Current payment due",
      "Balance to finish, including retainage",
    ]);
    expect(G702_LINES.map((l) => l.number)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });
});

describe("the G703 continuation sheet", () => {
  const { continuation } = g702Document(input);
  const [framing, board, gc] = continuation.rows;

  it("numbers the rows A and keeps the engine's description", () => {
    expect(continuation.rows.map((r) => r.itemNo)).toEqual([1, 2, 3]);
    expect(board.description).toBe("Gypsum board");
  });

  it("fills C, D, E from scheduled value, previous billed and this period", () => {
    expect(framing.scheduledValue).toBe(100_000);
    expect(framing.fromPrevious).toBe(40_000);
    expect(framing.thisPeriod).toBe(25_000);
  });

  it("fills F with the RUNNING stored balance, never this period's delta", () => {
    // 12,000 stored before, 3,000 released now: the sheet shows 9,000.
    expect(board.materialsStored).toBe(9_000);
    expect(board.materialsStored).toBe(lineItems[1].materialsStoredToDate);
    expect(board.materialsStored).not.toBe(INPUTS[1].materialsStoredValue);
  });

  it("holds the form's own identities on every row: G = D + E + F, H = C - G, % = G / C", () => {
    for (const row of continuation.rows) {
      expect(row.totalCompletedAndStored).toBeCloseTo(row.fromPrevious + row.thisPeriod + row.materialsStored, 2);
      expect(row.balanceToFinish).toBeCloseTo(row.scheduledValue - row.totalCompletedAndStored, 2);
      if (row.scheduledValue > 0) expect(row.percent).toBeCloseTo(row.totalCompletedAndStored / row.scheduledValue, 6);
    }
    expect(board.totalCompletedAndStored).toBe(22_000);
    expect(board.percent).toBeCloseTo(22_000 / 60_000, 6);
    expect(gc.percent).toBeNull();
  });

  it("totals foot to the G702: column C to line 3, column G to line 4", () => {
    expect(continuation.totals.scheduledValue).toBe(summary.contractSumToDate);
    expect(continuation.totals.totalCompletedAndStored).toBe(summary.totalCompletedAndStoredToDate);
    expect(continuation.totals.fromPrevious).toBe(50_000);
    expect(continuation.totals.thisPeriod).toBe(28_000);
    expect(continuation.totals.materialsStored).toBe(9_000);
    expect(continuation.totals.balanceToFinish).toBeCloseTo(160_000 - 87_000, 2);
    expect(continuation.totals.percent).toBeCloseTo(87_000 / 160_000, 6);
  });

  it("gives a null total percent when the whole sheet has no contract value", () => {
    const empty = g702Document({ ...input, lineItems: [lineItems[2]], summary: calculatePayAppSummary({ lineItems: [lineItems[2]], previousRetainageWithheld: 0, thisPeriodRetainageWithheld: 0 }) });
    expect(empty.continuation.totals.percent).toBeNull();
  });
});

describe("the small helpers", () => {
  it("formats a ratio as the one-decimal percent the page always printed, and nothing for null", () => {
    expect(formatPercent(0.6)).toBe("60.0%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(null)).toBe("");
  });

  it("drops blank address lines from a party block", () => {
    expect(party("Drywall Co", "", null, undefined, "  9 Shop Ln ", "Phone 555")).toEqual({
      name: "Drywall Co",
      lines: ["9 Shop Ln", "Phone 555"],
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  quickBooksSideFrom,
  reconcileAll,
  reconcileInvoice,
  summarizeReconciliation,
  type ProvaInvoiceSide,
  type QuickBooksInvoiceSide,
} from "./quickbooks-reconcile";

const ours = (over: Partial<ProvaInvoiceSide> = {}): ProvaInvoiceSide => ({
  invoiceId: "inv-1",
  number: 1,
  jobName: "Riverside Medical",
  totalCents: 123_45,
  qboId: "145",
  lastVerifiedAt: new Date("2026-08-30T03:09:00.000Z"),
  ...over,
});

const theirs = (over: Partial<QuickBooksInvoiceSide> = {}): QuickBooksInvoiceSide => ({
  qboId: "145",
  totalCents: 123_45,
  docNumber: "ABC123-1",
  voided: false,
  ...over,
});

describe("reconcileInvoice", () => {
  it("agrees when both sides hold the same money", () => {
    const result = reconcileInvoice(ours(), theirs());
    expect(result.status).toBe("MATCHES");
    expect(result.differences).toEqual([]);
  });

  it("catches the real case: edited in QuickBooks, unchanged here", () => {
    // The incident this view exists for. $123.45 in Prova, $200.00 in
    // QuickBooks, and nothing anywhere said so.
    const result = reconcileInvoice(ours({ totalCents: 123_45 }), theirs({ totalCents: 200_00 }));
    expect(result.status).toBe("DIFFERS");
    expect(result.differences[0]).toContain("$123.45");
    expect(result.differences[0]).toContain("$200.00");
  });

  it("reports an invoice QuickBooks no longer has", () => {
    // Deleted there. We still hold a link pointing at nothing.
    const result = reconcileInvoice(ours(), null);
    expect(result.status).toBe("MISSING_IN_QUICKBOOKS");
    expect(result.theirTotalCents).toBeNull();
  });

  it("treats a voided invoice as a difference, not as missing", () => {
    // QuickBooks keeps voided invoices at zero rather than deleting them,
    // so "it's gone" would be the wrong thing to tell someone.
    const result = reconcileInvoice(ours(), theirs({ voided: true, totalCents: 0 }));
    expect(result.status).toBe("DIFFERS");
    expect(result.differences.some((d) => d.includes("voided"))).toBe(true);
  });

  it("reports both problems at once when a void also changed the total", () => {
    const result = reconcileInvoice(ours(), theirs({ voided: true, totalCents: 0 }));
    expect(result.differences).toHaveLength(2);
  });

  it("calls a never-pushed invoice never sent, not a disagreement", () => {
    const result = reconcileInvoice(ours({ qboId: null }), null);
    expect(result.status).toBe("NEVER_SENT");
    expect(result.differences).toEqual([]);
  });

  it("says nothing about a document number QuickBooks reassigned", () => {
    // Deliberately not compared: it is not money, and flagging it would
    // put noise above the rows that matter.
    expect(reconcileInvoice(ours(), theirs({ docNumber: "999" })).status).toBe("MATCHES");
  });
});

describe("reconcileAll — order is the feature", () => {
  it("puts disagreements first, then missing, then unsent, then fine", () => {
    const rows = reconcileAll(
      [
        ours({ invoiceId: "d", number: 4, qboId: "4" }),
        ours({ invoiceId: "a", number: 1, qboId: "1", totalCents: 100_00 }),
        ours({ invoiceId: "c", number: 3, qboId: null }),
        ours({ invoiceId: "b", number: 2, qboId: "2" }),
      ],
      new Map([
        ["4", theirs({ qboId: "4" })],
        ["1", theirs({ qboId: "1", totalCents: 500_00 })],
        // "2" absent — deleted in QuickBooks
      ]),
    );
    expect(rows.map((r) => r.status)).toEqual([
      "DIFFERS",
      "MISSING_IN_QUICKBOOKS",
      "NEVER_SENT",
      "MATCHES",
    ]);
  });

  it("puts the biggest money gap first among disagreements", () => {
    // A $4,000 gap must not sit below a $2 one by accident.
    const rows = reconcileAll(
      [
        ours({ invoiceId: "small", number: 1, qboId: "1", totalCents: 100_00 }),
        ours({ invoiceId: "big", number: 2, qboId: "2", totalCents: 100_00 }),
      ],
      new Map([
        ["1", theirs({ qboId: "1", totalCents: 102_00 })],
        ["2", theirs({ qboId: "2", totalCents: 4_100_00 })],
      ]),
    );
    expect(rows[0].invoiceId).toBe("big");
  });

  it("has nothing to say about no invoices", () => {
    expect(reconcileAll([], new Map())).toEqual([]);
  });
});

describe("summarizeReconciliation", () => {
  it("counts each state and only calls it agreed when nothing needs a human", () => {
    const rows = reconcileAll(
      [
        ours({ invoiceId: "a", qboId: "1", totalCents: 100_00 }),
        ours({ invoiceId: "b", qboId: "2" }),
        ours({ invoiceId: "c", qboId: null }),
      ],
      new Map([["1", theirs({ qboId: "1", totalCents: 200_00 })]]),
    );
    const summary = summarizeReconciliation(rows);
    expect(summary).toMatchObject({ differs: 1, missing: 1, neverSent: 1, matches: 0, total: 3 });
    expect(summary.allAgree).toBe(false);
  });

  it("an unsent invoice alone does not make things disagree", () => {
    // Never pushed is a choice, not a drift.
    const rows = reconcileAll([ours({ qboId: null })], new Map());
    expect(summarizeReconciliation(rows).allAgree).toBe(true);
  });
});

describe("quickBooksSideFrom", () => {
  it("reads the shape QuickBooks actually returns", () => {
    expect(quickBooksSideFrom({ Id: "145", TotalAmt: 123.45, DocNumber: "ABC-1" })).toEqual({
      qboId: "145",
      totalCents: 12345,
      docNumber: "ABC-1",
      voided: false,
    });
  });

  it("treats a missing total as zero rather than NaN", () => {
    expect(quickBooksSideFrom({ Id: "1" }).totalCents).toBe(0);
  });

  it("spots a void, which QuickBooks marks in the note rather than a field", () => {
    expect(quickBooksSideFrom({ Id: "1", PrivateNote: "Voided" }).voided).toBe(true);
    expect(quickBooksSideFrom({ Id: "1", PrivateNote: "VOIDED by JS" }).voided).toBe(true);
    expect(quickBooksSideFrom({ Id: "1", PrivateNote: "Riverside job" }).voided).toBe(false);
  });
});

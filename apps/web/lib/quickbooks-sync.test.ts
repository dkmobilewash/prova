import { describe, expect, it } from "vitest";
import {
  amountToCents,
  buildInvoicePayload,
  centsToAmount,
  docNumberFor,
  idempotencyKeyFor,
  pushBlockers,
  verifyPushedInvoice,
  type InvoiceToPush,
} from "./quickbooks-sync";

const invoice = (over: Partial<InvoiceToPush> = {}): InvoiceToPush => ({
  invoiceId: "clx0000000000abc123",
  number: 3,
  jobName: "Riverside Medical — Level 4",
  customerQboId: "58",
  issuedOn: "2026-08-29",
  dueOn: "2026-09-28",
  memo: null,
  totalCents: 1_234_50,
  retainageWithheldCents: 0,
  lines: [],
  ...over,
});

const line = (over: Partial<InvoiceToPush["lines"][number]> = {}) => ({
  lineItemId: "line-1",
  description: '5/8" Type X board',
  billedCents: 100_000,
  materialsStoredCents: 0,
  ...over,
});

describe("money never travels as a float", () => {
  it("round-trips cents through QuickBooks amounts", () => {
    expect(centsToAmount(1_234_50)).toBe(1234.5);
    expect(amountToCents(1234.5)).toBe(123450);
    expect(amountToCents(0.1 + 0.2)).toBe(30); // the oldest bug in accounting
  });
});

describe("docNumberFor", () => {
  it("keeps two jobs' invoice 1 distinct", () => {
    // Our numbers are scoped per job; QuickBooks DocNumber is company-wide,
    // so two jobs both billing invoice 1 would otherwise collide.
    const a = docNumberFor({ invoiceId: "clx000000000job_aaa", number: 1 });
    const b = docNumberFor({ invoiceId: "clx000000000job_bbb", number: 1 });
    expect(a).not.toBe(b);
  });

  it("is stable for the same invoice", () => {
    const i = { invoiceId: "clx0000000000abc123", number: 3 };
    expect(docNumberFor(i)).toBe(docNumberFor(i));
  });
});

describe("idempotencyKeyFor — the defence against double-posting", () => {
  it("is identical for a retry of the same push", () => {
    // A network timeout and its retry must not create two invoices. This is
    // the exact failure the research documents across six platforms.
    expect(idempotencyKeyFor(invoice({ lines: [line()] }))).toBe(
      idempotencyKeyFor(invoice({ lines: [line()] })),
    );
  });

  it("changes when the money changes", () => {
    const before = idempotencyKeyFor(invoice({ totalCents: 100_000, lines: [line()] }));
    const after = idempotencyKeyFor(
      invoice({ totalCents: 150_000, lines: [line({ billedCents: 150_000 })] }),
    );
    expect(before).not.toBe(after);
  });

  it("changes when a line's stored materials change, at the same total", () => {
    // Same money overall, different split — still a different document.
    const a = idempotencyKeyFor(
      invoice({ lines: [line({ billedCents: 100_000, materialsStoredCents: 0 })] }),
    );
    const b = idempotencyKeyFor(
      invoice({ lines: [line({ billedCents: 60_000, materialsStoredCents: 40_000 })] }),
    );
    expect(a).not.toBe(b);
  });

  it("does not change when the same lines arrive in a different order", () => {
    const one = line({ lineItemId: "a", billedCents: 100 });
    const two = line({ lineItemId: "b", billedCents: 200 });
    expect(idempotencyKeyFor(invoice({ lines: [one, two] }))).toBe(
      idempotencyKeyFor(invoice({ lines: [two, one] })),
    );
  });

  it("is different for two different invoices with identical money", () => {
    expect(idempotencyKeyFor(invoice({ invoiceId: "one", lines: [line()] }))).not.toBe(
      idempotencyKeyFor(invoice({ invoiceId: "two", lines: [line()] })),
    );
  });
});

describe("buildInvoicePayload", () => {
  it("bills work completed and materials stored as SEPARATE lines", () => {
    // Two columns on a G703. Folding them together makes the pay
    // application the GC signed and the ledger disagree.
    const payload = buildInvoicePayload(
      invoice({ lines: [line({ billedCents: 60_000, materialsStoredCents: 40_000 })] }),
    );
    expect(payload.Line).toHaveLength(2);
    expect(payload.Line[0].Amount).toBe(600);
    expect(payload.Line[1].Description).toContain("materials stored");
    expect(payload.Line[1].Amount).toBe(400);
  });

  it("omits a line that is zero rather than sending a zero line", () => {
    const payload = buildInvoicePayload(
      invoice({ lines: [line({ billedCents: 100_000, materialsStoredCents: 0 })] }),
    );
    expect(payload.Line).toHaveLength(1);
  });

  it("falls back to one line for a lump-sum invoice with no breakdown", () => {
    const payload = buildInvoicePayload(invoice({ lines: [], totalCents: 500_00 }));
    expect(payload.Line).toHaveLength(1);
    expect(payload.Line[0].Amount).toBe(500);
  });

  it("does NOT deduct retainage from the invoice total", () => {
    // Work completed is earned and invoiced in full; retainage is withheld
    // from PAYMENT against it. Netting it here would make the ledger
    // disagree with the G702 the GC signed.
    const payload = buildInvoicePayload(
      invoice({
        totalCents: 100_000,
        retainageWithheldCents: 10_000,
        lines: [line({ billedCents: 100_000 })],
      }),
    );
    expect(payload.Line[0].Amount).toBe(1000);
    expect(payload.PrivateNote).toContain("Retainage withheld: $100.00");
    expect(payload.PrivateNote).toContain("not deducted");
  });

  it("says nothing about retainage when none is withheld", () => {
    const payload = buildInvoicePayload(invoice({ lines: [line()] }));
    expect(payload.PrivateNote).not.toContain("Retainage");
  });

  it("carries Id and SyncToken only when updating an existing invoice", () => {
    const create = buildInvoicePayload(invoice({ lines: [line()] }));
    expect(create.Id).toBeUndefined();
    expect(create.SyncToken).toBeUndefined();

    const update = buildInvoicePayload(invoice({ lines: [line()] }), {
      existing: { qboId: "142", syncToken: "3" },
    });
    expect(update.Id).toBe("142");
    expect(update.SyncToken).toBe("3");
  });

  it("leaves DueDate out entirely when the invoice has no due date", () => {
    expect(buildInvoicePayload(invoice({ dueOn: null, lines: [line()] })).DueDate).toBeUndefined();
  });
});

describe("verifyPushedInvoice — a push is not evidence", () => {
  const sent = buildInvoicePayload(invoice({ lines: [line({ billedCents: 100_000 })] }));

  it("passes when what came back matches what went out", () => {
    expect(
      verifyPushedInvoice(sent, { Id: "142", DocNumber: sent.DocNumber, TotalAmt: 1000 }),
    ).toEqual({ ok: true });
  });

  it("catches a doubled total — the exact complaint in the research", () => {
    const result = verifyPushedInvoice(sent, {
      Id: "142",
      DocNumber: sent.DocNumber,
      TotalAmt: 2000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a mismatch");
    expect(result.problems[0]).toContain("$1000.00");
    expect(result.problems[0]).toContain("$2000.00");
  });

  it("catches QuickBooks renumbering the document", () => {
    // Our link would then point at something the contractor can't find.
    const result = verifyPushedInvoice(sent, {
      Id: "142",
      DocNumber: "1099",
      TotalAmt: 1000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a mismatch");
    expect(result.problems.some((p) => p.includes("Document number"))).toBe(true);
  });

  it("falls back to summing lines when no total is returned", () => {
    expect(
      verifyPushedInvoice(sent, {
        Id: "142",
        DocNumber: sent.DocNumber,
        Line: [{ Amount: 1000 }],
      }),
    ).toEqual({ ok: true });
  });

  it("tolerates QuickBooks ADDING lines of its own", () => {
    // Tax and discount lines are legitimate. Failing here would train
    // people to ignore this check, which is worse than not having it.
    expect(
      verifyPushedInvoice(sent, {
        Id: "142",
        DocNumber: sent.DocNumber,
        TotalAmt: 1000,
        Line: [{ Amount: 1000 }, { Amount: 0 }],
      }),
    ).toEqual({ ok: true });
  });

  it("reports every problem at once rather than the first", () => {
    const result = verifyPushedInvoice(sent, { Id: "142", DocNumber: "999", TotalAmt: 5000 });
    if (result.ok) throw new Error("expected mismatches");
    expect(result.problems).toHaveLength(2);
  });
});

describe("pushBlockers", () => {
  it("names each missing prerequisite separately", () => {
    expect(
      pushBlockers({ hasConnection: false, customerQboId: null, totalCents: 0 }),
    ).toHaveLength(3);
  });

  it("is silent when everything is in place", () => {
    expect(
      pushBlockers({ hasConnection: true, customerQboId: "58", totalCents: 100 }),
    ).toEqual([]);
  });

  it("refuses a zero or negative invoice", () => {
    expect(
      pushBlockers({ hasConnection: true, customerQboId: "58", totalCents: 0 })[0],
    ).toContain("zero or less");
  });
});

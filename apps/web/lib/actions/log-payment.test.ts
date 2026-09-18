import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `logPayment`'s write, with Prisma mocked — the step the pure tests in
 * lib/billing/payment-entry.test.ts cannot reach.
 *
 * WHY THIS EXISTS RATHER THAN LEANING ON THE DBTEST. Everything about the
 * two new fields is decided in `readPaymentEntry`, which is pure and
 * tested directly. What is NOT pure is whether the action actually PUTS
 * them in the row — and "written, documented, and never called" is a
 * recurring shape in this repo, green the whole time, precisely because
 * nothing asserted the call. lib/actions/billing.dbtest.ts would catch it
 * against a real Postgres, but CI has no database and does not run it, so
 * that file is not the evidence a merge can rely on.
 *
 * The mock is deliberately the thinnest thing the code path touches: one
 * job, one invoice, one payment aggregate, and a `create` that records
 * what it was handed. Nothing here asserts Prisma's behaviour, only what
 * the action asks it for.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({ company: { id: "c1" }, id: "u1", role: "OWNER" }),
}));

const created: { data: Record<string, unknown> }[] = [];
let alreadyPaid = 0;

vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    job: { findUnique: async () => ({ id: "j1", companyId: "c1", status: "CONTRACTED" }) },
    invoice: {
      findUnique: async () => ({
        id: "i1",
        jobId: "j1",
        amount: 100_000,
        job: { companyId: "c1" },
      }),
    },
    payment: {
      aggregate: async () => ({ _sum: { amount: alreadyPaid } }),
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args);
        return {};
      },
    },
  },
}));

const { logPayment } = await import("./billing");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  created.length = 0;
  alreadyPaid = 0;
});

describe("logPayment writes the date that was entered", () => {
  it("stores the entered day at UTC midnight rather than the moment of the click", async () => {
    // THE DEFECT: receivedAt was @default(now()), so the row said the
    // cheque arrived the moment somebody got round to typing it — and
    // lib/quickbooks-payment-sync.ts sends receivedAt as TxnDate, so
    // QuickBooks was told the same wrong day.
    const before = Date.now();
    const result = await logPayment("j1", "i1", form({ amount: "5000", receivedAt: "2026-09-02" }));

    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
    const receivedAt = created[0].data.receivedAt as Date;
    expect(receivedAt.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(receivedAt.getTime()).toBeLessThan(before);
  });

  it("refuses a date in the future and writes nothing", async () => {
    const future = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await logPayment("j1", "i1", form({ amount: "5000", receivedAt: future }));

    // Returned, not thrown: production redacts a thrown Server Action
    // message, and this is a typo a person can correct.
    expect(result).toEqual({ ok: false, error: expect.stringContaining("future") });
    expect(created).toHaveLength(0);
  });
});

describe("logPayment writes the platform fee", () => {
  it("stores the fee and who took it beside the amount applied", async () => {
    // Both columns have existed, documented and read by
    // lib/gc-reliability.ts, with no form writing either.
    const result = await logPayment(
      "j1",
      "i1",
      form({ amount: "100000", receivedAt: "2026-09-02", feeAmount: "220", feeSource: "Textura" }),
    );

    expect(result.ok).toBe(true);
    expect(created[0].data.amount).toBe("100000");
    expect(created[0].data.feeAmount).toBe("220.00");
    expect(created[0].data.feeSource).toBe("Textura");
  });

  it("leaves both null when no fee was taken", async () => {
    await logPayment("j1", "i1", form({ amount: "5000", receivedAt: "2026-09-02" }));
    expect(created[0].data.feeAmount).toBeNull();
    expect(created[0].data.feeSource).toBeNull();
  });

  it("checks the overpayment ceiling against the gross, not the cash", async () => {
    // `amount` is what was APPLIED to the invoice, before the fee — see
    // Payment.amount in billing.prisma. If the fee were subtracted before
    // the ceiling check, a $100,000 payment with a $220 fee would leave
    // room to log another $220 against a fully-paid invoice.
    alreadyPaid = 100_000;
    const result = await logPayment(
      "j1",
      "i1",
      form({ amount: "220", receivedAt: "2026-09-02", feeAmount: "1", feeSource: "Textura" }),
    );

    expect(result.ok).toBe(false);
    expect(created).toHaveLength(0);
  });
});

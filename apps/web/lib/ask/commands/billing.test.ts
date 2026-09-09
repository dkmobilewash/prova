import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The money commands against a fake Prisma and faked actions.
 *
 * What is pinned is what a person would be hurt by if it drifted: that an
 * amount is the person's own digits and nothing else is accepted, that the
 * balance owing on the card is the same cents arithmetic as logPayment's
 * guard, that an overpayment is refused BEFORE a card exists and in the
 * action's own sentence shape, that a chip's invoice id is re-read on this
 * job and never trusted, and on execute the exact arguments each action or
 * core receives.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      job: { findMany: fn(), findFirst: fn() },
      invoice: { findMany: fn(), findFirst: fn() },
      payment: { findFirst: fn() },
    },
    logPayment: vi.fn(),
    createInvoiceRecord: vi.fn(),
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/billing", () => ({ logPayment: fake.logPayment }));
vi.mock("@/lib/billing/create-invoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/create-invoice")>()),
  createInvoiceRecord: fake.createInvoiceRecord,
}));

const { draftInvoiceCommand, logPaymentCommand } = await import("./billing");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-08" };
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner" } };

const detail = (over: Record<string, unknown> = {}) => ({
  status: "IN_PROGRESS",
  retainagePercent: "10",
  contact: { name: "Turner", paymentTermsDays: 30 },
  invoiceCounter: { lastNumber: 2 },
  ...over,
});

const invoice = (id: string, number: number, amount: number, paid: number[] = []) => ({
  id,
  number,
  amount: String(amount),
  payments: paid.map((p) => ({ amount: String(p) })),
});

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
  fake.logPayment.mockReset();
  fake.createInvoiceRecord.mockReset();
});

describe("draft_invoice", () => {
  it("asks before it reads when the job is missing", async () => {
    expect((await draftInvoiceCommand.resolve(ctx, { amount: "45000" })).kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("refuses an estimate with a link to the job, in the action's words", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(detail({ status: "ESTIMATE" }));
    const result = await draftInvoiceCommand.resolve(ctx, { jobName: "Riverside", amount: "45000" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toMatch(/^Contract this job before invoicing it/);
    expect(result.href).toBe("/jobs/job-1");
  });

  it("asks for the amount, and asks again when what was said is not a plain number", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(detail());
    const missing = await draftInvoiceCommand.resolve(ctx, { jobName: "Riverside" });
    expect(missing.kind).toBe("need");
    if (missing.kind !== "need") throw new Error("unreachable");
    expect(missing.missing).toBe("the invoice amount");

    const vague = await draftInvoiceCommand.resolve(ctx, { jobName: "Riverside", amount: "12.5k" });
    expect(vague.kind).toBe("need");
    if (vague.kind !== "need") throw new Error("unreachable");
    expect(vague.missing).toContain('"12.5k"');
  });

  it("computes the retainage, the due date and the next number in code, from the person's own digits", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(detail());
    const result = await draftInvoiceCommand.resolve(ctx, {
      jobName: "Riverside",
      amount: "$45,000",
      description: "September progress",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "45000.00",
      description: "September progress",
      dueAt: "2026-10-08",
    });
    const line = (label: string) => result.preview.find((l) => l.label === label)?.value;
    expect(line("Amount")).toBe("$45,000.00");
    expect(line("Invoice")).toContain("the last was #2");
    expect(line("Retainage withheld")).toContain("$4,500.00");
    expect(line("Retainage withheld")).toContain("10%");
    expect(line("Due")).toContain("2026-10-08");
    expect(line("Due")).toContain("Net 30");
    expect(result.warnings).toEqual([]);
  });

  it("says when there is no retainage rate and no terms, and warns about an empty description", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(
      detail({ retainagePercent: null, contact: { name: "Turner", paymentTermsDays: null }, invoiceCounter: null }),
    );
    const result = await draftInvoiceCommand.resolve(ctx, { jobName: "Riverside", amount: "1000" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toMatchObject({ dueAt: null, description: null });
    const line = (label: string) => result.preview.find((l) => l.label === label)?.value;
    expect(line("Invoice")).toBe("#1, the first on this job");
    expect(line("Retainage withheld")).toMatch(/^none/);
    expect(line("Due")).toMatch(/^not set/);
    expect(result.warnings).toHaveLength(1);
  });

  it("calls the lifted core with the company it verified, and hands back the number it issued", async () => {
    fake.createInvoiceRecord.mockResolvedValue({ ok: true, value: { invoiceId: "inv-3", number: 3, retainageWithheld: "4500.00" } });
    const result = await draftInvoiceCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "45000.00",
      description: "September progress",
      dueAt: "2026-10-08",
    });
    expect(fake.createInvoiceRecord).toHaveBeenCalledWith("co-1", "job-1", {
      amount: "45000.00",
      description: "September progress",
      dueAt: new Date("2026-10-08T00:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.message).toContain("Invoice #3");
    expect(result.message).toContain("$45,000.00");
    expect(result.created).toMatchObject({ href: "/jobs/job-1", targetType: "Invoice", targetId: "inv-3" });
  });

  it("puts the core's own refusal on the card", async () => {
    fake.createInvoiceRecord.mockResolvedValue({ ok: false, error: "Contract this job before invoicing it" });
    const result = await draftInvoiceCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "100.00",
      description: null,
      dueAt: null,
    });
    expect(result).toEqual({ ok: false, error: "Contract this job before invoicing it" });
  });
});

describe("log_payment", () => {
  it("refuses with a link when nothing on the job is owing, naming the number if one was given", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.invoice.findMany.mockResolvedValue([]);
    const none = await logPaymentCommand.resolve(ctx, { jobName: "Riverside", amount: "100" });
    expect(none.kind).toBe("refuse");
    if (none.kind !== "refuse") throw new Error("unreachable");
    expect(none.reason).toBe("No invoice on Riverside Plaza has a balance owing.");
    expect(none.href).toBe("/jobs/job-1");

    const numbered = await logPaymentCommand.resolve(ctx, { jobName: "Riverside", amount: "100", invoiceNumber: "7" });
    if (numbered.kind !== "refuse") throw new Error("unreachable");
    expect(numbered.reason).toBe("There is no invoice 7 on Riverside Plaza.");
  });

  it("refuses an invoice already paid in full", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.invoice.findMany.mockResolvedValue([invoice("i-1", 1, 20000, [20000])]);
    const result = await logPaymentCommand.resolve(ctx, { jobName: "Riverside", amount: "100", invoiceNumber: "1" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toMatch(/Invoice #1 on Riverside Plaza is already paid in full/);
  });

  it("offers chips when two invoices are open, each with its balance", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.invoice.findMany.mockResolvedValue([invoice("i-2", 2, 30000), invoice("i-1", 1, 45000, [12500])]);
    const result = await logPaymentCommand.resolve(ctx, { jobName: "Riverside", amount: "100" });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("invoiceId");
    expect(result.options.map((o) => o.label)).toEqual(["Invoice #2", "Invoice #1"]);
    expect(result.options[1].detail).toBe("$45,000.00 · $32,500.00 owing");
  });

  it("refuses an overpayment before any card exists, in the action's own sentence shape", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.invoice.findMany.mockResolvedValue([invoice("i-1", 1, 45000, [12500])]);
    const result = await logPaymentCommand.resolve(ctx, { jobName: "Riverside", amount: "40,000" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toBe(
      "That would bring total payments to $52,500.00, more than the $45,000.00 invoice total. Only $32,500.00 is left owing on invoice #1.",
    );
    expect(result.href).toBe("/jobs/job-1");
  });

  it("shows the balance after, from the same cents the guard uses, and carries the digits as typed", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.invoice.findMany.mockResolvedValue([invoice("i-1", 1, 45000, [12500])]);
    const result = await logPaymentCommand.resolve(ctx, {
      jobName: "Riverside",
      amount: "$12,500",
      method: "check",
      note: "4471",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      invoiceId: "i-1",
      invoiceNumber: 1,
      amount: "12500.00",
      method: "check",
      note: "4471",
    });
    const line = (label: string) => result.preview.find((l) => l.label === label)?.value;
    expect(line("Invoice")).toBe("#1 · $45,000.00 · $32,500.00 owing");
    expect(line("Payment")).toBe("$12,500.00");
    expect(line("Owing after")).toBe("$20,000.00");

    const payoff = await logPaymentCommand.resolve(ctx, { jobName: "Riverside", amount: "32500" });
    if (payoff.kind !== "ready") throw new Error("unreachable");
    expect(payoff.preview.find((l) => l.label === "Owing after")?.value).toMatch(/pays it off/);
  });

  it("re-reads a chip's invoice on this job and in this company, and never the list", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", name: "Riverside Plaza" });
    fake.prisma.invoice.findFirst.mockResolvedValue(null);
    const foreign = await logPaymentCommand.resolve(ctx, { jobId: "job-1", invoiceId: "i-9", amount: "100" });
    expect(foreign.kind).toBe("refuse");
    expect(fake.prisma.invoice.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: "i-9", jobId: "job-1", job: { companyId: "co-1" } },
    });
    expect(fake.prisma.invoice.findMany).not.toHaveBeenCalled();

    fake.prisma.invoice.findFirst.mockResolvedValue(invoice("i-1", 1, 45000, [12500]));
    const ready = await logPaymentCommand.resolve(ctx, { jobId: "job-1", invoiceId: "i-1", amount: "100" });
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") throw new Error("unreachable");
    expect(ready.resolved).toMatchObject({ invoiceId: "i-1", invoiceNumber: 1, amount: "100.00" });
  });

  it("calls the action with exactly the fields the form would have posted", async () => {
    fake.logPayment.mockResolvedValue({ ok: true });
    fake.prisma.payment.findFirst.mockResolvedValue({ id: "p-1" });
    const result = await logPaymentCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      invoiceId: "i-1",
      invoiceNumber: 1,
      amount: "12500.00",
      method: "check",
      note: null,
    });
    expect(fake.logPayment).toHaveBeenCalledTimes(1);
    const [jobId, invoiceId, fd] = fake.logPayment.mock.calls[0] as [string, string, FormData];
    expect(jobId).toBe("job-1");
    expect(invoiceId).toBe("i-1");
    expect(fd.get("amount")).toBe("12500.00");
    expect(fd.get("method")).toBe("check");
    expect(fd.has("note")).toBe(false);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.message).toBe("Logged $12,500.00 against invoice #1 on Riverside Plaza.");
    expect(result.created).toMatchObject({ href: "/jobs/job-1", targetType: "Payment", targetId: "p-1" });
  });

  it("puts the action's own refusal on the card, and refuses a payload with no invoice number", async () => {
    fake.logPayment.mockResolvedValue({
      ok: false,
      error: "This invoice is already paid in full — there is nothing left to log a payment against.",
    });
    const refused = await logPaymentCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      invoiceId: "i-1",
      invoiceNumber: 1,
      amount: "100.00",
    });
    expect(refused).toEqual({
      ok: false,
      error: "This invoice is already paid in full — there is nothing left to log a payment against.",
    });

    const broken = await logPaymentCommand.execute(ctx, { jobId: "job-1", jobName: "Riverside Plaza", invoiceId: "i-1", amount: "100.00" });
    expect(broken.ok).toBe(false);
    expect(fake.logPayment).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditOutcome, AuditRow } from "./audit";

/**
 * The audit page's data, against a fake Prisma. Pinned: the derived
 * outcome for every stored/derived combination (the thing that must not
 * be stored), that a row from a command no longer in the registry still
 * says what it was, that a removed asker is named as such rather than
 * crashing the page, and where each target kind links.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      askProposal: { findMany: fn() },
      invoice: { findMany: fn() },
      payment: { findMany: fn() },
      timeEntry: { findMany: fn() },
    },
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { auditOutcome, auditSummary, listAskProposals, AUDIT_PAGE_SIZE } = await import("./audit");
const { commandNamed } = await import("./commands");

const now = new Date("2026-09-09T12:00:00.000Z");
const later = new Date("2026-09-09T12:30:00.000Z");
const earlier = new Date("2026-09-09T11:00:00.000Z");

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
  fake.prisma.invoice.findMany.mockResolvedValue([]);
  fake.prisma.payment.findMany.mockResolvedValue([]);
  fake.prisma.timeEntry.findMany.mockResolvedValue([]);
});

describe("auditOutcome", () => {
  const base = { outcome: null, claimedAt: null, openedAt: null, expiresAt: later };

  it("is the stored outcome whenever there is one", () => {
    for (const outcome of ["OK", "REFUSED", "FAILED", "CANCELLED"] as const) {
      expect(auditOutcome({ ...base, outcome, expiresAt: earlier }, now)).toBe(outcome);
    }
  });

  it("is derived from the stamps otherwise, and never stored", () => {
    expect(auditOutcome(base, now)).toBe("PENDING");
    expect(auditOutcome({ ...base, expiresAt: earlier }, now)).toBe("EXPIRED");
    expect(auditOutcome({ ...base, claimedAt: earlier }, now)).toBe("OK");
    expect(auditOutcome({ ...base, openedAt: earlier }, now)).toBe("OPENED");
    // A form that was opened stays "opened" after the card expires: the
    // person got that far, and expiry does not un-happen it.
    expect(auditOutcome({ ...base, openedAt: earlier, expiresAt: earlier }, now)).toBe("OPENED");
  });
});

describe("listAskProposals", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "p-1",
    createdAt: earlier,
    question: "bill Riverside for 45000",
    command: "draft_invoice",
    mode: "DIRECT",
    outcome: "OK",
    outcomeNote: null,
    claimedAt: earlier,
    openedAt: null,
    expiresAt: later,
    targetType: null,
    targetId: null,
    createdByUser: { name: "Dana", email: "dana@example.test" },
    ...over,
  });

  it("reads one page of the company's rows, newest first", async () => {
    fake.prisma.askProposal.findMany.mockResolvedValue([]);
    expect(await listAskProposals("co-1", now)).toEqual([]);
    expect(fake.prisma.askProposal.findMany.mock.calls[0][0]).toMatchObject({
      where: { companyId: "co-1" },
      orderBy: { createdAt: "desc" },
      take: AUDIT_PAGE_SIZE,
    });
  });

  it("names the card by its registry title, or by the raw command when it is no longer registered", async () => {
    fake.prisma.askProposal.findMany.mockResolvedValue([
      row({ id: "p-1" }),
      row({ id: "p-2", command: "old_thing_nobody_remembers", createdByUser: null }),
    ]);
    const rows = await listAskProposals("co-1", now);
    expect(rows[0]).toMatchObject({ proposed: commandNamed("draft_invoice").title, who: "Dana", outcome: "OK", target: null });
    expect(rows[1]).toMatchObject({ proposed: "old_thing_nobody_remembers", who: "a removed account" });
  });

  it("links each target where it can be read, in one query per kind", async () => {
    fake.prisma.askProposal.findMany.mockResolvedValue([
      row({ id: "p-1", targetType: "Invoice", targetId: "inv-1" }),
      row({ id: "p-2", targetType: "Invoice", targetId: "inv-2" }),
      row({ id: "p-3", targetType: "Payment", targetId: "pay-1" }),
      row({ id: "p-4", targetType: "Job", targetId: "job-9" }),
      row({ id: "p-5", targetType: "DailyFieldReport", targetId: "r-1" }),
      row({ id: "p-6", targetType: "Something", targetId: "x-1" }),
    ]);
    fake.prisma.invoice.findMany.mockResolvedValue([
      { id: "inv-1", number: 1, jobId: "job-1" },
      { id: "inv-2", number: 2, jobId: "job-1" },
    ]);
    fake.prisma.payment.findMany.mockResolvedValue([{ id: "pay-1", invoice: { number: 1, jobId: "job-1" } }]);
    const rows = await listAskProposals("co-1", now);
    expect(fake.prisma.invoice.findMany).toHaveBeenCalledTimes(1);
    expect(fake.prisma.invoice.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["inv-1", "inv-2"] } } });
    expect(fake.prisma.timeEntry.findMany).not.toHaveBeenCalled();
    expect(rows.map((r) => r.target)).toEqual([
      { label: "Invoice #1", href: "/jobs/job-1" },
      { label: "Invoice #2", href: "/jobs/job-1" },
      { label: "Payment on invoice #1", href: "/jobs/job-1" },
      { label: "Job", href: "/jobs/job-9" },
      { label: "Field report", href: "/field-reports" },
      null,
    ]);
  });
});

describe("auditSummary", () => {
  it("counts the last thirty days, and a tap that wrote nothing for either stored reason", () => {
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
    const outcomes: { outcome: AuditOutcome; when: Date }[] = [
      { outcome: "OK", when: at(1) },
      { outcome: "OK", when: at(29) },
      { outcome: "REFUSED", when: at(2) },
      { outcome: "FAILED", when: at(3) },
      { outcome: "PENDING", when: at(0) },
      { outcome: "OK", when: at(31) },
    ];
    const rows: AuditRow[] = outcomes.map((r, i) => ({
      id: `p-${i}`,
      who: "",
      question: "",
      proposed: "",
      mode: "DIRECT",
      note: null,
      target: null,
      ...r,
    }));
    expect(auditSummary(rows, now)).toEqual({ proposed: 5, done: 2, notDone: 2 });
  });
});

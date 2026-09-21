import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bound behind #352's rate cap on `sendOutboundEmail`, against a
 * mocked Prisma — the same pattern `lib/ask/usage.ts`'s own test uses for
 * `askAllowance`, and deliberately so: this is the same shape of check
 * (count rows in a rolling window, refuse at the ceiling) with one
 * decision flipped. See the file under test for why.
 */
const fake = vi.hoisted(() => ({
  prisma: { outboundMessage: { count: vi.fn() } },
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { OUTBOUND_EMAIL_LIMITS, outboundEmailAllowance } = await import("./outbound-email-limit");

const now = new Date("2026-09-20T12:00:00.000Z");

beforeEach(() => {
  fake.prisma.outboundMessage.count.mockReset();
});

describe("outboundEmailAllowance", () => {
  it("counts a rolling 24 hours, excluding help requests and the alert digest", async () => {
    fake.prisma.outboundMessage.count.mockResolvedValue(0);
    expect(await outboundEmailAllowance("co-1", now)).toEqual({ ok: true });

    expect(fake.prisma.outboundMessage.count).toHaveBeenCalledWith({
      where: {
        companyId: "co-1",
        channel: "EMAIL",
        // The alert digest writes OutboundMessage rows with no sentByUserId
        // at all (notification-dispatch.ts) — excluded by this clause, not
        // by a second query.
        sentByUserId: { not: null },
        // Help requests must never compete with a company's own
        // correspondence for this ceiling.
        relatedType: { not: "HELP_REQUEST" },
        createdAt: { gte: new Date("2026-09-19T12:00:00.000Z") },
      },
    });
  });

  it("allows the send just under the limit and refuses at it, naming the number", async () => {
    fake.prisma.outboundMessage.count.mockResolvedValue(OUTBOUND_EMAIL_LIMITS.perCompanyPerDay - 1);
    expect(await outboundEmailAllowance("co-1", now)).toEqual({ ok: true });

    fake.prisma.outboundMessage.count.mockResolvedValue(OUTBOUND_EMAIL_LIMITS.perCompanyPerDay);
    const result = await outboundEmailAllowance("co-1", now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`${OUTBOUND_EMAIL_LIMITS.perCompanyPerDay} emails in the last day`);
    }
  });

  it("refuses PAST the limit too, not only exactly at it", async () => {
    fake.prisma.outboundMessage.count.mockResolvedValue(OUTBOUND_EMAIL_LIMITS.perCompanyPerDay + 40);
    const result = await outboundEmailAllowance("co-1", now);
    expect(result.ok).toBe(false);
  });

  /**
   * FAILS CLOSED — the opposite of `askAllowance`, which fails open and
   * says so in its own comment. Pinned here because a rate cap that
   * silently reverts to "allow everything" the one time its own read
   * breaks is worse than no cap, and it is the one property in this file
   * that departs from the codebase's usual pattern for a usage ceiling.
   */
  it("fails CLOSED when the count cannot be read, refusing rather than sending unmetered", async () => {
    const originalError = console.error;
    console.error = vi.fn();
    try {
      fake.prisma.outboundMessage.count.mockRejectedValue(new Error("connection reset"));
      const result = await outboundEmailAllowance("co-1", now);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/couldn't verify/i);
    } finally {
      console.error = originalError;
    }
  });
});

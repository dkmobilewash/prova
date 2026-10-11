import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bidInvitation: { findFirst: vi.fn(), update: vi.fn() },
  bidOutcome: { upsert: vi.fn() },
  aiRecommendation: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const principal = vi.hoisted(() => ({ companyId: "c1", id: "u1", role: "OWNER", jobFunction: null as string | null }));
vi.mock("@prova/db", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => principal }));

import { recordBidOutcome } from "./bidOutcomes";
import { dismissRecommendation, markRecommendationDone } from "./recommendations";

beforeEach(() => {
  vi.clearAllMocks();
  principal.role = "OWNER";
  principal.jobFunction = null;
  db.bidInvitation.findFirst.mockResolvedValue({ id: "bid1", status: "SUBMITTED", contactId: "gc1" });
  db.bidOutcome.upsert.mockReturnValue("upsert");
  db.bidInvitation.update.mockReturnValue("update");
  db.$transaction.mockResolvedValue([]);
  db.aiRecommendation.updateMany.mockResolvedValue({ count: 1 });
});

describe("recordBidOutcome", () => {
  it("writes the outcome and the status in ONE transaction, clearing any decline fields", async () => {
    const out = await recordBidOutcome({ bidInvitationId: "bid1", result: "LOST", reason: "PRICE", winningPrice: 1200000, winnerName: " Acme ", decidedOn: "2026-10-10" });
    expect(out).toEqual({ ok: true });
    expect(db.$transaction).toHaveBeenCalledWith(["upsert", "update"]);
    const upsert = db.bidOutcome.upsert.mock.calls[0][0];
    expect(upsert.create).toMatchObject({ companyId: "c1", bidInvitationId: "bid1", result: "LOST", reason: "PRICE", winningPrice: "1200000.00", winnerName: "Acme", recordedByUserId: "u1" });
    expect(upsert.create.decidedOn.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(db.bidInvitation.update).toHaveBeenCalledWith({
      where: { id: "bid1" },
      data: { status: "LOST", declineReason: null, declineNote: null, declinedOn: null },
    });
  });

  it("refuses without MANAGE_ESTIMATING before touching the database", async () => {
    principal.role = "MEMBER";
    principal.jobFunction = "FIELD";
    const out = await recordBidOutcome({ bidInvitationId: "bid1", result: "WON", reason: "PRICE" });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/part of your job function/) });
    expect(db.bidInvitation.findFirst).not.toHaveBeenCalled();
  });

  it("returns sentences for bad input, a foreign bid and a declined bid", async () => {
    expect(await recordBidOutcome({ bidInvitationId: "bid1", result: "MAYBE" as "WON", reason: "PRICE" })).toMatchObject({ ok: false });
    expect(await recordBidOutcome({ bidInvitationId: "bid1", result: "WON", reason: "LUCK" as "PRICE" })).toMatchObject({ ok: false });
    expect(await recordBidOutcome({ bidInvitationId: "bid1", result: "WON", reason: "PRICE", winningPrice: -5 })).toMatchObject({ ok: false });
    db.bidInvitation.findFirst.mockResolvedValue(null);
    expect(await recordBidOutcome({ bidInvitationId: "bid1", result: "WON", reason: "PRICE" })).toEqual({ ok: false, error: "That bid isn't on your account." });
    db.bidInvitation.findFirst.mockResolvedValue({ id: "bid1", status: "DECLINED", contactId: "gc1" });
    expect(await recordBidOutcome({ bidInvitationId: "bid1", result: "WON", reason: "PRICE" })).toMatchObject({ ok: false, error: expect.stringMatching(/declined/) });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("recommendation actions", () => {
  it("stamp who closed it, scoped to the company", async () => {
    expect(await dismissRecommendation("r1")).toEqual({ ok: true });
    expect(db.aiRecommendation.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", companyId: "c1" },
      data: expect.objectContaining({ status: "dismissed", resolvedByUserId: "u1" }),
    });
    db.aiRecommendation.updateMany.mockResolvedValue({ count: 0 });
    expect(await markRecommendationDone("r2")).toMatchObject({ ok: false });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ bidInvitation: { findFirst: vi.fn(), findMany: vi.fn() } }));
const action = vi.hoisted(() => vi.fn());
vi.mock("@prova/db", () => ({ prisma: db }));
vi.mock("@/lib/actions/bidOutcomes", () => ({ recordBidOutcome: action }));

import { readAmount, readReason, readResult, recordBidOutcomeCommand as command } from "./bidOutcomes";
import type { CommandContext } from "../commands";

const ctx = { companyId: "c1", userId: "u1", today: "2026-10-11", principal: { role: "OWNER", jobFunction: null } } as CommandContext;
const row = (over: Record<string, unknown> = {}) => ({
  id: "bid1",
  projectName: "Riverside",
  status: "SUBMITTED",
  contact: { name: "Turner" },
  outcome: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.bidInvitation.findMany.mockResolvedValue([row()]);
  action.mockResolvedValue({ ok: true });
});

describe("reading the person's words", () => {
  it("maps results, reasons and amounts in code, and refuses to guess", () => {
    expect(readResult("we lost it")).toBe("LOST");
    expect(readResult("got awarded")).toBe("WON");
    expect(readResult("WON")).toBe("WON");
    expect(readResult("no idea")).toBeNull();
    expect(readReason("came in high")).toEqual(["PRICE"]);
    expect(readReason("they went with their usual sub")).toEqual(["RELATIONSHIP"]);
    expect(readReason("SCHEDULE")).toEqual(["SCHEDULE"]);
    expect(readReason("price and schedule")).toEqual(["PRICE", "SCHEDULE"]);
    expect(readAmount("$1,240,000")).toBe(1240000);
    expect(readAmount("1.24m")).toBe(1240000);
    expect(readAmount("850k")).toBe(850000);
    expect(readAmount("a lot")).toBeNull();
  });
});

describe("record_bid_outcome resolve", () => {
  it("builds a card with every field the row will hold", async () => {
    const out = await command.resolve(ctx, {
      projectName: "Riverside",
      result: "lost",
      reason: "came in high",
      winningPrice: "1.2m",
      winnerName: "Acme Drywall",
      decidedOn: "yesterday",
    });
    expect(out.kind).toBe("ready");
    if (out.kind !== "ready") return;
    expect(out.resolved).toEqual({
      bidInvitationId: "bid1",
      projectName: "Riverside",
      result: "LOST",
      reason: "PRICE",
      winningPrice: 1200000,
      winnerName: "Acme Drywall",
      note: null,
      decidedOn: "2026-10-10",
    });
    expect(out.preview.find((l) => l.label === "Status")!.value).toBe("Submitted → Lost");
    expect(out.preview.find((l) => l.label === "Winning price")!.value).toBe("$1,200,000.00");
  });

  it("asks for what is missing, and chips the reason when none was said", async () => {
    expect(await command.resolve(ctx, { projectName: "Riverside" })).toMatchObject({ kind: "need" });
    const out = await command.resolve(ctx, { projectName: "Riverside", result: "lost" });
    expect(out).toMatchObject({ kind: "clarify", field: "reason" });
  });

  it("chips between several matching bids, refuses none and refuses a declined one", async () => {
    db.bidInvitation.findMany.mockResolvedValue([row(), row({ id: "bid2", contact: { name: "Skanska" } })]);
    expect(await command.resolve(ctx, { projectName: "Riverside", result: "won" })).toMatchObject({ kind: "clarify", field: "bidInvitationId" });
    db.bidInvitation.findMany.mockResolvedValue([]);
    expect(await command.resolve(ctx, { projectName: "Nowhere", result: "won" })).toMatchObject({ kind: "refuse" });
    db.bidInvitation.findMany.mockResolvedValue([row({ status: "DECLINED" })]);
    expect(await command.resolve(ctx, { projectName: "Riverside", result: "won", reason: "price" })).toMatchObject({ kind: "refuse" });
  });

  it("will not take a decision date in the future", async () => {
    expect(await command.resolve(ctx, { projectName: "Riverside", result: "won", reason: "price", decidedOn: "tomorrow" })).toMatchObject({ kind: "need" });
  });
});

describe("record_bid_outcome execute", () => {
  it("calls the action with the server-held payload and links the bid", async () => {
    const out = await command.execute(ctx, {
      bidInvitationId: "bid1",
      projectName: "Riverside",
      result: "WON",
      reason: "RELATIONSHIP",
      winningPrice: null,
      winnerName: null,
      note: null,
      decidedOn: null,
    });
    expect(action).toHaveBeenCalledWith({ bidInvitationId: "bid1", result: "WON", reason: "RELATIONSHIP", winningPrice: null, winnerName: null, note: null, decidedOn: null });
    expect(out).toMatchObject({ ok: true, message: "Recorded Riverside as won (relationship).", created: { href: "/bids" } });
  });

  it("refuses a tampered payload and passes the action's refusal through", async () => {
    expect(await command.execute(ctx, { bidInvitationId: "bid1", projectName: "R", result: "MAYBE", reason: "PRICE" })).toMatchObject({ ok: false });
    action.mockResolvedValue({ ok: false, error: "That bid isn't on your account." });
    expect(await command.execute(ctx, { bidInvitationId: "x", projectName: "R", result: "LOST", reason: "PRICE" })).toEqual({ ok: false, error: "That bid isn't on your account." });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { count: vi.fn() },
  companyAgentSettings: { upsert: vi.fn(), findUnique: vi.fn() },
  agentFinding: { updateMany: vi.fn() },
}));
const ctx = vi.hoisted(() => ({ value: { id: "u1", companyId: "c1", role: "OWNER" } }));
const can = vi.hoisted(() => vi.fn());

vi.mock("@prova/db", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ctx.value }));
vi.mock("@/lib/permissions", () => ({ can }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn() }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));

import { revalidatePath } from "next/cache";
import { saveAgentSettings } from "./agentSettings";
import { dismissFinding, restoreFinding } from "./agentFindings";

beforeEach(() => {
  vi.clearAllMocks();
  ctx.value = { id: "u1", companyId: "c1", role: "OWNER" };
  can.mockReturnValue(true);
  db.companyAgentSettings.findUnique.mockResolvedValue(null);
  db.user.count.mockResolvedValue(1);
});

describe("saveAgentSettings", () => {
  it("refuses without estimating access, and refuses a non-owner, by returning", async () => {
    can.mockReturnValue(false);
    expect(await saveAgentSettings({ dueSoonDays: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/part of your job function/) });
    can.mockReturnValue(true);
    ctx.value = { ...ctx.value, role: "MEMBER" };
    expect(await saveAgentSettings({ dueSoonDays: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/owner/) });
    expect(db.companyAgentSettings.upsert).not.toHaveBeenCalled();
  });

  it("validates days 1..30 and the cap", async () => {
    for (const bad of [0, 31, 2.5]) {
      expect(await saveAgentSettings({ dueSoonDays: bad })).toMatchObject({ ok: false });
    }
    expect(await saveAgentSettings({ monthlySpendCapUsd: -1 })).toMatchObject({ ok: false });
    expect(db.companyAgentSettings.upsert).not.toHaveBeenCalled();
  });

  it("refuses a notify person from another company", async () => {
    db.user.count.mockResolvedValue(1);
    expect(await saveAgentSettings({ notifyUserIds: ["u1", "other"] })).toMatchObject({ ok: false });
    expect(db.user.count.mock.calls[0]![0].where).toEqual({ companyId: "c1", id: { in: ["u1", "other"] } });
    expect(db.companyAgentSettings.upsert).not.toHaveBeenCalled();
  });

  it("a form is the whole form: unchecked boxes are off, a blank cap is no cap", async () => {
    const form = new FormData();
    form.set("watcherEnabled", "on");
    form.set("dueSoonDays", "7");
    form.set("monthlySpendCapUsd", "$25");
    form.append("notifyUserIds", "u1");
    expect(await saveAgentSettings(form)).toEqual({ ok: true });
    const { create, update, where } = db.companyAgentSettings.upsert.mock.calls[0]![0];
    expect(where).toEqual({ companyId: "c1" });
    expect(update).toEqual({
      watcherEnabled: true,
      researchOnNewBid: false,
      checkerBeforeSend: false,
      recommendationsEnabled: false,
      dueSoonDays: 7,
      monthlySpendCapUsd: 25,
      notifyUserIds: ["u1"],
      updatedByUserId: "u1",
    });
    expect(create).toMatchObject({ companyId: "c1", dueSoonDays: 7 });

    form.set("monthlySpendCapUsd", "");
    await saveAgentSettings(form);
    expect(db.companyAgentSettings.upsert.mock.calls[1]![0].update.monthlySpendCapUsd).toBeNull();
  });

  it("an object is a partial update", async () => {
    expect(await saveAgentSettings({ dueSoonDays: 3 })).toEqual({ ok: true });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/ai"], ["/ai/activity"]]);
    const { create, update } = db.companyAgentSettings.upsert.mock.calls[0]![0];
    expect(update).toEqual({ dueSoonDays: 3, updatedByUserId: "u1" });
    // A first save fills the rest from the defaults rather than nothing.
    expect(create).toMatchObject({ watcherEnabled: true, dueSoonDays: 3, notifyUserIds: [] });
  });
});

describe("dismiss / restore a finding", () => {
  it("is company-scoped and says so when nothing matched", async () => {
    db.agentFinding.updateMany.mockResolvedValue({ count: 1 });
    expect(await dismissFinding("f1")).toEqual({ ok: true });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/ai"], ["/ai/activity"], ["/ai/bids/[id]", "page"]]);
    expect(db.agentFinding.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: "f1", companyId: "c1", dismissedAt: null },
      data: { dismissedByUserId: "u1" },
    });
    db.agentFinding.updateMany.mockResolvedValue({ count: 0 });
    expect(await restoreFinding("f1")).toMatchObject({ ok: false });
    expect(db.agentFinding.updateMany.mock.calls[1]![0].where).toEqual({ id: "f1", companyId: "c1", dismissedAt: { not: null } });
  });

  it("refuses without estimating access before touching the database", async () => {
    can.mockReturnValue(false);
    expect(await dismissFinding("f1")).toMatchObject({ ok: false, error: expect.stringMatching(/part of your job function/) });
    expect(db.agentFinding.updateMany).not.toHaveBeenCalled();
  });
});

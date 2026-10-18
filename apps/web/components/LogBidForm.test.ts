import { describe, expect, it, vi } from "vitest";

const createBidInvitation = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/actions", () => ({ createBidInvitation }));

const { logBid } = await import("./LogBidForm");

describe("logBid", () => {
  it("calls the contact page's own action with the GC picked in the form", async () => {
    const form = new FormData();
    form.set("contactId", "gc-1");
    form.set("projectName", "Oak Ave");
    await expect(logBid(form)).resolves.toEqual({ ok: true });
    expect(createBidInvitation).toHaveBeenCalledWith("gc-1", form);
  });
});

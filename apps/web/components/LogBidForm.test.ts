import { describe, expect, it, vi } from "vitest";

const createBidInvitation = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/actions", () => ({ createBidInvitation }));

const { logBid, sameJobInputFromForm } = await import("./LogBidForm");

describe("logBid", () => {
  it("calls the contact page's own action with the GC picked in the form", async () => {
    const form = new FormData();
    form.set("contactId", "gc-1");
    form.set("projectName", "Oak Ave");
    await expect(logBid(form)).resolves.toEqual({ ok: true });
    expect(createBidInvitation).toHaveBeenCalledWith("gc-1", form);
  });
});

describe("sameJobInputFromForm", () => {
  it("hands the same-job check the GC, name, date and notes, with blanks as null", () => {
    const form = new FormData();
    form.set("contactId", "");
    form.set("projectName", "Riverside Medical");
    form.set("dueDate", "2026-11-04");
    form.set("notes", "Site: 1200 Main St, Riverside");
    expect(sameJobInputFromForm(form)).toEqual({
      contactId: null,
      projectName: "Riverside Medical",
      dueDate: "2026-11-04",
      notes: "Site: 1200 Main St, Riverside",
    });
    expect(sameJobInputFromForm(new FormData())).toEqual({ contactId: null, projectName: "", dueDate: null, notes: null });
  });
});

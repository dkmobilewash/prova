import { describe, expect, it, vi } from "vitest";

const createBidInvitation = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/actions", () => ({ createBidInvitation }));

const { logBid, prefillSameJob, sameJobInputFromForm } = await import("./LogBidForm");

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

describe("prefillSameJob", () => {
  const fields = (projectName = "", tradeScope = "") => ({ projectName: { value: projectName }, tradeScope: { value: tradeScope } });
  const riverside = { projectName: "Riverside Dental TI", tradeScope: "METAL_FRAMING_DRYWALL" };
  const blank = { projectName: "", tradeScope: "" };

  it("fills a blank name and trade from the picked job", () => {
    const form = fields();
    const filled = prefillSameJob(form, riverside, blank);
    expect(form.projectName.value).toBe("Riverside Dental TI");
    expect(form.tradeScope.value).toBe("METAL_FRAMING_DRYWALL");
    expect(filled).toEqual(riverside);
  });

  it("never overwrites what was typed, but replaces its own earlier fill", () => {
    const typed = fields("Riverside Dental — Turner's name for it");
    prefillSameJob(typed, riverside, blank);
    expect(typed.projectName.value).toBe("Riverside Dental — Turner's name for it");
    expect(typed.tradeScope.value).toBe("METAL_FRAMING_DRYWALL");

    const form = fields();
    const first = prefillSameJob(form, riverside, blank);
    prefillSameJob(form, { projectName: "Harbor Lofts", tradeScope: null }, first);
    expect(form.projectName.value).toBe("Harbor Lofts");
    expect(form.tradeScope.value).toBe("");
  });

  it("takes its fill back out on 'A new job'", () => {
    const form = fields();
    const first = prefillSameJob(form, riverside, blank);
    prefillSameJob(form, undefined, first);
    expect(form).toEqual(fields());
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import type { ActionResult } from "./shared";

/**
 * Every refusal this module makes must be RETURNED, not thrown — see the
 * long note in `punchLists.test.ts` for why a throw cannot be allowed to
 * count as a refusal.
 *
 * AND ONE REFUSAL THAT DID NOT EXIST AT ALL. `MaterialOrder.vendor` has no
 * `onDelete` in operations.prisma, so it is RESTRICT: deleting a vendor that
 * is on a material order raised a raw Prisma foreign-key error, which
 * production redacts, so the Remove button appeared to do nothing whatsoever.
 * Both halves are pinned below — that it refuses, and that it says what is in
 * the way.
 */

let db = new FakeDb();

const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    return db.client();
  },
}));

const { createVendor, updateVendor, deleteVendor } = await import("./vendors");

async function refusal(pending: Promise<ActionResult>): Promise<string> {
  let result: ActionResult;
  try {
    result = await pending;
  } catch (err) {
    throw new Error(
      `THREW instead of returning: "${err instanceof Error ? err.message : String(err)}". ` +
        `A thrown Server Action message is redacted in production, so this sentence would ` +
        `never reach the user. Return it as { ok: false, error } instead.`,
    );
  }
  if (result.ok) throw new Error("the action SUCCEEDED — expected it to refuse");
  return result.error;
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function vendors() {
  return db.rows("vendor");
}

beforeEach(() => {
  db = new FakeDb();
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("createVendor returns its refusals", () => {
  it("says the name is required, and writes nothing", async () => {
    expect(await refusal(createVendor(form({ name: "  ", phone: "702-555-0134" })))).toBe(
      "Vendor name is required",
    );
    expect(vendors()).toHaveLength(0);
  });

  // The control.
  it("still adds the vendor when the form is right", async () => {
    expect(await createVendor(form({ name: "Desert Gypsum Supply", phone: "702-555-0134" }))).toEqual(
      { ok: true },
    );
    expect(vendors()).toHaveLength(1);
    expect(vendors()[0].name).toBe("Desert Gypsum Supply");
  });
});

describe("updateVendor returns its refusals", () => {
  beforeEach(() => {
    db.seed("vendor", { id: "v_1", companyId: "co_1", name: "Original" });
  });

  it("says it was not found when it belongs to another company", async () => {
    db.seed("vendor", { id: "v_other", companyId: "co_2", name: "Theirs" });
    expect(await refusal(updateVendor("v_other", form({ name: "Renamed" })))).toBe(
      "Vendor not found",
    );
    expect(db.rows("vendor").find((row) => row.id === "v_other")?.name).toBe("Theirs");
  });

  it("says the name is required, and leaves the row alone", async () => {
    expect(await refusal(updateVendor("v_1", form({ name: "" })))).toBe("Vendor name is required");
    expect(db.rows("vendor").find((row) => row.id === "v_1")?.name).toBe("Original");
  });

  it("still saves the edit when the form is right", async () => {
    expect(await updateVendor("v_1", form({ name: "Renamed" }))).toEqual({ ok: true });
    expect(db.rows("vendor").find((row) => row.id === "v_1")?.name).toBe("Renamed");
  });
});

describe("deleteVendor returns its refusals", () => {
  beforeEach(() => {
    db.seed("vendor", { id: "v_1", companyId: "co_1", name: "Desert Gypsum Supply" });
  });

  it("returns the owner-only refusal rather than throwing it", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect(await refusal(deleteVendor("v_1"))).toBe("Only the account owner can remove a vendor");
    expect(vendors()).toHaveLength(1);
  });

  it("says it was not found", async () => {
    expect(await refusal(deleteVendor("nope"))).toBe("Vendor not found");
  });

  it("refuses while a material order still names the vendor, and says how many", async () => {
    db.seed("materialOrder", { id: "mo_1", companyId: "co_1", vendorId: "v_1" });

    const message = await refusal(deleteVendor("v_1"));
    // The count and the name both, because "this vendor is in use" sends
    // somebody hunting through every job for the order that is blocking it.
    expect(message).toContain("Desert Gypsum Supply");
    expect(message).toContain("1 material order");
    expect(vendors()).toHaveLength(1);
  });

  it("pluralises the count", async () => {
    db.seed("materialOrder", { id: "mo_1", companyId: "co_1", vendorId: "v_1" });
    db.seed("materialOrder", { id: "mo_2", companyId: "co_1", vendorId: "v_1" });

    expect(await refusal(deleteVendor("v_1"))).toContain("2 material orders");
  });

  it("counts only THIS vendor's orders — another vendor's must not block it", async () => {
    // Without this case the guard would pass its tests while refusing every
    // delete on any account that had ever ordered anything.
    db.seed("vendor", { id: "v_2", companyId: "co_1", name: "Other Supply" });
    db.seed("materialOrder", { id: "mo_1", companyId: "co_1", vendorId: "v_2" });

    expect(await deleteVendor("v_1")).toEqual({ ok: true });
    expect(vendors().map((row) => row.id)).toEqual(["v_2"]);
  });

  it("still removes a vendor with no orders against it", async () => {
    expect(await deleteVendor("v_1")).toEqual({ ok: true });
    expect(vendors()).toHaveLength(0);
  });
});

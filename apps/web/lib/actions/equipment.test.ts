import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import type { ActionResult } from "./shared";

/**
 * Every refusal this module makes must be RETURNED, not thrown.
 *
 * See the long note in `punchLists.test.ts` for why a throw cannot be
 * allowed to count: production replaces a thrown Server Action message with
 * React's own "omitted in production builds" boilerplate, so "Equipment name
 * is required" reads perfectly in `next dev` and never once reached a
 * foreman. `refusal()` fails loudly on a throw rather than accepting it.
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

const { createEquipment, updateEquipment, deleteEquipment } = await import("./equipment");

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

function equipment() {
  return db.rows("equipment");
}

beforeEach(() => {
  db = new FakeDb();
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("createEquipment returns its refusals", () => {
  it("says the name is required, and writes nothing", async () => {
    expect(await refusal(createEquipment(form({ name: "   ", type: "Lift" })))).toBe(
      "Equipment name is required",
    );
    expect(equipment()).toHaveLength(0);
  });

  it("returns the job-function refusal rather than throwing it", async () => {
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING"; // holds no MANAGE_FIELD
    expect(await refusal(createEquipment(form({ name: "Genie S-45" })))).toMatch(
      /part of your job function/,
    );
    expect(equipment()).toHaveLength(0);
  });

  // The control: every assertion above is satisfied by an action that
  // refuses everything, so one has to get through.
  it("still adds the piece when the form is right", async () => {
    expect(await createEquipment(form({ name: "Genie S-45", assetTag: "EQ-11" }))).toEqual({
      ok: true,
    });
    expect(equipment()).toHaveLength(1);
    expect(equipment()[0].name).toBe("Genie S-45");
    // Blank optional fields mean "not set", stored as null rather than "".
    expect(equipment()[0].type).toBeNull();
  });
});

describe("updateEquipment returns its refusals", () => {
  beforeEach(() => {
    db.seed("equipment", { id: "eq_1", companyId: "co_1", name: "Original" });
  });

  it("says it was not found when it belongs to another company", async () => {
    db.seed("equipment", { id: "eq_other", companyId: "co_2", name: "Theirs" });
    expect(await refusal(updateEquipment("eq_other", form({ name: "Renamed" })))).toBe(
      "Equipment not found",
    );
    expect(db.rows("equipment").find((row) => row.id === "eq_other")?.name).toBe("Theirs");
  });

  it("says the name is required, and leaves the row alone", async () => {
    expect(await refusal(updateEquipment("eq_1", form({ name: "" })))).toBe(
      "Equipment name is required",
    );
    expect(db.rows("equipment").find((row) => row.id === "eq_1")?.name).toBe("Original");
  });

  it("still saves the edit when the form is right", async () => {
    expect(await updateEquipment("eq_1", form({ name: "Renamed" }))).toEqual({ ok: true });
    expect(db.rows("equipment").find((row) => row.id === "eq_1")?.name).toBe("Renamed");
  });
});

describe("deleteEquipment returns its refusals", () => {
  beforeEach(() => {
    db.seed("equipment", { id: "eq_1", companyId: "co_1", name: "Genie S-45" });
  });

  it("returns the owner-only refusal rather than throwing it", async () => {
    context.role = "MEMBER";
    // FIELD holds MANAGE_FIELD, so the capability check passes and only the
    // owner check can refuse — which is the one `assertOwner` used to throw.
    context.jobFunction = "FIELD";
    expect(await refusal(deleteEquipment("eq_1"))).toBe(
      "Only the account owner can remove a piece of equipment",
    );
    expect(equipment()).toHaveLength(1);
  });

  it("says it was not found", async () => {
    expect(await refusal(deleteEquipment("nope"))).toBe("Equipment not found");
  });

  it("still removes the piece for an owner", async () => {
    expect(await deleteEquipment("eq_1")).toEqual({ ok: true });
    expect(equipment()).toHaveLength(0);
  });
});

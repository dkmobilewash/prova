import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import type { ActionResult } from "./shared";

/**
 * Every refusal this module makes must be RETURNED, not thrown.
 *
 * WHY THAT IS THE ASSERTION AND NOT "it failed". Production replaces the
 * message of any error thrown from a Server Action with React's own
 * boilerplate — the installed react-server-dom-webpack's production
 * `emitErrorChunk(request, id, digest)` takes no error argument at all, and
 * the browser's `resolveErrorProd()` takes none either and builds a fixed
 * "the specific message is omitted in production builds" Error. So a guard
 * that throws reads perfectly in development, in `next dev`, and in every
 * test written with `expect(...).rejects.toThrow(...)` — and shows a real
 * user two hundred characters about production builds.
 *
 * A test that only asserts failure cannot tell those two apart. `refusal()`
 * below therefore fails LOUDLY on a throw, and says why, so reverting any
 * conversion in this module turns a test red instead of quietly passing.
 */

let db = new FakeDb();

/** Mutable so a test can change who is asking. OWNER holds every
 * capability by construction (lib/permissions.ts rule 1). */
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

const {
  createPunchListItem,
  updatePunchListItem,
  setPunchListItemDone,
  deletePunchListItem,
} = await import("./punchLists");

/** Awaits an action and refuses to let a THROW count as a refusal.
 *
 * Returns the sentence, so the caller asserts on the words a person reads. */
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

function items() {
  return db.rows("punchListItem");
}

beforeEach(() => {
  db = new FakeDb();
  context.role = "OWNER";
  context.jobFunction = null;
  db.seed("job", { id: "job_1", companyId: "co_1" });
  // Another company's job, to prove ownership is checked rather than just
  // existence — without this row "Job not found" passes for the wrong reason.
  db.seed("job", { id: "job_other", companyId: "co_2" });
});

describe("createPunchListItem returns its refusals", () => {
  it("says the description is required, and writes nothing", async () => {
    expect(await refusal(createPunchListItem(form({ jobId: "job_1", description: "  " })))).toBe(
      "Description is required",
    );
    expect(items()).toHaveLength(0);
  });

  it("says to pick a job", async () => {
    expect(await refusal(createPunchListItem(form({ description: "Grid out of level" })))).toBe(
      "Pick a job",
    );
    expect(items()).toHaveLength(0);
  });

  it("says the job was not found when it belongs to another company", async () => {
    expect(
      await refusal(
        createPunchListItem(form({ jobId: "job_other", description: "Grid out of level" })),
      ),
    ).toBe("Job not found");
    expect(items()).toHaveLength(0);
  });

  it("returns the job-function refusal rather than throwing it", async () => {
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING"; // holds no MANAGE_FIELD
    expect(
      await refusal(createPunchListItem(form({ jobId: "job_1", description: "Grid" }))),
    ).toMatch(/part of your job function/);
    expect(items()).toHaveLength(0);
  });

  // The control. Without it every assertion above is satisfied by an action
  // that refuses everything.
  it("still adds the item when the form is right", async () => {
    const result = await createPunchListItem(form({ jobId: "job_1", description: "Grid" }));
    expect(result).toEqual({ ok: true });
    expect(items()).toHaveLength(1);
    expect(items()[0].description).toBe("Grid");
  });
});

describe("updatePunchListItem returns its refusals", () => {
  beforeEach(() => {
    db.seed("punchListItem", {
      id: "item_1",
      companyId: "co_1",
      jobId: "job_1",
      description: "Original",
    });
  });

  it("says the item was not found when it belongs to another company", async () => {
    db.seed("punchListItem", { id: "item_other", companyId: "co_2", jobId: "job_1", description: "x" });
    expect(
      await refusal(updatePunchListItem("item_other", form({ jobId: "job_1", description: "New" }))),
    ).toBe("Punch list item not found");
  });

  it("says the description is required, and leaves the row alone", async () => {
    expect(await refusal(updatePunchListItem("item_1", form({ jobId: "job_1", description: "" })))).toBe(
      "Description is required",
    );
    expect(items()[0].description).toBe("Original");
  });

  it("says to pick a job", async () => {
    expect(await refusal(updatePunchListItem("item_1", form({ description: "New" })))).toBe(
      "Pick a job",
    );
    expect(items()[0].description).toBe("Original");
  });

  it("says the job was not found when moving the item to another company's job", async () => {
    expect(
      await refusal(updatePunchListItem("item_1", form({ jobId: "job_other", description: "New" }))),
    ).toBe("Job not found");
    expect(items()[0].jobId).toBe("job_1");
  });

  it("still saves the edit when the form is right", async () => {
    expect(await updatePunchListItem("item_1", form({ jobId: "job_1", description: "New" }))).toEqual({
      ok: true,
    });
    expect(items()[0].description).toBe("New");
  });
});

describe("setPunchListItemDone returns its refusal", () => {
  it("says the item was not found", async () => {
    expect(await refusal(setPunchListItemDone("nope", true))).toBe("Punch list item not found");
  });

  it("still ticks a real item off", async () => {
    db.seed("punchListItem", { id: "item_1", companyId: "co_1", jobId: "job_1", isDone: false });
    expect(await setPunchListItemDone("item_1", true)).toEqual({ ok: true });
    expect(items()[0].isDone).toBe(true);
  });
});

describe("deletePunchListItem returns its refusals", () => {
  beforeEach(() => {
    db.seed("punchListItem", { id: "item_1", companyId: "co_1", jobId: "job_1", description: "x" });
  });

  it("returns the owner-only refusal rather than throwing it", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD"; // holds MANAGE_FIELD, so only the owner
    // check can refuse — which is the point: `assertOwner` THREW this one.
    expect(await refusal(deletePunchListItem("item_1"))).toBe(
      "Only the account owner can remove a punch list item",
    );
    expect(items()).toHaveLength(1);
  });

  it("says the item was not found", async () => {
    expect(await refusal(deletePunchListItem("nope"))).toBe("Punch list item not found");
  });

  it("still removes the item for an owner", async () => {
    expect(await deletePunchListItem("item_1")).toEqual({ ok: true });
    expect(items()).toHaveLength(0);
  });
});

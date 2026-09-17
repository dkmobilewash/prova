import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import type { ActionResult } from "./shared";

/**
 * Purchase order numbers, and the arithmetic that hangs off them.
 *
 * WHAT THIS FILE IS FOR, in one sentence: a PO number is the number a
 * vendor's invoice quotes back at you months later, so a number handed out
 * twice on one job is an accounts-payable dispute that neither side can
 * settle from its own paperwork.
 *
 * The three properties below are each written so they FAIL against
 * `max(number) + 1`, which is the implementation this rule exists to
 * forbid and the one #224 actually shipped on invoices:
 *
 *   1. numbers are issued in sequence;
 *   2. a number is never REISSUED after the order carrying it is deleted —
 *      the counter only increments, so 3 stays retired and the next is 4.
 *      This is the one `max(n)+1` fails outright;
 *   3. the bump and the insert are ONE transaction — a failed insert must
 *      leave the counter exactly where it was, and a split pair is
 *      `max(n)+1` again wearing a counter's clothes.
 *
 * `counterCensus.test.ts` already holds property 3 STRUCTURALLY, by
 * scanning for a bump on a non-transaction client. This file holds it
 * BEHAVIOURALLY, by making the insert fail and reading the counter back —
 * the census cannot see a transaction that rolls back incorrectly, and a
 * source scan is not evidence that the rollback works.
 *
 * Refusals are asserted through `refusal()`, which treats a THROW as a
 * failure rather than as a pass. Production redacts a thrown Server Action
 * message to a digest, so a refusal that throws renders as a dead button:
 * the click does nothing and nothing says why. A test written
 * `expect(...).rejects.toThrow(...)` would be green for exactly as long as
 * that defect existed.
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

const {
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  addPurchaseOrderLine,
  deletePurchaseOrderLine,
} = await import("./purchaseOrders");

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

async function succeeds(pending: Promise<ActionResult>): Promise<void> {
  const result = await pending;
  if (!result.ok) throw new Error(`expected success, got refusal: ${result.error}`);
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** A complete, valid raise-an-order submission, so each case below changes
 * exactly one thing. */
function raise(overrides: Record<string, string> = {}) {
  return form({
    jobId: "job_1",
    vendorId: "vendor_1",
    title: "Quiet Rock — level 3 corridors",
    awardedOn: "2026-09-01",
    ...overrides,
  });
}

/** A complete, valid line. The customer's own example. */
function line(overrides: Record<string, string> = {}) {
  return form({
    description: "Quiet Rock 545, 5/8in 4x8",
    quantity: "104",
    unit: "sheets",
    unitCost: "18.75",
    ...overrides,
  });
}

function orders() {
  return db.rows("purchaseOrder");
}

/** The numbers actually on the job's orders, in the order they were
 * raised. */
function numbers(jobId = "job_1") {
  return orders()
    .filter((o) => o.jobId === jobId)
    .map((o) => o.number as number);
}

function counter(jobId = "job_1") {
  const row = db.rows("purchaseOrderCounter").find((c) => c.jobId === jobId);
  return row ? (row.lastNumber as number) : null;
}

beforeEach(() => {
  db = new FakeDb();
  context.role = "OWNER";
  context.jobFunction = null;
  db.seed("job", { id: "job_1", companyId: "co_1" });
  db.seed("job", { id: "job_2", companyId: "co_1" });
  // Another company's rows, so "not found" cannot pass merely because the
  // row is absent.
  db.seed("job", { id: "job_other", companyId: "co_2" });
  db.seed("vendor", { id: "vendor_1", companyId: "co_1", name: "Pacific Gypsum Supply" });
  db.seed("vendor", { id: "vendor_other", companyId: "co_2", name: "Someone else's vendor" });
});

describe("purchase order numbers are issued in sequence", () => {
  it("starts at 1 and counts up, per job", async () => {
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(createPurchaseOrder(raise()));
    expect(numbers()).toEqual([1, 2, 3]);
  });

  it("numbers each job independently", async () => {
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(createPurchaseOrder(raise({ jobId: "job_2" })));
    await succeeds(createPurchaseOrder(raise()));
    expect(numbers("job_1")).toEqual([1, 2]);
    expect(numbers("job_2")).toEqual([1]);
  });

  it("comes from the counter row, which only ever increments", async () => {
    await succeeds(createPurchaseOrder(raise()));
    expect(counter()).toBe(1);
    await succeeds(createPurchaseOrder(raise()));
    expect(counter()).toBe(2);
  });
});

describe("a number is never reissued", () => {
  it("retires the number of a deleted order — the next one is still the next", async () => {
    // THE PROPERTY `max(number) + 1` CANNOT HAVE. Raise three, delete the
    // third, raise a fourth. Derived from the surviving rows the next
    // number would be 3 again, and two different commitments — possibly to
    // two different vendors — would carry one number.
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(createPurchaseOrder(raise()));
    expect(numbers()).toEqual([1, 2, 3]);

    const third = orders().find((o) => o.number === 3)!;
    await succeeds(deletePurchaseOrder(third.id));
    expect(numbers()).toEqual([1, 2]);

    await succeeds(createPurchaseOrder(raise()));
    expect(numbers()).toEqual([1, 2, 4]);
    expect(numbers()).not.toContain(3);
  });

  it("retires a number even when every order on the job is deleted", async () => {
    // The harder half of the same property: with no rows left at all,
    // max(number) has nothing to read and would restart at 1.
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(createPurchaseOrder(raise()));
    for (const order of [...orders()]) await succeeds(deletePurchaseOrder(order.id));
    expect(orders()).toHaveLength(0);

    await succeeds(createPurchaseOrder(raise()));
    expect(numbers()).toEqual([3]);
  });
});

describe("the counter bump and the insert are one transaction", () => {
  it("leaves the counter untouched when the insert fails", async () => {
    await succeeds(createPurchaseOrder(raise()));
    expect(counter()).toBe(1);

    // The insert throws AFTER the counter has been bumped. If the two are
    // not in one transaction the counter keeps the bump, and the number it
    // burned is lost — worse, a split pair is `max(n)+1` again: whatever
    // reads the counter next is reading a figure no order corresponds to.
    db.failNext = "purchaseOrder.create";
    await expect(createPurchaseOrder(raise())).rejects.toThrow(
      "simulated database failure",
    );

    expect(counter()).toBe(1);
    expect(numbers()).toEqual([1]);

    // And the next real order takes 2 — not 3, which is what a counter
    // that kept the rolled-back bump would issue.
    await succeeds(createPurchaseOrder(raise()));
    expect(numbers()).toEqual([1, 2]);
  });

  it("does not burn a number on a submission that is refused inside the transaction", async () => {
    await succeeds(createPurchaseOrder(raise()));
    expect(counter()).toBe(1);

    // `title` is parsed inside the create, i.e. inside the transaction and
    // AFTER the number has been issued. The refusal has to roll the bump
    // back with it.
    expect(await refusal(createPurchaseOrder(raise({ title: "" })))).toBe(
      "What this order is for is required",
    );
    expect(counter()).toBe(1);

    await succeeds(createPurchaseOrder(raise()));
    expect(numbers()).toEqual([1, 2]);
  });

  it("creates no counter row at all when the very first order fails", async () => {
    db.failNext = "purchaseOrder.create";
    await expect(createPurchaseOrder(raise())).rejects.toThrow();
    expect(counter()).toBeNull();

    await succeeds(createPurchaseOrder(raise()));
    expect(numbers()).toEqual([1]);
  });
});

describe("raising an order returns its refusals rather than throwing them", () => {
  it("names the job it cannot find, including another company's", async () => {
    expect(await refusal(createPurchaseOrder(raise({ jobId: "job_other" })))).toBe(
      "Job not found",
    );
    expect(await refusal(createPurchaseOrder(raise({ jobId: "" })))).toBe("Job is required");
    expect(orders()).toHaveLength(0);
  });

  it("names the vendor it cannot find, including another company's", async () => {
    expect(await refusal(createPurchaseOrder(raise({ vendorId: "vendor_other" })))).toBe(
      "Vendor not found",
    );
    expect(await refusal(createPurchaseOrder(raise({ vendorId: "" })))).toBe(
      "Vendor is required",
    );
    expect(orders()).toHaveLength(0);
  });

  it("refuses an expected date that falls before the award", async () => {
    expect(
      await refusal(createPurchaseOrder(raise({ expectedOn: "2026-08-31" }))),
    ).toBe("The expected date can't be before the order was awarded");
    expect(orders()).toHaveLength(0);
  });

  it("takes an expected date on the award day itself", async () => {
    await succeeds(createPurchaseOrder(raise({ expectedOn: "2026-09-01" })));
    expect(orders()).toHaveLength(1);
  });

  it("stores the awarded date as entered, at UTC midnight", async () => {
    await succeeds(createPurchaseOrder(raise({ awardedOn: "2026-09-01" })));
    expect(orders()[0].awardedOn).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });
});

describe("deleting an order", () => {
  it("is refused for anyone but the owner, in a sentence they can read", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    context.role = "ADMIN";
    expect(await refusal(deletePurchaseOrder(order.id))).toBe(
      "Only the account owner can delete a purchase order",
    );
    expect(orders()).toHaveLength(1);
  });

  it("refuses while lines are on it, and names how many", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    await succeeds(addPurchaseOrderLine(order.id, line()));
    expect(await refusal(deletePurchaseOrder(order.id))).toContain("This order has 1 line on it");
    expect(orders()).toHaveLength(1);

    await succeeds(addPurchaseOrderLine(order.id, line()));
    expect(await refusal(deletePurchaseOrder(order.id))).toContain("This order has 2 lines on it");
  });

  it("goes through once the lines are removed", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    await succeeds(addPurchaseOrderLine(order.id, line()));
    const only = db.rows("purchaseOrderLine")[0];
    await succeeds(deletePurchaseOrderLine(only.id));
    await succeeds(deletePurchaseOrder(order.id));
    expect(orders()).toHaveLength(0);
  });
});

describe("a line records what is being bought", () => {
  it("keeps the quantity, unit and unit cost the person typed", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    await succeeds(addPurchaseOrderLine(order.id, line()));

    const stored = db.rows("purchaseOrderLine")[0];
    expect(stored.description).toBe("Quiet Rock 545, 5/8in 4x8");
    expect(stored.quantity).toBe("104");
    expect(stored.unit).toBe("sheets");
    expect(stored.unitCost).toBe("18.75");
  });

  it("stores no total — the extended amount is derived, never a column", async () => {
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(addPurchaseOrderLine(orders()[0].id, line()));
    const stored = db.rows("purchaseOrderLine")[0];
    expect(stored).not.toHaveProperty("total");
    expect(stored).not.toHaveProperty("lineTotal");
    expect(stored).not.toHaveProperty("extendedCost");
  });

  it("appends lines in the order they were entered", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    await succeeds(addPurchaseOrderLine(order.id, line({ description: "First" })));
    await succeeds(addPurchaseOrderLine(order.id, line({ description: "Second" })));
    await succeeds(addPurchaseOrderLine(order.id, line({ description: "Third" })));
    expect(db.rows("purchaseOrderLine").map((l) => l.sortOrder)).toEqual([0, 1, 2]);
  });

  it("does not let a removed line make two lines share a position", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    await succeeds(addPurchaseOrderLine(order.id, line({ description: "First" })));
    await succeeds(addPurchaseOrderLine(order.id, line({ description: "Second" })));
    const second = db.rows("purchaseOrderLine").find((l) => l.description === "Second")!;
    await succeeds(deletePurchaseOrderLine(second.id));
    await succeeds(addPurchaseOrderLine(order.id, line({ description: "Third" })));

    const positions = db.rows("purchaseOrderLine").map((l) => l.sortOrder);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("refuses a negative quantity or unit cost in a sentence", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    expect(await refusal(addPurchaseOrderLine(order.id, line({ quantity: "-1" })))).toBe(
      "Quantity can't be negative",
    );
    expect(await refusal(addPurchaseOrderLine(order.id, line({ unitCost: "-0.01" })))).toBe(
      "Unit cost can't be negative",
    );
    expect(await refusal(addPurchaseOrderLine(order.id, line({ quantity: "lots" })))).toBe(
      "Quantity must be a number",
    );
    expect(db.rows("purchaseOrderLine")).toHaveLength(0);
  });

  it("refuses a cost code that belongs to another job", async () => {
    db.seed("jobLineItem", { id: "sov_other", jobId: "job_2", description: "Level 5 finish" });
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    expect(
      await refusal(addPurchaseOrderLine(order.id, line({ lineItemId: "sov_other" }))),
    ).toBe("That cost code isn't on this job");
    expect(db.rows("purchaseOrderLine")).toHaveLength(0);
  });

  it("takes a cost code that is on this job", async () => {
    db.seed("jobLineItem", { id: "sov_1", jobId: "job_1", description: "Corridor drywall" });
    await succeeds(createPurchaseOrder(raise()));
    await succeeds(addPurchaseOrderLine(orders()[0].id, line({ lineItemId: "sov_1" })));
    expect(db.rows("purchaseOrderLine")[0].lineItemId).toBe("sov_1");
  });
});

describe("editing an order", () => {
  it("cannot move it to another job or change its number", async () => {
    await succeeds(createPurchaseOrder(raise()));
    const order = orders()[0];
    await succeeds(
      updatePurchaseOrder(
        order.id,
        raise({ jobId: "job_2", title: "Renamed", awardedOn: "2026-09-02" }),
      ),
    );
    const after = orders()[0];
    // Both are what the vendor files the order under and what their invoice
    // will quote back, so neither moves retroactively.
    expect(after.jobId).toBe("job_1");
    expect(after.number).toBe(1);
    expect(after.title).toBe("Renamed");
  });

  it("refuses an order belonging to another company", async () => {
    db.seed("purchaseOrder", {
      id: "po_other",
      companyId: "co_2",
      jobId: "job_other",
      number: 1,
    });
    expect(await refusal(updatePurchaseOrder("po_other", raise()))).toBe(
      "Purchase order not found",
    );
  });
});

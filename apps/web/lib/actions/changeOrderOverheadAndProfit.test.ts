import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import type { ActionResult } from "./shared";

/**
 * What approving a change order does to the CONTRACT VALUE once overhead
 * and profit exists.
 *
 * The arithmetic is proven in lib/overhead-and-profit.test.ts. This file
 * proves the thing arithmetic cannot: that the markup the GC agreed to
 * actually LANDS. Contract value, WIP, retainage and every pay application
 * are `SUM(JobLineItem)`, so a change order whose document says
 * "$10,000 + 15% = $11,500" and whose approval writes $10,000 of line
 * items is short by exactly the markup — on every approved change order,
 * with every total on screen internally consistent, and invisible until
 * somebody adds up the invoices. No unit test of a pure function can see
 * that; only running the action and reading the rows back can.
 *
 * `Prisma` comes from the real package because the module under test does
 * Decimal arithmetic; only `prisma` itself is the in-memory fake.
 */

let db = new FakeDb();

const context = {
  company: { id: "co_1", overheadAndProfitPercent: null as unknown },
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

vi.mock("@prova/db", async () => {
  const actual = await vi.importActual<typeof import("@prova/db")>("@prova/db");
  return {
    Prisma: actual.Prisma,
    get prisma() {
      return db.client();
    },
  };
});

const { Prisma } = await import("@prova/db");
const { approveChangeOrder, createChangeOrder, setChangeOrderOverheadAndProfit } = await import(
  "./changeOrders"
);

const d = (value: string | number) => new Prisma.Decimal(value);

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

async function succeeds(pending: Promise<ActionResult>): Promise<void> {
  const result = await pending;
  if (!result.ok) throw new Error(`the action REFUSED: ${result.error}`);
}

async function refusal(pending: Promise<ActionResult>): Promise<string> {
  let result: ActionResult;
  try {
    result = await pending;
  } catch (err) {
    throw new Error(
      `THREW instead of returning: "${err instanceof Error ? err.message : String(err)}". ` +
        `A thrown Server Action message is redacted in production, so this sentence would ` +
        `never reach the user.`,
    );
  }
  if (result.ok) throw new Error("the action SUCCEEDED — expected it to refuse");
  return result.error;
}

/** One SUBMITTED change order adding 10 @ $1,000 = $10,000 of new scope. */
function seedSubmittedChangeOrder(overheadAndProfitPercent: unknown) {
  db.seed("job", { id: "job_1", companyId: "co_1", status: "CONTRACTED" });
  db.seed("changeOrder", {
    id: "co_row_1",
    jobId: "job_1",
    number: 3,
    title: "Soffit framing at the corridor",
    status: "SUBMITTED",
    submittedOn: new Date("2026-09-01T00:00:00.000Z"),
    appliedAt: null,
    overheadAndProfitPercent,
  });
  db.seed("changeOrderProposal", {
    id: "prop_1",
    changeOrderId: "co_row_1",
    changeType: "ADD",
    lineItemId: null,
    description: "Soffit framing",
    unit: "LF",
    quantity: d(10),
    unitPrice: d(1000),
    budgetedUnitCost: d(600),
    currentEstimatedUnitCost: d(600),
    tradeScope: null,
    previousQuantity: null,
    previousUnitPrice: null,
    previousIsDeleted: null,
  });
}

/** What the job's line items are worth — the same arithmetic contract
 * value, WIP and every pay application use. */
function contractValue(): number {
  return db
    .rows("jobLineItem")
    .filter((row) => row.jobId === "job_1" && row.isDeleted !== true)
    .reduce(
      (sum, row) =>
        sum +
        (row.unitPrice == null ? 0 : Number(row.quantity as never) * Number(row.unitPrice as never)),
      0,
    );
}

function overheadLines() {
  return db
    .rows("jobLineItem")
    .filter((row) => String(row.description).startsWith("Overhead and profit"));
}

beforeEach(() => {
  db = new FakeDb();
  context.company.overheadAndProfitPercent = null;
});

describe("approving a change order that carries overhead and profit", () => {
  it("moves the contract value by the TOTAL, not the subtotal", async () => {
    seedSubmittedChangeOrder(d(15));

    await succeeds(approveChangeOrder("co_row_1", form({ decidedOn: "2026-09-10" })));

    // 10 @ $1,000 = $10,000 of scope, plus 15% = $1,500, total $11,500.
    // The scope line and the markup line are separate rows, which is what
    // makes the markup visible on the contract summary and the GC's portal
    // rather than buried inside a price.
    expect(contractValue()).toBe(11500);

    const markup = overheadLines();
    expect(markup).toHaveLength(1);
    expect(markup[0].description).toBe("Overhead and profit (15%) — CO #3");
    expect(Number(markup[0].unitPrice as never)).toBe(1500);
    expect(Number(markup[0].quantity as never)).toBe(1);
    // Tagged to the change order that raised it, so reopening deletes it
    // with the rest of that change order's additions.
    expect(markup[0].originChangeOrderId).toBe("co_row_1");
    // Cost is stated as zero rather than left unknown: a markup has no
    // direct cost, and a null would read as "nobody has forecast this".
    expect(Number(markup[0].budgetedUnitCost as never)).toBe(0);
  });

  it("adds NOTHING when no rate was recorded — and does not add a 0% line", async () => {
    seedSubmittedChangeOrder(null);

    await succeeds(approveChangeOrder("co_row_1", form({ decidedOn: "2026-09-10" })));

    expect(contractValue()).toBe(10000);
    expect(overheadLines()).toHaveLength(0);
  });

  it("adds no line for a recorded 0%, which is worth nothing to put on a contract", async () => {
    seedSubmittedChangeOrder(d(0));

    await succeeds(approveChangeOrder("co_row_1", form({ decidedOn: "2026-09-10" })));

    expect(contractValue()).toBe(10000);
    expect(overheadLines()).toHaveLength(0);
  });

  it("carries the markup back on a credit change order", async () => {
    // A deduct: the job already has a $4,000 line and the change order
    // removes it. Subtotal −$4,000, 15% markup −$600, total −$4,600.
    db.seed("job", { id: "job_1", companyId: "co_1", status: "CONTRACTED" });
    db.seed("jobLineItem", {
      id: "line_1",
      jobId: "job_1",
      description: "Soffit framing",
      quantity: d(8),
      unitPrice: d(500),
      isDeleted: false,
    });
    db.seed("changeOrder", {
      id: "co_row_1",
      jobId: "job_1",
      number: 4,
      title: "Corridor soffit deleted",
      status: "SUBMITTED",
      submittedOn: new Date("2026-09-01T00:00:00.000Z"),
      appliedAt: null,
      overheadAndProfitPercent: d(15),
    });
    db.seed("changeOrderProposal", {
      id: "prop_1",
      changeOrderId: "co_row_1",
      changeType: "REMOVE",
      lineItemId: "line_1",
      quantity: null,
      unitPrice: null,
      previousQuantity: null,
      previousUnitPrice: null,
      previousIsDeleted: null,
    });

    await succeeds(approveChangeOrder("co_row_1", form({ decidedOn: "2026-09-10" })));

    expect(contractValue()).toBe(-600);
    expect(Number(overheadLines()[0].unitPrice as never)).toBe(-600);
  });

  it("computes the markup on what the change order MOVES, not on the job", async () => {
    // A live $50,000 of existing scope that this change order does not
    // touch. A markup taken on the job's contract value instead of on the
    // change order's own subtotal would be $9,000 rather than $1,500 —
    // the kind of error that looks like a plausible number.
    seedSubmittedChangeOrder(d(15));
    db.seed("jobLineItem", {
      id: "line_existing",
      jobId: "job_1",
      description: "Existing contracted scope",
      quantity: d(100),
      unitPrice: d(500),
      isDeleted: false,
    });

    await succeeds(approveChangeOrder("co_row_1", form({ decidedOn: "2026-09-10" })));

    expect(Number(overheadLines()[0].unitPrice as never)).toBe(1500);
    expect(contractValue()).toBe(50000 + 11500);
  });
});

describe("where the rate comes from", () => {
  it("is COPIED from the company default onto a new draft, not read through to it", async () => {
    db.seed("job", { id: "job_1", companyId: "co_1", status: "CONTRACTED" });
    context.company.overheadAndProfitPercent = d(15);

    await succeeds(createChangeOrder("job_1", form({ title: "Soffit framing" })));

    const [changeOrder] = db.rows("changeOrder");
    expect(Number(changeOrder.overheadAndProfitPercent as never)).toBe(15);

    // The copy is what makes a sent document stable: moving the company
    // default afterwards must not move a total the GC is holding.
    context.company.overheadAndProfitPercent = d(25);
    expect(Number(db.rows("changeOrder")[0].overheadAndProfitPercent as never)).toBe(15);
  });

  it("copies NOTHING when the company has set nothing — the draft is unset, not 0%", async () => {
    db.seed("job", { id: "job_1", companyId: "co_1", status: "CONTRACTED" });

    await succeeds(createChangeOrder("job_1", form({ title: "Soffit framing" })));

    expect(db.rows("changeOrder")[0].overheadAndProfitPercent).toBeNull();
  });

  it("can be overridden on a draft, and CLEARED back to unset", async () => {
    db.seed("job", { id: "job_1", companyId: "co_1", status: "CONTRACTED" });
    db.seed("changeOrder", {
      id: "co_row_1",
      jobId: "job_1",
      number: 1,
      status: "DRAFT",
      overheadAndProfitPercent: d(15),
    });

    await succeeds(setChangeOrderOverheadAndProfit("co_row_1", form({ overheadAndProfitPercent: "10" })));
    expect(String(db.rows("changeOrder")[0].overheadAndProfitPercent)).toBe("10");

    // Blank stores null. Clearing a copied-in default has to be reachable,
    // or the only way to remove a markup would be to invent a zero.
    await succeeds(setChangeOrderOverheadAndProfit("co_row_1", form({ overheadAndProfitPercent: "" })));
    expect(db.rows("changeOrder")[0].overheadAndProfitPercent).toBeNull();
  });

  it("refuses — by RETURNING — once the change order has gone to the GC", async () => {
    db.seed("job", { id: "job_1", companyId: "co_1", status: "CONTRACTED" });
    db.seed("changeOrder", {
      id: "co_row_1",
      jobId: "job_1",
      number: 3,
      status: "SUBMITTED",
      overheadAndProfitPercent: d(15),
    });

    const message = await refusal(
      setChangeOrderOverheadAndProfit("co_row_1", form({ overheadAndProfitPercent: "25" })),
    );
    expect(message).toMatch(/already been sent/);
    expect(Number(db.rows("changeOrder")[0].overheadAndProfitPercent as never)).toBe(15);
  });

  it("refuses a rate that would rewrite the total by a decimal mistake", async () => {
    db.seed("job", { id: "job_1", companyId: "co_1", status: "CONTRACTED" });
    db.seed("changeOrder", {
      id: "co_row_1",
      jobId: "job_1",
      number: 1,
      status: "DRAFT",
      overheadAndProfitPercent: null,
    });

    expect(
      await refusal(setChangeOrderOverheadAndProfit("co_row_1", form({ overheadAndProfitPercent: "1500" }))),
    ).toMatch(/15 for 15%/);
    expect(db.rows("changeOrder")[0].overheadAndProfitPercent).toBeNull();
  });
});

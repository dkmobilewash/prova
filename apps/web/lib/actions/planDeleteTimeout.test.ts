import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ── THE PLAN-DELETE PATH AT THE TRANSACTION EDGE (coordination/plan-delete-timeout.md) ──
 *
 * Production, 2026-11-26 18:45:39Z: pressing Delete plan threw P2028 — "timeout 5000 ms, however 5068 ms passed" — out of
 * previewDeleteTakeoffPlan's transaction, and the page showed its error boundary (production redacts a thrown action).
 * The preview round trip measured 6.2 s. Two halves, chosen for this caller as sync-p2028-callers.md requires:
 *   T1/T3 a failed transaction comes back as a sentence from all three actions, never a throw;
 *   T2    each of the three transactions asks for PLAN_DELETE_TX_MS (20 s) rather than Prisma's 5 s default.
 */
const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };
const txOptions: unknown[] = [];
let fail: Error | null = null;

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/takeoff/planDelete", async (actual) => ({
  ...(await actual<object>()),
  applyPlanDelete: async () => ({ label: "A-101" }),
}));
vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    $transaction: async (run: (tx: unknown) => unknown, options?: unknown) => {
      txOptions.push(options);
      if (fail !== null) throw fail;
      return run({ jobLineItem: { findMany: async () => [] }, takeoffPlan: { updateMany: async () => ({ count: 1 }) }, $executeRawUnsafe: async () => 0, job: { findUnique: async () => ({ status: "BID" }), findFirst: async () => ({ status: "BID" }) } });
    },
    takeoffPlan: {
      findFirst: async () => ({ deletedAt: new Date(), deleteUndo: { jobId: "job_1", runs: [], lines: [], emptied: [] }, fileName: "A-101.pdf", pages: [{ label: "A-101" }] }),
    },
  },
}));

const { previewDeleteTakeoffPlan, deleteTakeoffPlan, undoTakeoffPlanDelete } = await import("./takeoff");
const planDelete = await import("@/lib/takeoff/planDelete");
/** Read defensively, so that on a tree without the constant each case fails on its own rather than the file failing to load. */
const txMs = (): unknown => {
  try {
    return (planDelete as Record<string, unknown>).PLAN_DELETE_TX_MS;
  } catch {
    return undefined;
  }
};

/** What production threw, in the shape Prisma throws it. */
const p2028 = () => Object.assign(new Error("Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5068 ms passed since the start of the transaction."), { code: "P2028" });

beforeEach(() => {
  txOptions.length = 0;
  fail = null;
});

describe("T1/T3: a transaction that fails comes back as a sentence, from every action on this path", () => {
  const actions = [
    ["the preview", () => previewDeleteTakeoffPlan("job_1", "plan_1")],
    ["the delete", () => deleteTakeoffPlan("job_1", "plan_1")],
    ["Undo", () => undoTakeoffPlanDelete("job_1", "plan_1")],
  ] as const;
  for (const [name, run] of actions) {
    it(`${name}: P2028 returns { ok: false } with words a person can act on, and does not throw`, async () => {
      fail = p2028();
      const result = await run();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Nothing was changed\. Try again\.$/);
        expect(result.error).not.toMatch(/P2028|Transaction|ms/);
      }
    });
  }
});

describe("T2: each of the three transactions asks for its own timeout", () => {
  it("is 20 s, set per caller (the global default stays 5 s)", () => {
    expect(txMs()).toBe(20_000);
  });
  it("the preview, the delete and Undo each pass it", async () => {
    await previewDeleteTakeoffPlan("job_1", "plan_1");
    await deleteTakeoffPlan("job_1", "plan_1");
    await undoTakeoffPlanDelete("job_1", "plan_1");
    expect(txOptions).toEqual([{ timeout: 20_000 }, { timeout: 20_000 }, { timeout: 20_000 }]);
  });
});

import { describe, expect, it, vi } from "vitest";

/**
 * Issue #103, finding 4, same shape as bid_status: `promisedFor: asc` with
 * no status filter meant the OLDEST orders — the ones most likely long
 * since delivered — survived `forModel`'s 40-row cap first, while an order
 * still waiting on material sorted to the back.
 *
 * There is no stored delivery status to filter the database on (state is
 * derived from the deliveries on every read — materialOrderLabels.ts), so
 * both the reordering and the OUTSTANDING filter happen in the handler,
 * after the deliveries are loaded.
 *
 * Fixture, deliberately in the DB's own `promisedFor: asc` order —
 * COMPLETE (2020) first, PARTIAL (2025), AWAITING (2026) last — so the
 * test fails if the handler trusts that order instead of reordering it.
 */

const ORDERS = [
  {
    number: 1,
    description: "Complete order",
    promisedFor: new Date("2020-01-01T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
    vendor: { name: "ABC Supply", phone: "555-0001" },
    deliveries: [
      { id: "d1", deliveredOn: new Date("2020-01-05T00:00:00.000Z"), completesOrder: true, notes: null },
    ],
  },
  {
    number: 2,
    description: "Partial order",
    promisedFor: new Date("2025-01-01T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
    vendor: { name: "ABC Supply", phone: "555-0001" },
    deliveries: [
      { id: "d2", deliveredOn: new Date("2025-01-10T00:00:00.000Z"), completesOrder: false, notes: null },
    ],
  },
  {
    number: 3,
    description: "Awaiting order",
    promisedFor: new Date("2026-09-01T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
    vendor: { name: "ABC Supply", phone: "555-0001" },
    deliveries: [],
  },
];

vi.mock("@prova/db", () => ({
  prisma: {
    materialOrder: {
      findMany: vi.fn(async () => ORDERS),
    },
    job: {
      findFirst: vi.fn(async () => ({ id: "job-1" })),
    },
  },
}));

async function askMaterialDeliveries(status?: string) {
  const { runTool } = await import("./handlers");
  return runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "material_deliveries",
    { status },
  );
}

describe("material_deliveries truncation and filtering", () => {
  it("puts outstanding orders ahead of a long-since-complete one, not behind it", async () => {
    const result = await askMaterialDeliveries();
    const descriptions = (result.data as Array<{ what: string }>).map((row) => row.what);
    expect(descriptions).toEqual(["Partial order", "Awaiting order", "Complete order"]);
  });

  it("carries the true outstanding count regardless of ordering or a truncated list", async () => {
    const result = await askMaterialDeliveries();
    expect(result.summary).toEqual({ totalOrderCount: 3, outstandingOrderCount: 2 });
  });

  it("answers only outstanding orders when asked for exactly that", async () => {
    const result = await askMaterialDeliveries("OUTSTANDING");
    const rows = result.data as Array<{ what: string }>;
    expect(rows.map((r) => r.what).sort()).toEqual(["Awaiting order", "Partial order"]);
  });
});

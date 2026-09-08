import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * addCostEntry's duplicate-submission guard, against a real Postgres.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it — CI has no
 * database. Run it against a SCRATCH one, exactly as backcharges.dbtest.ts
 * documents:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * #102: a doubled CostEntry moves percent complete and the over/under
 * billing figure quoted to a bonding company. The guard reads CostEntry
 * rows back with a `createdAt` window, which only a real database can
 * prove narrows correctly rather than matching everything or nothing.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { addCostEntry } = await import("./jobs");

let jobId = "";
let lineItemId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function costForm(overrides: Record<string, string> = {}) {
  return form({
    description: "Drywall sheets — Job Depot",
    amount: "500",
    category: "MATERIAL",
    ...overrides,
  });
}

describe("addCostEntry against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Cost Entry Test Co" } });
    context.company.id = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Cost Entry Test Job", status: "CONTRACTED" },
    });
    jobId = job.id;
    const lineItem = await prisma.jobLineItem.create({
      data: { jobId, description: "Level 3 drywall", quantity: "1", unitPrice: "50000" },
    });
    lineItemId = lineItem.id;
  });

  afterAll(async () => {
    await prisma.costEntry.deleteMany({ where: { lineItemId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("logs a cost entry", async () => {
    expect(await addCostEntry(jobId, lineItemId, costForm())).toEqual({ ok: true });
    expect(revalidated).toContain(`/jobs/${jobId}`);
    expect(await prisma.costEntry.count({ where: { lineItemId } })).toBe(1);
  });

  it("refuses an identical entry submitted again moments later", async () => {
    const result = await addCostEntry(jobId, lineItemId, costForm());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/moments ago/i);
    }
    expect(await prisma.costEntry.count({ where: { lineItemId } })).toBe(1);

    const sum = await prisma.costEntry.aggregate({ where: { lineItemId }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(500);
  });

  it("allows a second, genuinely distinct entry with a different description", async () => {
    expect(
      await addCostEntry(jobId, lineItemId, costForm({ description: "Drywall screws — Job Depot" })),
    ).toEqual({ ok: true });
    expect(await prisma.costEntry.count({ where: { lineItemId } })).toBe(2);
  });

  it("allows two real entries that share every visible field but happened minutes apart", async () => {
    // Age the existing $500 MATERIAL entry so it falls outside the guard's
    // window, the same way labor.dbtest.ts ages a TimeEntry — by deleting
    // and recreating with an explicit past createdAt, not by an update.
    const existing = await prisma.costEntry.findFirstOrThrow({
      where: { lineItemId, description: "Drywall sheets — Job Depot" },
    });
    await prisma.costEntry.delete({ where: { id: existing.id } });
    await prisma.costEntry.create({
      data: {
        lineItemId,
        description: "Drywall sheets — Job Depot",
        amount: "500",
        category: "MATERIAL",
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    expect(await addCostEntry(jobId, lineItemId, costForm())).toEqual({ ok: true });
    expect(await prisma.costEntry.count({ where: { lineItemId, description: "Drywall sheets — Job Depot" } })).toBe(
      2,
    );
  });
});

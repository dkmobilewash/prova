import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { loadReviewQueue } from "@/lib/takeoff/reviewQueueQuery";

/**
 * F2 of the new-job walkthrough v2, against a real database: once the company's
 * own markup is set, the review queue's price item asks for a COST and the
 * line's price is worked from it; before that, it asks for a price and the
 * action refuses.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { priceLineFromCost } = await import("./bidRecap");

const made: string[] = [];
async function newJob() {
  const company = await prisma.company.create({ data: { name: `Cost Pricing ${made.length}` } });
  const owner = await prisma.user.create({ data: { companyId: company.id, clerkId: `cp_${company.id}`, email: `cp_${company.id}@example.test`, role: "OWNER" } });
  made.push(company.id);
  context.company.id = company.id;
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Cost Pricing GC" } });
  const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Cost Pricing Job", status: "ESTIMATE" } });
  return { companyId: company.id, jobId: job.id };
}
const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
};
const MARKUP = { materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "8", profitPercent: "10" };

afterAll(async () => {
  for (const companyId of made) {
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId } } });
    await prisma.jobBidRecap.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.companyBidDefaults.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

describe("priceLineFromCost and the queue's price item", () => {
  it("without the four rates: the queue asks for a price, and the action refuses and writes nothing", async () => {
    const { companyId, jobId } = await newJob();
    await prisma.companyBidDefaults.create({ data: { companyId, materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "8" } });
    const line = await prisma.jobLineItem.create({ data: { jobId, description: "Studs", quantity: "100", unit: "ea", costCategory: "MATERIAL" } });
    const queue = await loadReviewQueue(companyId, jobId);
    expect(queue.items).toEqual([expect.objectContaining({ kind: "price", askCost: false, costCategory: "MATERIAL" })]);
    const result = await priceLineFromCost(jobId, line.id, form({ unitCost: "2" }));
    expect(result).toEqual({ ok: false, error: "Set your markup first: material, labor, overhead and profit." });
    const after = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect([after.budgetedUnitCost, after.unitPrice]).toEqual([null, null]);
  });

  it("with markup set: the queue asks for a cost, the price is the recap's, and the line leaves the queue", async () => {
    const { companyId, jobId } = await newJob();
    await prisma.companyBidDefaults.create({ data: { companyId, ...MARKUP } });
    const studs = await prisma.jobLineItem.create({ data: { jobId, description: "Studs", quantity: "100", unit: "ea", costCategory: "MATERIAL" } });
    const hang = await prisma.jobLineItem.create({ data: { jobId, description: "Hang and finish", quantity: "10", unit: "hr" } });
    expect((await loadReviewQueue(companyId, jobId)).items.map((item) => item.kind === "price" && [item.askCost, item.costCategory])).toEqual([
      [true, "MATERIAL"],
      [true, null],
    ]);

    // 100 × $2 material: 200 → 220 → 237.60 → 261.36, so $2.61.
    expect(await priceLineFromCost(jobId, studs.id, form({ unitCost: "2" }))).toEqual({ ok: true, value: { unitPrice: "2.61" } });
    // A line with no category is asked for one, and refused without it.
    expect(await priceLineFromCost(jobId, hang.id, form({ unitCost: "30" }))).toEqual({
      ok: false,
      error: "Say whether this line is material, labor or something else, so it gets the right markup.",
    });
    // 10 × $30 labor: 300 → 330 → 356.40 → 392.04, so $39.20.
    expect(await priceLineFromCost(jobId, hang.id, form({ unitCost: "30", costCategory: "LABOR" }))).toEqual({ ok: true, value: { unitPrice: "39.20" } });

    const lines = await prisma.jobLineItem.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => [l.budgetedUnitCost?.toString(), l.unitPrice?.toString(), l.costCategory])).toEqual([
      ["2", "2.61", "MATERIAL"],
      ["30", "39.2", "LABOR"],
    ]);
    // The forecast is the PM's, not this screen's.
    expect(lines.map((l) => l.currentEstimatedUnitCost)).toEqual([null, null]);
    expect((await loadReviewQueue(companyId, jobId)).items).toEqual([]);
  });

  it("a job's own recap rates win over the company's defaults", async () => {
    const { companyId, jobId } = await newJob();
    await prisma.companyBidDefaults.create({ data: { companyId, ...MARKUP } });
    await prisma.jobBidRecap.create({ data: { jobId, companyId, materialMarkupPercent: "20", laborMarkupPercent: "20", overheadPercent: "0", profitPercent: "0" } });
    const line = await prisma.jobLineItem.create({ data: { jobId, description: "Board", quantity: "10", unit: "sheets", costCategory: "MATERIAL" } });
    expect(await priceLineFromCost(jobId, line.id, form({ unitCost: "10" }))).toEqual({ ok: true, value: { unitPrice: "12.00" } });
  });

  it("refuses a blank cost, a line on another company's job, and a job past the estimate", async () => {
    const { companyId, jobId } = await newJob();
    await prisma.companyBidDefaults.create({ data: { companyId, ...MARKUP } });
    const line = await prisma.jobLineItem.create({ data: { jobId, description: "Studs", quantity: "5", costCategory: "MATERIAL" } });
    expect((await priceLineFromCost(jobId, line.id, form({ unitCost: "" }))).ok).toBe(false);
    const other = await newJob();
    expect((await priceLineFromCost(jobId, line.id, form({ unitCost: "2" }))).ok).toBe(false);
    context.company.id = companyId;
    await prisma.job.update({ where: { id: jobId }, data: { status: "CONTRACTED" } });
    expect((await priceLineFromCost(jobId, line.id, form({ unitCost: "2" }))).ok).toBe(false);
    expect((await prisma.jobLineItem.findUniqueOrThrow({ where: { id: line.id } })).unitPrice).toBeNull();
    void other;
  });
});

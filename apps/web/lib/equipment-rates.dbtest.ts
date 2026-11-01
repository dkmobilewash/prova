import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/** The rate actions against a real Postgres, and the figure a picked rate gives a
 * change order through the recap. */
const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createEquipmentRate, deleteEquipmentRate, updateEquipmentRate } = await import("./actions/equipmentRates");
const { createChangeOrder, proposeAddedScope } = await import("./actions/changeOrders");
const { priceLine, recapRatesFrom } = await import("./change-order-pricing");

let companyId = "", otherCompany = "", jobId = "";
const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: "Scissor lift", unit: "DAY", rate: "450", effectiveFrom: "2026-01-01", effectiveTo: "", notes: "", ...over })) data.set(key, value);
  return data;
};

describe("equipment rates", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: "Rates Co" } })).id;
    otherCompany = (await prisma.company.create({ data: { name: "Other" } })).id;
    context.company.id = companyId;
    context.companyId = companyId;
    context.id = (await prisma.user.create({ data: { companyId, clerkId: `er_${Date.now()}`, email: `er_${Date.now()}@example.test`, role: "OWNER" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Tower", status: "CONTRACTED" } })).id;
    await prisma.jobBidRecap.create({ data: { companyId, jobId, equipmentMarkupPercent: "20", overheadPercent: "10", profitPercent: "8" } });
  });

  afterAll(async () => {
    await prisma.changeOrderProposal.deleteMany({ where: { changeOrder: { jobId } } });
    await prisma.changeOrder.deleteMany({ where: { jobId } });
    await prisma.changeOrderCounter.deleteMany({ where: { jobId } });
    await prisma.jobBidRecap.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompany] } } });
    await prisma.$disconnect();
  });

  it("saves a rate, and refuses an overlap, a bad figure or backwards dates in words", async () => {
    expect(await createEquipmentRate(form())).toEqual({ ok: true });
    expect(await createEquipmentRate(form({ effectiveFrom: "2026-06-01" }))).toMatchObject({ ok: false, error: expect.stringContaining("already has a day rate") });
    expect(await createEquipmentRate(form({ name: "Boom", rate: "lots" }))).toMatchObject({ ok: false });
    expect(await createEquipmentRate(form({ name: "Boom", rate: "0" }))).toMatchObject({ ok: false });
    expect(await createEquipmentRate(form({ name: "Boom", effectiveTo: "2025-01-01" }))).toMatchObject({ ok: false });
    expect(await prisma.equipmentRate.count({ where: { companyId } })).toBe(1);
  });

  it("allows another unit for the same machine, and ending one to start the next", async () => {
    expect(await createEquipmentRate(form({ unit: "WEEK", rate: "1500" }))).toEqual({ ok: true });
    const day = await prisma.equipmentRate.findFirstOrThrow({ where: { companyId, unit: "DAY" } });
    expect(await updateEquipmentRate(day.id, form({ effectiveTo: "2026-06-30" }))).toEqual({ ok: true });
    expect(await createEquipmentRate(form({ effectiveFrom: "2026-07-01", rate: "500" }))).toEqual({ ok: true });
  });

  it("will not touch another company's rate", async () => {
    const theirs = await prisma.equipmentRate.create({ data: { companyId: otherCompany, name: "Theirs", unit: "DAY", rate: "1", effectiveFrom: new Date("2026-01-01T00:00:00Z") } });
    expect(await updateEquipmentRate(theirs.id, form({ name: "Mine" }))).toMatchObject({ ok: false });
    expect(await deleteEquipmentRate(theirs.id)).toMatchObject({ ok: false });
    expect(await prisma.equipmentRate.count({ where: { id: theirs.id, name: "Theirs" } })).toBe(1);
  });

  it("refuses without job cost access, and only the owner removes", async () => {
    const rate = await prisma.equipmentRate.findFirstOrThrow({ where: { companyId } });
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect(await createEquipmentRate(form({ name: "X" }))).toMatchObject({ ok: false, error: expect.stringContaining("job function") });
    context.jobFunction = "PROJECT_MANAGER";
    expect(await deleteEquipmentRate(rate.id)).toMatchObject({ ok: false, error: expect.stringContaining("owner") });
    context.role = "OWNER";
    context.jobFunction = null;
  });

  it("prices a picked rate through the recap and keeps that figure when the rate changes", async () => {
    const opened = new FormData();
    opened.set("title", "Extra");
    expect(await createChangeOrder(jobId, opened)).toEqual({ ok: true });
    const co = await prisma.changeOrder.findFirstOrThrow({ where: { jobId } });
    const scope = new FormData();
    for (const [key, value] of Object.entries({ itemDescription: "Scissor lift", unit: "day", quantity: "3", budgetedUnitCost: "450.00", costCategory: "EQUIPMENT", unitPrice: "" })) scope.set(key, value);
    expect(await proposeAddedScope(co.id, scope)).toEqual({ ok: true });
    const line = await prisma.changeOrderProposal.findFirstOrThrow({ where: { changeOrderId: co.id } });
    const rates = recapRatesFrom({ equipmentMarkupPercent: 20, overheadPercent: 10, profitPercent: 8 });
    expect(Number(line.unitPrice)).toBe(priceLine({ quantity: 3, unitCost: 450, costCategory: "EQUIPMENT" }, rates).unitPrice);
    expect(Number(line.unitPrice)).toBeGreaterThan(450);

    await prisma.equipmentRate.updateMany({ where: { companyId }, data: { rate: "999" } });
    const again = await prisma.changeOrderProposal.findFirstOrThrow({ where: { id: line.id } });
    expect(Number(again.budgetedUnitCost)).toBe(450);
  });
});

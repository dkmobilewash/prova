import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/** Drafting against real rows: the price comes from the quote and not the
 * form, a vendor's lines share one draft, numbers only go up, and another
 * company's rows answer as if they were not there. */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { draftPurchaseOrderLine, removePurchaseOrderLine } = await import("./actions/purchaseOrders");
const { loadLineCommitments } = await import("./purchase-orders-query");
const { deleteVendor } = await import("./actions/vendors");

let jobId = "", lineId = "", otherLineId = "", vendorId = "", secondVendorId = "", quoteId = "", msfQuoteId = "", foreignQuoteId = "", foreignCompany = "";

const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
};

describe("drafting a purchase order", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "PO Co" } });
    context.company.id = company.id;
    const user = await prisma.user.create({ data: { companyId: company.id, clerkId: `po_${Date.now()}`, email: `po_${Date.now()}@example.test`, role: "OWNER" } });
    context.id = user.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "PO Job", status: "CONTRACTED" } });
    jobId = job.id;
    const line = await prisma.jobLineItem.create({ data: { jobId, description: "Board", unit: "SF", quantity: "1000", costCategory: "MATERIAL", budgetedUnitCost: "0.80" } });
    lineId = line.id;
    const sub = await prisma.jobLineItem.create({ data: { jobId, description: "Fireproofing", unit: "LS", quantity: "1", costCategory: "SUBCONTRACTOR" } });
    otherLineId = sub.id;
    const vendor = await prisma.vendor.create({ data: { companyId: company.id, name: "Foundation" } });
    vendorId = vendor.id;
    secondVendorId = (await prisma.vendor.create({ data: { companyId: company.id, name: "Spray Sub" } })).id;
    const quotedOn = new Date("2026-10-01T00:00:00Z");
    quoteId = (await prisma.vendorPriceQuote.create({ data: { companyId: company.id, vendorId, description: "Board", unit: "SF", unitPrice: "0.75", quotedOn } })).id;
    msfQuoteId = (await prisma.vendorPriceQuote.create({ data: { companyId: company.id, vendorId, description: "Board", unit: "MSF", unitPrice: "750", quotedOn } })).id;
    const other = await prisma.company.create({ data: { name: "Other Co" } });
    foreignCompany = other.id;
    const fv = await prisma.vendor.create({ data: { companyId: other.id, name: "Theirs" } });
    foreignQuoteId = (await prisma.vendorPriceQuote.create({ data: { companyId: other.id, vendorId: fv.id, description: "x", unit: "SF", unitPrice: "1", quotedOn } })).id;
  });

  afterAll(async () => {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { jobId } } });
    await prisma.purchaseOrder.deleteMany({ where: { jobId } });
    await prisma.purchaseOrderCounter.deleteMany({ where: { jobId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.vendorPriceQuote.deleteMany({ where: { companyId: { in: [context.company.id, foreignCompany] } } });
    await prisma.vendor.deleteMany({ where: { companyId: { in: [context.company.id, foreignCompany] } } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.deleteMany({ where: { id: { in: [context.company.id, foreignCompany] } } });
    await prisma.$disconnect();
  });

  it("takes the price from the quote row, ignoring any price in the form, and snapshots the line", async () => {
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: lineId, quantity: "400", quoteId, unitPrice: "0.01" }))).toEqual({ ok: true });
    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId }, include: { lines: true } });
    expect(po).toMatchObject({ number: 1, status: "DRAFT", vendorId });
    expect(po.lines[0]).toMatchObject({ description: "Board", unit: "SF", costCategory: "MATERIAL", vendorPriceQuoteId: quoteId });
    expect(po.lines[0].unitPrice.toFixed(2)).toBe("0.75");
  });

  it("adds the same vendor's next line to that draft, and counts it as drafted, not committed", async () => {
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: lineId, quantity: "100", quoteId }))).toEqual({ ok: true });
    expect(await prisma.purchaseOrder.count({ where: { jobId } })).toBe(1);
    expect((await loadLineCommitments(jobId)).get(lineId)).toEqual({ drafted: 375, committed: 0, quantityBought: 500 });
  });

  it("makes a lower-tier subcontract a second PO with a SUBCONTRACTOR line, at a typed price", async () => {
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: otherLineId, quantity: "1", vendorId: secondVendorId, unitPrice: "12,500" }))).toEqual({ ok: true });
    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId, vendorId: secondVendorId }, include: { lines: true } });
    expect(po.number).toBe(2);
    expect(po.lines[0].costCategory).toBe("SUBCONTRACTOR");
    expect(po.lines[0].vendorPriceQuoteId).toBeNull();
    expect(po.lines[0].unitPrice.toFixed(2)).toBe("12500.00");
  });

  it("refuses a quote in another unit, another company's quote, and a bad figure, writing nothing", async () => {
    const before = await prisma.purchaseOrderLine.count({ where: { purchaseOrder: { jobId } } });
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: lineId, quantity: "1", quoteId: msfQuoteId }))).toMatchObject({ ok: false });
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: lineId, quantity: "1", quoteId: foreignQuoteId }))).toEqual({ ok: false, error: "That quote is gone. Reload the page." });
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: lineId, quantity: "0", quoteId }))).toMatchObject({ ok: false });
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: lineId, quantity: "abc", quoteId }))).toMatchObject({ ok: false });
    expect(await prisma.purchaseOrderLine.count({ where: { purchaseOrder: { jobId } } })).toBe(before);
  });

  it("keeps a vendor that is on a PO, and says why", async () => {
    expect(await deleteVendor(vendorId)).toMatchObject({ ok: false });
  });

  it("removes a draft line, removes the draft with its last line, and never reissues the number", async () => {
    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId, vendorId: secondVendorId }, include: { lines: true } });
    expect(await removePurchaseOrderLine(po.lines[0].id)).toEqual({ ok: true });
    expect(await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).toBeNull();
    expect(await draftPurchaseOrderLine(jobId, form({ lineItemId: otherLineId, quantity: "1", vendorId: secondVendorId, unitPrice: "1" }))).toEqual({ ok: true });
    expect((await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId, vendorId: secondVendorId } })).number).toBe(3);
  });

  it("refuses to change a line once its PO is past DRAFT", async () => {
    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId, vendorId }, include: { lines: true } });
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "ISSUED" } });
    expect(await removePurchaseOrderLine(po.lines[0].id)).toMatchObject({ ok: false });
    expect((await loadLineCommitments(jobId)).get(lineId)).toEqual({ drafted: 0, committed: 375, quantityBought: 500 });
  });
});

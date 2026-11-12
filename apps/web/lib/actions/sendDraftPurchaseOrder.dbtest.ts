import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * "Send PO to supplier", against a real Postgres with the email provider faked. A draft from Order
 * materials goes to the supplier's email from their imported list, as an ISSUED PDF; the send is
 * logged on the job with the exact file kept; the PO is issued only once the email has gone.
 */
const context = {
  company: { id: "", name: "Walk Drywall", dbaName: null },
  companyId: "",
  id: "",
  email: "pm@walk.test",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context, requireApiContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const sendEmail = vi.fn();
vi.mock("@prova/integrations", async (original) => ({
  ...(await original<typeof import("@prova/integrations")>()),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  readEmailConfig: () => ({ provider: "resend", apiKey: "k", from: "docs@cstream.ai", webhookSecret: null }),
}));
// The PDF's text is compressed, so what it says is read off the document handed to the real builder.
const built: { status: string; issuedOn: string | null }[] = [];
vi.mock("@/lib/purchase-order-pdf", async (original) => {
  const real = await original<typeof import("@/lib/purchase-order-pdf")>();
  return { ...real, buildPurchaseOrderPdf: async (doc: Parameters<typeof real.buildPurchaseOrderPdf>[0]) => (built.push(doc), real.buildPurchaseOrderPdf(doc)) };
});

const { sendDraftPurchaseOrder } = await import("./messages");

const SUPPLIER = "orders@northgate-supply.example";
let companyId = "", jobId = "", vendorId = "", lineId = "";
let number = 0;
const draft = async () =>
  (
    await prisma.purchaseOrder.create({
      data: { companyId, jobId, vendorId, number: ++number, status: "DRAFT", lines: { create: { lineItemId: lineId, description: "Steel Stud 25 GA 6in x 14ft", quantity: "96", unit: "EA", unitPrice: "9.60" } } },
    })
  ).id;
const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [k, v] of Object.entries({ toAddress: SUPPLIER, toName: "Northgate Building Supply", subject: "PO", body: "Attached.", sentOn: "2026-11-12", ...over })) data.set(k, v);
  return data;
};
const status = async (id: string) => prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, select: { status: true, issuedOn: true } });

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Walk Drywall" } })).id;
  context.company.id = companyId;
  context.companyId = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `po_${Date.now()}`, email: `po_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Baker EOC", status: "CONTRACTED" } })).id;
  vendorId = (await prisma.vendor.create({ data: { companyId, name: "Northgate Building Supply", email: SUPPLIER } })).id;
  lineId = (await prisma.jobLineItem.create({ data: { jobId, description: "6in metal stud", unit: "EA", quantity: "96", costCategory: "MATERIAL" } })).id;
});

beforeEach(() => {
  built.length = 0;
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, providerMessageId: `m_${Math.random()}`, from: '"Walk Drywall" <docs@cstream.ai>' });
});

afterAll(async () => {
  await prisma.outboundMessage.deleteMany({ where: { companyId } });
  await prisma.$executeRaw`DELETE FROM "PurchaseOrderLine" WHERE "purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE "jobId" = ${jobId})`;
  await prisma.purchaseOrder.deleteMany({ where: { jobId } });
  await prisma.purchaseOrderCounter.deleteMany({ where: { jobId } }).catch(() => {});
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.vendor.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("Send PO to supplier", () => {
  it("emails the draft to the supplier as an issued PDF, logs it on the job, and issues the PO", async () => {
    const id = await draft();
    expect(await sendDraftPurchaseOrder(id, form())).toEqual({ ok: true });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const request = sendEmail.mock.calls[0][0];
    expect(request).toMatchObject({ to: SUPPLIER, fromName: "Walk Drywall", replyTo: "pm@walk.test" });
    const pdf: Buffer = request.attachments[0].content;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Built as ISSUED on the day sent: a draft's PDF says "DRAFT - NOT ISSUED" across its header.
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ status: "ISSUED", issuedOn: "Nov 12, 2026" });

    const logged = await prisma.outboundMessage.findFirstOrThrow({ where: { relatedType: "PURCHASE_ORDER", relatedId: id }, include: { sentDocument: true } });
    expect(logged).toMatchObject({ jobId, toAddress: SUPPLIER, sentByUserId: context.id });
    expect(Buffer.from(logged.sentDocument!.content!).equals(pdf)).toBe(true);

    expect(await status(id)).toEqual({ status: "ISSUED", issuedOn: new Date("2026-11-12T00:00:00.000Z") });
  });

  it("never sends without the press: an issued PO, a bad date or a bad address sends nothing", async () => {
    const issued = await draft();
    await sendDraftPurchaseOrder(issued, form());
    sendEmail.mockClear();
    expect(await sendDraftPurchaseOrder(issued, form())).toMatchObject({ ok: false, error: expect.stringContaining("already been issued") });
    const id = await draft();
    expect(await sendDraftPurchaseOrder(id, form({ sentOn: "" }))).toMatchObject({ ok: false });
    expect(await sendDraftPurchaseOrder(id, form({ toAddress: "nope" }))).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await status(id)).status).toBe("DRAFT");
  });

  it("an email that never went leaves the PO a draft, to fix and send again", async () => {
    const id = await draft();
    sendEmail.mockResolvedValueOnce({ ok: false, error: "Email sending isn't set up yet.", configured: false });
    expect(await sendDraftPurchaseOrder(id, form())).toMatchObject({ ok: false, error: expect.stringContaining("isn't set up") });
    expect((await status(id)).status).toBe("DRAFT");
    sendEmail.mockResolvedValueOnce({ ok: false, error: "Email provider refused it (HTTP 422)", configured: true });
    expect(await sendDraftPurchaseOrder(id, form())).toMatchObject({ ok: false });
    expect((await status(id)).status).toBe("DRAFT");
  });

  it("one the provider took without an id is issued, so nobody sends it twice", async () => {
    const id = await draft();
    sendEmail.mockResolvedValueOnce({ ok: false, error: "no id", configured: true, mayHaveSent: true });
    expect(await sendDraftPurchaseOrder(id, form())).toMatchObject({ ok: false, error: expect.stringContaining("most likely gone out") });
    expect((await status(id)).status).toBe("ISSUED");
  });
});

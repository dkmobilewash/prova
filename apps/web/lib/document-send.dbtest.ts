import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Sending a purchase order or pay application, against a real Postgres with the
 * provider faked: the file kept is the file sent, the sender and Reply-To go out,
 * a draft is refused, and nothing reaches the provider for a refused send.
 */
const context = {
  company: { id: "", name: "Acme Drywall", dbaName: null },
  companyId: "",
  id: "",
  email: "pm@acme.test",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context, requireApiContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/viewerToday", async (original) => ({
  ...(await original<typeof import("@/lib/viewerToday")>()),
  viewerTimeZone: async () => "UTC",
}));
const sendEmail = vi.fn();
const deleted = vi.fn();
vi.mock("@/lib/blob", async (original) => ({
  ...(await original<typeof import("@/lib/blob")>()),
  deleteDocument: async (url: string) => deleted(url),
}));
vi.mock("@/lib/document-uploads", async (original) => ({
  ...(await original<typeof import("@/lib/document-uploads")>()),
  documentUrlProblem: () => null,
}));
vi.mock("@prova/integrations", async (original) => ({
  ...(await original<typeof import("@prova/integrations")>()),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  readEmailConfig: () => ({ provider: "resend", apiKey: "k", from: "docs@cstream.ai", webhookSecret: null }),
}));

const { sendPayApplication, sendPurchaseOrder, sendSubmittalPackage } = await import("./actions/messages");
const { GET } = await import("@/app/api/sent-documents/[id]/route");
const { GET: linkGET } = await import("@/app/api/sent-documents/link/[token]/route");
const { EMAIL_ATTACHMENT_MAX_BYTES } = await import("./document-email");
const { uploadMaxBytesFor } = await import("./document-uploads");

let companyId = "", jobId = "", issuedPo = "", draftPo = "", invoiceId = "", otherCompany = "";

const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const fields = { toAddress: "buyer@vendor.test", toName: "Vendor", subject: "PO", body: "Attached.", sentOn: "2026-10-30", ...over };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const download = (id: string) => GET(new Request("http://x.test") as never, { params: Promise.resolve({ id }) });

describe("emailing a document", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: "Acme Drywall" } })).id;
    otherCompany = (await prisma.company.create({ data: { name: "Other" } })).id;
    context.company.id = companyId;
    context.companyId = companyId;
    context.id = (await prisma.user.create({ data: { companyId, clerkId: `ds_${Date.now()}`, email: `ds_${Date.now()}@example.test`, role: "OWNER" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC", email: "ap@gc.test" } });
    const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Tower", status: "CONTRACTED" } });
    jobId = job.id;
    const vendor = await prisma.vendor.create({ data: { companyId, name: "Foundation", email: "buyer@vendor.test" } });
    const line = await prisma.jobLineItem.create({ data: { jobId, description: "Board", unit: "SF", quantity: "100", unitPrice: "2", budgetedUnitCost: "1" } });
    const po = (number: number, status: "ISSUED" | "DRAFT") =>
      prisma.purchaseOrder.create({
        data: {
          companyId,
          jobId,
          vendorId: vendor.id,
          number,
          status,
          issuedOn: status === "ISSUED" ? new Date("2026-10-28T00:00:00Z") : null,
          lines: { create: { lineItemId: line.id, description: "Board", quantity: "100", unit: "SF", unitPrice: "0.75" } },
        },
      });
    issuedPo = (await po(1, "ISSUED")).id;
    draftPo = (await po(2, "DRAFT")).id;
    invoiceId = (
      await prisma.invoice.create({
        data: {
          jobId,
          number: 1,
          amount: "100",
          lineItems: { create: { lineItemId: line.id, thisPeriodBilled: "100" } },
        },
      })
    ).id;
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv("NOTIFY_BASE_URL", "https://app.test");
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: `m_${Math.random()}`, from: '"Acme Drywall" <docs@cstream.ai>' });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.submittalRevision.deleteMany({ where: { submittal: { jobId } } });
    await prisma.submittal.deleteMany({ where: { jobId } });
    await prisma.outboundMessage.deleteMany({ where: { companyId } });
    await prisma.$executeRaw`DELETE FROM "PurchaseOrderLine" WHERE "purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE "jobId" = ${jobId})`;
    await prisma.purchaseOrder.deleteMany({ where: { jobId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId } } });
    await prisma.invoice.deleteMany({ where: { jobId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.vendor.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompany] } } });
    await prisma.$disconnect();
  });

  it("sends an issued PO as the company, reply to the person, and keeps that exact file", async () => {
    expect(await sendPurchaseOrder(issuedPo, form())).toEqual({ ok: true });
    const request = sendEmail.mock.calls[0][0];
    expect(request).toMatchObject({ to: "buyer@vendor.test", fromName: "Acme Drywall", replyTo: "pm@acme.test" });
    const attached = request.attachments[0];
    expect(attached.content.subarray(0, 5).toString()).toBe("%PDF-");

    const kept = await prisma.sentDocument.findFirstOrThrow({ where: { documentId: issuedPo }, include: { message: true } });
    expect(Buffer.from(kept.content!).equals(attached.content)).toBe(true);
    expect(kept.sentOn.toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(kept.message.relatedType).toBe("PURCHASE_ORDER");
  });

  it("refuses a draft, a bad date and a bad address with nothing sent or kept", async () => {
    const before = await prisma.sentDocument.count();
    expect(await sendPurchaseOrder(draftPo, form())).toMatchObject({ ok: false, error: expect.stringContaining("draft") });
    expect(await sendPurchaseOrder(issuedPo, form({ sentOn: "" }))).toMatchObject({ ok: false });
    expect(await sendPurchaseOrder(issuedPo, form({ toAddress: "nope" }))).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.sentDocument.count()).toBe(before);
  });

  it("refuses another company's PO as gone", async () => {
    context.company.id = otherCompany;
    expect(await sendPurchaseOrder(issuedPo, form())).toMatchObject({ ok: false, error: expect.stringContaining("gone") });
    context.company.id = companyId;
  });

  it("sends a pay application with its G702/G703", async () => {
    expect(await sendPayApplication(jobId, invoiceId, form({ toAddress: "ap@gc.test" }))).toEqual({ ok: true });
    expect(sendEmail.mock.calls[0][0].attachments[0].filename).toContain("G702");
    expect(await prisma.sentDocument.count({ where: { kind: "PAY_APPLICATION", documentId: invoiceId } })).toBe(1);
  });

  it("records a failed send as never sent, keeps the record, and tells the person", async () => {
    sendEmail.mockResolvedValue({ ok: false, error: "Refused", configured: true });
    expect(await sendPurchaseOrder(issuedPo, form())).toMatchObject({ ok: false, error: "Refused" });
    const newest = await prisma.sentDocument.findFirstOrThrow({ where: { documentId: issuedPo }, orderBy: { createdAt: "desc" }, include: { message: { include: { events: true } } } });
    expect(newest.message.events.map((event) => event.type)).toEqual(["FAILED"]);
  });

  it("downloads only for the signed-in company", async () => {
    const kept = await prisma.sentDocument.findFirstOrThrow({ where: { documentId: issuedPo } });
    const mine = await download(kept.id);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("application/pdf");
    expect(mine.headers.get("cache-control")).toContain("no-store");
    context.companyId = otherCompany;
    expect((await download(kept.id)).status).toBe(404);
    context.companyId = companyId;
  });

  it("needs billing access for a pay application's copy", async () => {
    const kept = await prisma.sentDocument.findFirstOrThrow({ where: { kind: "PAY_APPLICATION" } });
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect((await download(kept.id)).status).toBe(404);
    expect(await sendPayApplication(jobId, invoiceId, form())).toMatchObject({ ok: false });
    context.role = "OWNER";
    context.jobFunction = null;
  });

  describe("a submittal package", () => {
    let submittalId = "";
    const fileUrl = "https://store.public.blob.vercel-storage.com/x.pdf";
    const pdf = (size: number) => vi.fn(async () => new Response(Buffer.alloc(size, 1), { status: 200 }));
    const sendForm = (over: Record<string, string> = {}) => form({ toAddress: "pm@gc.test", fileName: "SUB-1.pdf", dueBack: "", ...over });

    beforeEach(async () => {
      deleted.mockClear();
      const made = await prisma.submittal.create({
        data: { companyId, jobId, number: Math.floor(Math.random() * 1e6), title: "Board", submittedByUserId: context.id },
      });
      submittalId = made.id;
    });

    it("attaches one that fits, records the revision and clears the transit file", async () => {
      vi.stubGlobal("fetch", pdf(1000));
      expect(await sendSubmittalPackage(submittalId, fileUrl, sendForm())).toEqual({ ok: true });
      expect(sendEmail.mock.calls[0][0].attachments[0].filename).toBe("SUB-1.pdf");
      const kept = await prisma.sentDocument.findFirstOrThrow({ where: { documentId: submittalId } });
      expect(kept.linkToken).toBeNull();
      expect(kept.content?.byteLength).toBe(1000);
      expect(await prisma.submittalRevision.count({ where: { submittalId } })).toBe(1);
      expect(deleted).toHaveBeenCalledWith(fileUrl);
    });

    it("sends a link instead of a file past the attachment size, and the link serves it", async () => {
      vi.stubGlobal("fetch", pdf(EMAIL_ATTACHMENT_MAX_BYTES + 1));
      expect(await sendSubmittalPackage(submittalId, fileUrl, sendForm())).toEqual({ ok: true });
      const request = sendEmail.mock.calls[0][0];
      expect(request.attachments).toBeUndefined();
      const kept = await prisma.sentDocument.findFirstOrThrow({ where: { documentId: submittalId } });
      expect(request.text).toContain(`https://app.test/api/sent-documents/link/${kept.linkToken}`);
      vi.unstubAllGlobals();

      const open = (token: string) => linkGET(new Request("http://x.test") as never, { params: Promise.resolve({ token }) });
      const served = await open(kept.linkToken!);
      expect(served.status).toBe(200);
      expect((await served.arrayBuffer()).byteLength).toBe(EMAIL_ATTACHMENT_MAX_BYTES + 1);

      await prisma.sentDocument.update({ where: { id: kept.id }, data: { linkExpiresAt: new Date("2020-01-01T00:00:00Z") } });
      expect((await open(kept.linkToken!)).status).toBe(404);
      expect((await open("nope")).status).toBe(404);
    });

    it("records no revision when the send fails, and still clears the transit file", async () => {
      vi.stubGlobal("fetch", pdf(1000));
      sendEmail.mockResolvedValue({ ok: false, error: "Refused", configured: true });
      expect(await sendSubmittalPackage(submittalId, fileUrl, sendForm())).toMatchObject({ ok: false, error: "Refused" });
      expect(await prisma.submittalRevision.count({ where: { submittalId } })).toBe(0);
      expect(deleted).toHaveBeenCalledWith(fileUrl);
    });

    it("sends nothing while the GC still has the last revision", async () => {
      vi.stubGlobal("fetch", pdf(1000));
      await prisma.submittalRevision.create({ data: { submittalId, revisionNumber: 1, sentOn: new Date("2026-10-01T00:00:00Z") } });
      expect(await sendSubmittalPackage(submittalId, fileUrl, sendForm())).toMatchObject({ ok: false, error: expect.stringContaining("still has revision 1") });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("refuses one too big even for a link", async () => {
      vi.stubGlobal("fetch", pdf(uploadMaxBytesFor("submittal-package") + 1));
      expect(await sendSubmittalPackage(submittalId, fileUrl, sendForm())).toMatchObject({ ok: false, error: expect.stringContaining("over the") });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});

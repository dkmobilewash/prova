import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { checkChangeOrder, EMPTY_DRAFT, type ChangeOrderDraft } from "./change-order";
import { PCO_FOOTER, renderChangeOrderPdf } from "./change-order-pdf";
import { handleChangeOrderRequest, type ChangeOrderDeps, type ChangeOrderRequestBody } from "./change-order-request";
import type { addContact, sendEmail as SendEmail, SendResult } from "./email";
import { LIMITS, MemoryRateStore } from "./rate-limit";

const ORDER: ChangeOrderDraft = {
  ...EMPTY_DRAFT,
  companyName: "Desert Drywall LLC",
  project: "Mesa Medical Office Building",
  projectAddress: "1234 E Main St, Mesa, AZ",
  gc: "Acme Builders Inc.",
  pcoNumber: "PCO-07",
  date: "2026-10-17",
  title: "Add rated head-of-wall at corridor",
  description: "Per RFI 14, add 2-hr rated deflection track at the level 2 corridor.",
  labor: [{ description: "Framers", quantity: "8", unit: "", unitPrice: "85" }],
  material: [{ description: "Deflection track", quantity: "12", unit: "EA", unitPrice: "14.37" }],
  equipment: [{ description: "Scissor lift", quantity: "1", unit: "day", unitPrice: "325" }],
  markupPercent: "15",
  scheduleDays: "2",
  backup: "RFI 14 response\nSite photos, Oct 12",
};

const FIRST: ChangeOrderRequestBody = { order: ORDER, email: "pat@example.com", name: "Pat Sub", company: "Desert Drywall" };

type Message = { to: string; subject: string; text: string; attachments?: Array<{ filename: string; content: Uint8Array }> };

function deps(overrides: Partial<ChangeOrderDeps> = {}) {
  const sent: Message[] = [];
  const contacts: Array<{ email: string; marketingOptIn: boolean }> = [];
  const send = vi.fn(async (message: Message) => {
    sent.push(message);
    return { status: "sent", id: "x" } as SendResult;
  }) as unknown as typeof SendEmail;
  const subscribe = vi.fn(async (contact: { email: string; marketingOptIn: boolean }) => {
    contacts.push(contact);
    return { status: "sent", id: "c" } as SendResult;
  }) as unknown as typeof addContact;
  const base: ChangeOrderDeps = { env: {}, rate: { store: new MemoryRateStore(), salt: "s" }, ip: "1.2.3.4", send, subscribe, ...overrides };
  return { deps: base, sent, contacts };
}

// pdf.js's metrics for the standard fonts, as pdf.test.ts loads them.
const STANDARD_FONTS = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

/** The PDF's text, as pdf.js reads it back out of the file. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const item of content.items) if ("str" in item) parts.push(item.str);
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

describe("POST /api/change-order", () => {
  it("emails the PDF to the person, tells Diego, and adds the contact unsubscribed", async () => {
    const { deps: d, sent, contacts } = deps();
    expect(await handleChangeOrderRequest(FIRST, d)).toEqual({ kind: "sent", to: "pat@example.com", notConfigured: false });
    expect(sent.map((m) => m.to)).toEqual(["pat@example.com", "diego@cstream.ai"]);
    expect(sent[0].subject).toBe("Your change order request PCO-07: Add rated head-of-wall at corridor");
    expect(sent[0].attachments?.[0].filename).toBe("change-order-request-pco-07.pdf");
    expect(sent[0].text).toContain("Total requested: $1,354.06. Schedule impact: 2 days.");
    expect(sent[1].subject).toMatch(/^Change order request lead: Pat Sub, Desert Drywall$/);
    expect(contacts).toEqual([expect.objectContaining({ email: "pat@example.com", marketingOptIn: false })]);
  });

  it("the lead carries who asked, never the amounts, the GC or the job", async () => {
    const { deps: d, sent } = deps();
    await handleChangeOrderRequest(FIRST, d);
    const lead = JSON.stringify(sent[1]);
    for (const secret of ["1,354.06", "Acme Builders", "Mesa Medical", "head-of-wall"]) expect(lead).not.toContain(secret);
    expect(sent[1].text).toContain("Tool: change order request");
  });

  it("NEVER returns the PDF itself", async () => {
    const { deps: d } = deps();
    const result = await handleChangeOrderRequest(FIRST, d);
    expect(Object.values(result).some((value) => value instanceof Uint8Array)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("%PDF");
  });

  it("refuses the honeypot and a missing order without saying why, and sends nothing", async () => {
    const { deps: d, sent } = deps();
    expect(await handleChangeOrderRequest({ ...FIRST, website: "http://spam" }, d)).toMatchObject({ status: 400, error: "That request could not be read." });
    expect(await handleChangeOrderRequest({ ...FIRST, order: undefined }, d)).toMatchObject({ status: 400, error: "That request could not be read." });
    expect(await handleChangeOrderRequest({ ...FIRST, order: "x" as never }, d)).toMatchObject({ status: 400 });
    expect(sent).toEqual([]);
  });

  it("re-checks every field rather than trusting the page, and names what is wrong", async () => {
    const { deps: d, sent } = deps();
    const result = await handleChangeOrderRequest({ ...FIRST, order: { ...ORDER, gc: "", labor: [{ description: "x", quantity: "1", unit: "", unitPrice: "lots" }] } }, d);
    expect(result.kind === "error" && Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["gc", "labor.0.unitPrice"]);
    expect(sent).toEqual([]);
  });

  it("needs a name and a real email", async () => {
    const { deps: d } = deps();
    expect(await handleChangeOrderRequest({ ...FIRST, name: " " }, d)).toMatchObject({ status: 400 });
    expect(await handleChangeOrderRequest({ ...FIRST, email: "not-an-email" }, d)).toMatchObject({ status: 400 });
  });

  it("fails closed when production has no rate-limit store", async () => {
    const { deps: d, sent } = deps({ rate: null });
    expect(await handleChangeOrderRequest(FIRST, d)).toMatchObject({ status: 503 });
    expect(sent).toEqual([]);
  });

  it("a returning browser is emailed its PDF and is not a second lead", async () => {
    const { deps: d, sent, contacts } = deps();
    expect(await handleChangeOrderRequest({ ...FIRST, returning: true }, d)).toMatchObject({ kind: "sent" });
    expect(sent).toHaveLength(1);
    expect(contacts).toEqual([]);
  });

  it("asks the person to try again when the email provider is down, and sends no lead", async () => {
    const lines: string[] = [];
    const { deps: d, sent } = deps({
      send: (async (m: Message) => {
        sent.push(m);
        return { status: "failed", error: "500" };
      }) as unknown as typeof SendEmail,
      log: (line) => lines.push(line),
    });
    expect(await handleChangeOrderRequest(FIRST, d)).toMatchObject({ status: 503 });
    expect(sent).toHaveLength(1);
    expect(lines).toEqual(["[lien-waiver] the change order request email to the person did not go out: failed (500)"]);
  });

  it("caps PDFs per IP per hour, sharing the waiver's ceiling", async () => {
    const { deps: d } = deps();
    const body = (i: number) => ({ ...FIRST, returning: true, email: `sub${i}@example.com` });
    for (let i = 0; i < LIMITS.pdfPerIpPerHour; i += 1) expect((await handleChangeOrderRequest(body(i), d)).kind).toBe("sent");
    expect(await handleChangeOrderRequest(body(99), d)).toMatchObject({ status: 429 });
  });

  it("caps emails to one address per day", async () => {
    const { deps: d } = deps();
    for (let i = 0; i < LIMITS.emailsPerAddressPerDay; i += 1) {
      expect((await handleChangeOrderRequest(FIRST, { ...d, ip: `10.0.0.${i}` })).kind).toBe("sent");
    }
    expect(await handleChangeOrderRequest(FIRST, { ...d, ip: "10.0.1.1" })).toMatchObject({ status: 429 });
  });
});

describe("the change order request PDF", () => {
  it("prints every field, the money worked to the cent, and a blank GC signature block", async () => {
    const order = checkChangeOrder(ORDER).order!;
    const text = await pdfText(await renderChangeOrderPdf(order, "Pat Sub"));
    for (const expected of [
      "CHANGE ORDER REQUEST NO. PCO-07",
      "Status: Pending GC",
      "Date: 10/17/2026",
      "Company: Desert Drywall LLC",
      "Prepared by: Pat Sub",
      "Company: Acme Builders Inc.",
      "Name: Mesa Medical Office Building",
      "Address: 1234 E Main St, Mesa, AZ",
      "Add rated head-of-wall at corridor",
      "Per RFI 14, add 2-hr rated deflection track",
      "Framers",
      "8 hr",
      "$85.00",
      "$680.00",
      "Deflection track",
      "12 EA",
      "$14.37",
      "$172.44",
      "Scissor lift",
      "$325.00",
      "Subtotal",
      "$1,177.44",
      "Markup (15%)",
      "$176.62", // 15% of 1,177.44 = 176.616
      "Total requested",
      "$1,354.06",
      "2 days added to the schedule.",
      "- RFI 14 response",
      "- Site photos, Oct 12",
      "General contractor acceptance",
      "status of this request is Executed",
      "Signature:",
      "Title:",
      PCO_FOOTER,
      "Page 1 of",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("says when there are no priced lines and no backup, rather than printing nothing", async () => {
    const order = checkChangeOrder({ ...ORDER, labor: [], material: [], equipment: [], backup: "", pcoNumber: "" }).order!;
    const text = await pdfText(await renderChangeOrderPdf(order, "Pat Sub"));
    expect(text).toContain("CHANGE ORDER REQUEST Status");
    expect(text).toContain("No priced lines.");
    expect(text).toContain("None listed.");
    expect(text).toContain("$0.00");
  });

  it("flows a long request onto more pages without losing a line", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ description: `Line ${i + 1} with a long description of the work done`, quantity: "1", unit: "", unitPrice: "1" }));
    const order = checkChangeOrder({ ...ORDER, labor: many, material: many, description: "word ".repeat(380) }).order!;
    const text = await pdfText(await renderChangeOrderPdf(order, "Pat Sub"));
    expect(text).toContain("Page 2 of");
    expect(text.match(/Line 20 with/g)).toHaveLength(2);
    expect(text).toContain("General contractor acceptance");
  });
});

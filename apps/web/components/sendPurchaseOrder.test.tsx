// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseOrderDocument } from "@/lib/purchase-order-pdf";

// "Send PO to supplier": a press opens a PREVIEW that sends nothing; only the second press,
// inside the preview, calls the action. The supplier's email from their list is pre-filled.
const sendDraftPurchaseOrder = vi.fn(async (_id: string, _form: FormData) => ({ ok: true as const }));
vi.mock("@/lib/actions", () => ({ sendDraftPurchaseOrder }));
vi.mock("@/components/localToday", () => ({ localToday: () => "2026-11-12" }));
const { SendPurchaseOrder, asSent } = await import("./SendPurchaseOrder");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const doc: PurchaseOrderDocument = {
  number: 1,
  status: "DRAFT",
  issuedOn: null,
  from: { name: "Walk Drywall", lines: [] },
  vendor: { name: "Northgate Building Supply", lines: ["orders@northgate-supply.example"] },
  jobName: "Baker EOC",
  shipTo: null,
  contractNumber: null,
  lines: [
    { description: "Steel Stud 25 GA 6in x 14ft", quantity: 96, unit: "EA", unitPrice: 9.6 },
    { description: "Track 25 GA 6in x 10ft", quantity: 26, unit: "EA", unitPrice: 6.4 },
  ],
};
const email = { toAddress: "orders@northgate-supply.example", toName: "Northgate Building Supply", subject: "Purchase order 1 from Walk Drywall: Baker EOC", body: "Attached is purchase order 1." };

let host: HTMLDivElement;
async function mount(over: Partial<typeof email> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(createElement(SendPurchaseOrder, { id: "po1", document: doc, email: { ...email, ...over } }));
  });
}
const q = <T extends Element>(sel: string) => host.querySelector<T>(sel);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  sendDraftPurchaseOrder.mockClear();
});
afterEach(() => host.remove());

describe("Send PO to supplier", () => {
  it("opens a preview that sends nothing: who, what, the total and the PDF", async () => {
    await mount();
    expect(q('[data-po-send="preview"]')).toBeNull();
    await act(async () => q<HTMLButtonElement>('[data-po-send="open"]')?.click());
    expect(q('[data-po-send="preview"]')).not.toBeNull();
    expect(host.textContent).toContain("Preview: nothing has been sent yet.");
    expect(q('[data-po-send="summary"]')?.textContent).toBe("PO 1 to Northgate Building Supply: 2 lines, $1,088.00. Sending issues it on the date below.");
    expect(q<HTMLInputElement>('[data-po-send="to"]')?.value).toBe("orders@northgate-supply.example");
    expect(q<HTMLInputElement>('[name="sentOn"]')?.value).toBe("2026-11-12");
    expect(q('[data-po-send="pdf"]')).not.toBeNull();
    expect(sendDraftPurchaseOrder).not.toHaveBeenCalled();
  });

  it("sends only on the press inside the preview, with what the preview showed", async () => {
    await mount();
    await act(async () => q<HTMLButtonElement>('[data-po-send="open"]')?.click());
    await act(async () => q<HTMLButtonElement>('[data-po-send="send"]')?.click());
    expect(sendDraftPurchaseOrder).toHaveBeenCalledTimes(1);
    const [id, form] = sendDraftPurchaseOrder.mock.calls[0];
    expect(id).toBe("po1");
    expect(Object.fromEntries(form.entries())).toMatchObject({ toAddress: "orders@northgate-supply.example", sentOn: "2026-11-12", subject: email.subject });
    expect(q('[data-po-send="sent"]')?.textContent).toContain("sent to orders@northgate-supply.example and issued");
  });

  it("with no email on the supplier's list, says so and cannot send until one is typed", async () => {
    await mount({ toAddress: "" });
    await act(async () => q<HTMLButtonElement>('[data-po-send="open"]')?.click());
    expect(q('[data-po-send="no-contact"]')).not.toBeNull();
    expect(q<HTMLButtonElement>('[data-po-send="send"]')?.disabled).toBe(true);
  });

  it("the PDF it previews and sends is issued on the day sent, never marked draft", () => {
    expect(asSent(doc, "2026-11-12")).toMatchObject({ status: "ISSUED", issuedOn: "Nov 12, 2026" });
  });
});

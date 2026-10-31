// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendPurchaseOrder = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/actions", () => ({ sendPurchaseOrder, sendPayApplication: vi.fn() }));
vi.mock("@/components/localToday", () => ({ localToday: () => "2026-10-31" }));
const { SendDocument, SendHistory } = await import("./SendDocument");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const draft = { toAddress: "f@x.test", toName: "Foundation", subject: "PO 1", body: "Attached." };
const history = [
  { id: "a", toAddress: "f@x.test", sentOn: "Oct 31, 2026", status: "Bounced", needsAction: true, detail: "Mailbox full" },
  { id: "b", toAddress: "g@x.test", sentOn: "Oct 30, 2026", status: "Delivered", needsAction: false, detail: null },
];

describe("what was sent", () => {
  it("shows the status, the reason and the kept file for each send", () => {
    const html = renderToStaticMarkup(<SendHistory sends={history} />);
    expect(html).toContain("Bounced · Mailbox full");
    expect(html).toContain("Delivered");
    expect(html).toContain('href="/api/sent-documents/a"');
  });

  it("says nothing when nothing was sent", () => {
    expect(renderToStaticMarkup(<SendHistory sends={[]} />)).toBe("");
  });
});

describe("sending", () => {
  let host: HTMLDivElement;
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      createRoot(host).render(createElement(SendDocument, { target: { kind: "PURCHASE_ORDER", id: "po1" }, draft }));
    });
  });
  afterEach(() => host.remove());

  it("sends nothing until a person opens the form and presses send", async () => {
    expect(sendPurchaseOrder).not.toHaveBeenCalled();
    expect(host.querySelector("form")).toBeNull();
    await act(async () => host.querySelector("button")?.click());
    expect(sendPurchaseOrder).not.toHaveBeenCalled();
  });

  it("pre-fills the date, recipient and words, and lets them change", async () => {
    await act(async () => host.querySelector("button")?.click());
    const value = (name: string) => host.querySelector<HTMLInputElement>(`[name="${name}"]`);
    expect(value("sentOn")?.value).toBe("2026-10-31");
    expect(value("sentOn")?.readOnly).toBe(false);
    expect(value("toAddress")?.value).toBe("f@x.test");
    expect(value("subject")?.value).toBe("PO 1");
  });
});

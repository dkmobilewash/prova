// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const billRetainage = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("@/lib/actions", () => ({ billRetainage }));
vi.mock("@/components/localToday", () => ({ localToday: () => "2026-11-03" }));
const { BillRetainage } = await import("./BillRetainage");
const { CloseoutStatus } = await import("./CloseoutStatus");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("billing the retainage", () => {
  it("says what is held, opens on a press, and sends only on submit", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(createElement(BillRetainage, { jobId: "j", held: 4700 })));
    expect(host.textContent).toContain("Bill the retainage ($4,700.00 held)");
    await act(async () => host.querySelector("button")?.click());
    const value = (name: string) => host.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value;
    expect([value("amount"), value("periodTo")]).toEqual(["4700.00", "2026-11-30"]);
    expect(host.textContent).toContain("Doing both counts it twice");
    expect(billRetainage).not.toHaveBeenCalled();
    await act(async () => host.querySelector("form")?.requestSubmit());
    expect(billRetainage).toHaveBeenCalledWith("j", expect.any(FormData));
    host.remove();
  });
});

describe("the closeout list on screen", () => {
  it("gives each line a word as well as a colour", () => {
    const html = renderToStaticMarkup(
      createElement(CloseoutStatus, {
        items: [
          { label: "Retainage billed", done: true, detail: "Billed on application #5." },
          { label: "Retainage paid", done: false, detail: "$4,700.00 unpaid on application #5." },
        ],
      }),
    );
    expect(html).toContain("Done");
    expect(html).toContain("Open");
    expect(html).toContain("$4,700.00 unpaid on application #5.");
  });
});

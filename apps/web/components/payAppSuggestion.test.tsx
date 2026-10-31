// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ submitPayApplication: vi.fn(), updateInvoiceStatus: vi.fn() }));
vi.mock("@/components/localToday", () => ({ useLocalToday: () => "2026-10-31" }));
const { PayApplications } = await import("./PayApplications");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const item = {
  id: "l1",
  description: "Framing labor",
  scheduledValue: 60000,
  materialsStoredToDate: 0,
  previousBilled: 20000,
  budgeted: 200,
  logged: [{ day: "2026-09-30", amount: 80 }, { day: "2026-10-20", amount: 40 }],
  installedProgress: { quantity: 1000, unit: "SF", logged: [{ day: "2026-10-20", amount: 500 }] },
};

describe("a suggestion on the pay application form", () => {
  let host: HTMLDivElement;
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      createRoot(host).render(createElement(PayApplications, { jobId: "j", lineItems: [item] }));
    });
    const open = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Submit pay application"));
    await act(async () => open?.click());
  });
  afterEach(() => host.remove());

  it("shows beside the box and leaves the box empty", () => {
    expect(host.textContent).toContain("Suggested $16,000.00 from hours");
    expect(host.querySelector<HTMLInputElement>('input[name="thisPeriodBilled"]')?.value).toBe("");
  });

  it("shows both sources side by side, with the box still empty", () => {
    expect(host.textContent).toContain("Suggested $10,000.00 from installed qty: 500 of 1,000 SF through 2026-10-31, 50.0%.");
    expect(host.textContent).toContain("from hours");
    expect(host.querySelector<HTMLInputElement>('input[name="thisPeriodBilled"]')?.value).toBe("");
  });

  it("sends nothing from the suggestion when the form is read", () => {
    const form = new FormData(host.querySelector("form")!);
    expect(form.getAll("thisPeriodBilled")).toEqual([""]);
    expect([...form.values()].join(" ")).not.toMatch(/16000|10000/);
  });

  it("follows the period-to date", async () => {
    const box = host.querySelector<HTMLInputElement>('input[name="periodTo"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(box, "2026-09-30");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("80 of 200 budgeted hours through 2026-09-30");
  });
});

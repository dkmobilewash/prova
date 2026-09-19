// @vitest-environment happy-dom

/**
 * The "Import from QuickBooks" box on /settings, rendered: the button, the
 * preview a person reads, and Confirm. Nothing in a page walk could load it
 * without a real QuickBooks sandbox connection, so the wiring between the
 * button, the two actions and what appears on screen is checked here.
 *
 * createElement rather than JSX: the suite's `include` matches .test.ts only.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickBooksPlan } from "@/lib/quickbooks-import";

type Preview = { ok: true; value: QuickBooksPlan } | { ok: false; error: string };
type Confirm =
  | { ok: true; value: { clientsAdded: number; vendorsAdded: number; catalogAdded: number; alreadyThere: number; message: string } }
  | { ok: false; error: string };

const fake = {
  previewQuickBooksImport: vi.fn<() => Promise<Preview>>(),
  confirmQuickBooksImport: vi.fn<() => Promise<Confirm>>(),
};
vi.mock("@/lib/actions", () => fake);

const { QuickBooksImport } = await import("@/components/QuickBooksImport");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fake.previewQuickBooksImport.mockReset();
  fake.confirmQuickBooksImport.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

const empty = { create: [], existing: [], leftOut: [], problems: [] };
const plan: QuickBooksPlan = {
  clients: {
    create: [{ qboId: "1", name: "Turner Construction", email: "ap@turner.example", phone: null, address: "1 Main St", notes: [] }],
    existing: [{ line: 2, label: "Hensel Phelps" }],
    leftOut: [{ label: "Tower B", reason: "a sub-customer of Turner Construction" }],
    problems: [{ line: 3, message: "QuickBooks customer #4 — this looks like a whole Social Security number." }],
  },
  vendors: { ...empty, create: [{ qboId: "10", name: "ABC Supply", contactName: "Pat Doe", email: null, phone: null, notes: null, flags: [] }] },
  catalog: { ...empty, create: [{ qboId: "20", description: "Drywall:Hang", unitPrice: 1.25, unitCost: 0.8, qboType: "Service", notes: [] }] },
  notices: [],
};

const button = (label: RegExp) =>
  [...container.querySelectorAll("button")].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

async function click(el: HTMLElement | undefined) {
  expect(el, "button not on screen").toBeTruthy();
  await act(async () => {
    el!.click();
  });
}

describe("QuickBooksImport", () => {
  it("shows nothing but the button until pressed, and calls nothing", () => {
    act(() => root.render(createElement(QuickBooksImport)));
    expect(button(/Import from QuickBooks/)).toBeTruthy();
    expect(fake.previewQuickBooksImport).not.toHaveBeenCalled();
  });

  it("previews, then confirms — and the confirm sends nothing from the page", async () => {
    fake.previewQuickBooksImport.mockResolvedValue({ ok: true, value: plan });
    fake.confirmQuickBooksImport.mockResolvedValue({
      ok: true,
      value: { clientsAdded: 1, vendorsAdded: 1, catalogAdded: 1, alreadyThere: 1, message: "Added 1 client, 1 vendor and 1 catalog entry from QuickBooks." },
    });
    act(() => root.render(createElement(QuickBooksImport)));
    await click(button(/Import from QuickBooks/));

    const text = container.textContent ?? "";
    expect(text).toContain("Turner Construction");
    expect(text).toContain("ABC Supply");
    expect(text).toContain("Drywall:Hang");
    expect(text).toContain("$1.25");
    expect(text).toContain("QuickBooks customer #4");
    expect(container.querySelector('[data-tour="qbo-import-preview"]')).toBeTruthy();

    await click(button(/Confirm — add 3 records/));
    expect(fake.confirmQuickBooksImport).toHaveBeenCalledWith();
    expect(container.textContent).toContain("Added 1 client, 1 vendor and 1 catalog entry from QuickBooks.");
    // The preview is gone: it is no longer true.
    expect(container.textContent).not.toContain("Drywall:Hang");
  });

  it("shows a refusal as a sentence, with no preview", async () => {
    fake.previewQuickBooksImport.mockResolvedValue({ ok: false, error: "QuickBooks isn't connected. Press Connect QuickBooks first." });
    act(() => root.render(createElement(QuickBooksImport)));
    await click(button(/Import from QuickBooks/));
    expect(container.textContent).toContain("QuickBooks isn't connected.");
    expect(button(/Confirm/)).toBeUndefined();
  });

  it("offers no Confirm to press when nothing is new", async () => {
    fake.previewQuickBooksImport.mockResolvedValue({
      ok: true,
      value: { clients: empty, vendors: empty, catalog: empty, notices: [] },
    });
    act(() => root.render(createElement(QuickBooksImport)));
    await click(button(/Import from QuickBooks/));
    expect(button(/Nothing new to add/)?.disabled).toBe(true);
  });
});

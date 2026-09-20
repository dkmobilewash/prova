// @vitest-environment happy-dom

/**
 * What survives a failed save on step 2 of the bid-creation stepper.
 *
 * The house pattern this whole wizard follows (onSubmit + preventDefault +
 * new FormData(event.currentTarget), reset only on success) exists
 * precisely so a refusal never lands on an emptied form — see
 * formActionCensus.test.ts for the trap this avoids, and
 * logTimeEntryForm.test.ts for the reference this mirrors. This file is
 * that same proof for the two forms `BidWizardLineItems` adds: type a line
 * by hand, or pull one from the catalog.
 *
 * `addLineItem` and `addLineItemFromCatalog` are throw-style actions (they
 * predate the ActionResult convention), so the failure path under test is
 * a rejected promise, caught locally — same shape TakeoffForm already
 * relies on for the same two actions' shared guards.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = {
  addLineItem: vi.fn<(jobId: string, formData: FormData) => Promise<void>>(),
  addLineItemFromCatalog: vi.fn<(jobId: string, formData: FormData) => Promise<void>>(),
  addTakeoffLineItems:
    vi.fn<(jobId: string, formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>>(),
  deleteLineItem: vi.fn<(jobId: string, lineItemId: string) => Promise<void>>(),
};

vi.mock("@/lib/actions", () => fake);

const { BidWizardLineItems } = await import("@/components/BidWizardLineItems");

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
  fake.addLineItem.mockReset().mockResolvedValue(undefined);
  fake.addLineItemFromCatalog.mockReset().mockResolvedValue(undefined);
  fake.addTakeoffLineItems.mockReset().mockResolvedValue({ ok: true });
  fake.deleteLineItem.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

function field(name: string) {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!el) throw new Error(`no field named ${name}`);
  return el;
}

function formOf(name: string) {
  const form = field(name).closest("form");
  if (!form) throw new Error(`no form around ${name}`);
  return form;
}

/** `field()` finds the FIRST match in the whole container, which is wrong
 * the moment two forms share a field name — as the manual-add and
 * catalog-add forms both do for "quantity". This scopes the lookup to one
 * form, found by a name unique to it. */
function fieldIn(anchorName: string, name: string) {
  const el = formOf(anchorName).querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!el) throw new Error(`no field named ${name} in the form around ${anchorName}`);
  return el;
}

async function submit(name: string) {
  act(() => {
    formOf(name).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

const catalogEntries = [
  { id: "cat-1", description: "5/8 Type X — hang, tape, finish", unit: "SF" },
  { id: "cat-2", description: "Metal stud framing 16\" o.c.", unit: "LF" },
];

function renderWizard(lineItems: Parameters<typeof BidWizardLineItems>[0]["lineItems"] = []) {
  render(
    createElement(BidWizardLineItems, {
      jobId: "job-1",
      lineItems,
      catalogEntries,
    }),
  );
}

describe("the manual add-a-line form", () => {
  it("clears itself once the line is actually saved", async () => {
    renderWizard();
    field("description").value = "Level 2 corridor — hang and finish";
    field("quantity").value = "480";
    field("unit").value = "SF";
    field("unitPrice").value = "1.85";

    await submit("description");

    expect(fake.addLineItem).toHaveBeenCalledTimes(1);
    expect(field("description").value).toBe("");
    expect(field("unit").value).toBe("");
    expect(field("unitPrice").value).toBe("");
  });

  it("keeps every field the contractor typed when the save is refused", async () => {
    fake.addLineItem.mockRejectedValue(new Error("Description is required"));
    renderWizard();
    field("description").value = "Level 2 corridor — hang and finish";
    field("quantity").value = "480";
    field("unit").value = "SF";
    field("unitPrice").value = "1.85";

    await submit("description");

    expect(fake.addLineItem).toHaveBeenCalledTimes(1);
    // Nothing reset: this is the whole point. A refused save must not cost
    // the contractor having to retype four fields to fix one.
    expect(field("description").value).toBe("Level 2 corridor — hang and finish");
    expect(field("quantity").value).toBe("480");
    expect(field("unit").value).toBe("SF");
    expect(field("unitPrice").value).toBe("1.85");
    expect(container.textContent).toContain("Description is required");
  });
});

describe("the add-from-catalog form", () => {
  it("clears the quantity once the line is saved", async () => {
    renderWizard();
    field("catalogEntryId").value = "cat-2";
    fieldIn("catalogEntryId", "quantity").value = "3";

    await submit("catalogEntryId");

    expect(fake.addLineItemFromCatalog).toHaveBeenCalledTimes(1);
    const sent = fake.addLineItemFromCatalog.mock.calls[0][1];
    expect(sent.get("catalogEntryId")).toBe("cat-2");
    expect(sent.get("quantity")).toBe("3");
  });

  it("keeps the picked entry and quantity when the save is refused", async () => {
    fake.addLineItemFromCatalog.mockRejectedValue(new Error("Job not found"));
    renderWizard();
    field("catalogEntryId").value = "cat-1";
    fieldIn("catalogEntryId", "quantity").value = "12";

    await submit("catalogEntryId");

    expect((field("catalogEntryId") as HTMLSelectElement).value).toBe("cat-1");
    expect(fieldIn("catalogEntryId", "quantity").value).toBe("12");
    expect(container.textContent).toContain("Job not found");
  });

  it("is not rendered at all when the company has no catalog yet", () => {
    render(createElement(BidWizardLineItems, { jobId: "job-1", lineItems: [], catalogEntries: [] }));
    expect(container.querySelector('[name="catalogEntryId"]')).toBeNull();
  });
});

describe("the running list", () => {
  it("shows a real empty state rather than a blank list", () => {
    renderWizard([]);
    expect(container.textContent).toContain("Nothing added yet");
  });

  it("renders what is already on the estimate, priced and cost-only lines alike", () => {
    renderWizard([
      { id: "li-1", description: "5/8 Type X board", quantity: "480", unit: "SF", unitPrice: "1.85" },
      { id: "li-2", description: "General conditions", quantity: "1", unit: null, unitPrice: null },
    ]);

    expect(container.textContent).toContain("5/8 Type X board");
    expect(container.textContent).toContain("General conditions");
    // The priced line shows its extended total; the cost-only line must
    // not print a fabricated "$0.00" the contractor never entered.
    expect(container.textContent).toContain("$888.00");
  });
});

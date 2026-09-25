// @vitest-environment happy-dom

/**
 * Renders a DRAFT change order and clicks its two destructive controls.
 *
 * ISSUE #258. `ChangeOrders.tsx` removed a proposal from `onClick` and
 * discarded a draft from `onSubmit`, both on the FIRST click, against this
 * app's "two-step delete, never window.confirm" convention. It was the last
 * unconfirmed destructive in the product, and it had a documented exception
 * in `rowActionsCensus.test.ts` holding the rule armed for every other file
 * while it waited.
 *
 * WHY A RENDER AND NOT THE CENSUS. The callback census next door is
 * FILE-LEVEL by design and says so — "a file with two deletes can satisfy it
 * with one". So with `ChangeOrders.tsx`'s exception removed, putting EITHER
 * control back to one click leaves that census green, because the other one
 * still mentions `<ConfirmDelete>`. Proved by mutation rather than assumed:
 * reverting remove-a-proposal on its own turned nothing in the suite red
 * until this file existed. Two controls need two assertions that each click
 * a specific control.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts and not .test.tsx — same reason as rowActions.test.ts and
 * timeEntryRow.test.ts.
 *
 * WHAT THIS CANNOT SEE, stated rather than left to be discovered: position.
 * happy-dom does no layout and returns zeros from getBoundingClientRect, so
 * rule 2 — the confirm must not land on the pixel Delete vacated — is not
 * checkable here. The ORDER of the armed pair is, and order is what decides
 * position once the cluster's alignment is known. The proposal row is
 * right-pinned (`shrink-0` in a `justify-between` parent), so Cancel must be
 * LAST; the draft-actions cluster is left-aligned, so Cancel must be FIRST.
 * Both alignments were measured in real Chromium — see changelog.d.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { ok: true } | { ok: false; error: string };

const fake = {
  removeProposal: vi.fn<(id: string) => Promise<Result>>(),
  deleteChangeOrderDraft: vi.fn<(id: string) => Promise<Result>>(),
};

/* Every action the component imports has to exist on the mock, or the module
   fails to load. The two under test are spies; the rest are inert. */
vi.mock("@/lib/actions", () => ({
  removeProposal: fake.removeProposal,
  deleteChangeOrderDraft: fake.deleteChangeOrderDraft,
  approveChangeOrder: vi.fn(),
  createChangeOrder: vi.fn(),
  proposeAddedScope: vi.fn(),
  proposeLineItemChange: vi.fn(),
  proposeScopeRemoval: vi.fn(),
  rejectChangeOrder: vi.fn(),
  reopenChangeOrder: vi.fn(),
  reviseChangeOrder: vi.fn(),
  submitChangeOrder: vi.fn(),
  voidChangeOrder: vi.fn(),
}));

const { ChangeOrders } = await import("@/components/ChangeOrders");
type ChangeOrderView = import("@/components/ChangeOrders").ChangeOrderView;

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
  fake.removeProposal.mockReset();
  fake.removeProposal.mockResolvedValue({ ok: true });
  fake.deleteChangeOrderDraft.mockReset();
  fake.deleteChangeOrderDraft.mockResolvedValue({ ok: true });
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

function buttons(): string[] {
  return Array.from(container.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
}

function click(text: string) {
  const el = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!el) throw new Error(`no button labelled "${text}" — found: ${buttons().join(" | ")}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** A click that starts a transition, drained. `useActionRunner` awaits the
 *  action inside `startTransition`, so the state it sets lands a microtask
 *  after the synchronous dispatch — outside `act` unless it is awaited. */
async function clickAndSettle(text: string) {
  click(text);
  await act(async () => {
    await Promise.resolve();
  });
}

const draft: ChangeOrderView = {
  id: "co-1",
  number: 3,
  title: "Added soffit framing at grid C",
  description: null,
  status: "DRAFT",
  submittedOn: null,
  decidedOn: null,
  decisionNotes: null,
  valueDelta: "+$4,200.00",
  reopenBlockers: [],
  reopenedAt: null,
  reopenNote: null,
  supersedesLabel: null,
  revisedByLabels: [],
  proposals: [
    { id: "p-1", changeType: "ADD", targetDescription: null, summary: "Soffit framing, 40 LF" },
  ],
  edits: [],
};

function renderDraft() {
  render(
    createElement(ChangeOrders, {
      jobId: "job-1",
      changeOrders: [draft],
      lineItems: [{ id: "li-1", description: "Metal stud framing" }],
      pendingExposure: "$0.00",
      today: "2026-09-25",
    }),
  );
}

describe("removing a proposal from a draft change order", () => {
  it("does nothing on the first click — it arms a confirm", () => {
    renderDraft();
    click("remove");
    expect(
      fake.removeProposal,
      "one click removed a proposed change: this is issue #258 back",
    ).not.toHaveBeenCalled();
    expect(buttons()).toContain("Remove it");
    expect(buttons()).toContain("Cancel");
  });

  it("removes it on the confirm, and only then", async () => {
    renderDraft();
    click("remove");
    await clickAndSettle("Remove it");
    expect(fake.removeProposal).toHaveBeenCalledTimes(1);
    expect(fake.removeProposal).toHaveBeenCalledWith("p-1");
  });

  it("cancels back to one control, having removed nothing", () => {
    renderDraft();
    click("remove");
    click("Cancel");
    expect(fake.removeProposal).not.toHaveBeenCalled();
    expect(buttons()).toContain("remove");
    expect(buttons()).not.toContain("Remove it");
  });

  it("renders Cancel LAST, because this cluster is right-pinned", () => {
    // Rule 2: Cancel inherits the pixel Delete vacated, and in a right-pinned
    // cluster the LAST control is the one that keeps its position. Swap the
    // pair and a hurried second click destroys the record.
    renderDraft();
    click("remove");
    const armed = buttons().filter((b) => b === "Remove it" || b === "Cancel");
    expect(armed).toEqual(["Remove it", "Cancel"]);
  });
});

describe("discarding a draft change order", () => {
  it("does nothing on the first click — it arms a confirm", () => {
    renderDraft();
    click("Discard");
    expect(
      fake.deleteChangeOrderDraft,
      "one click threw a draft change order away: this is issue #258 back",
    ).not.toHaveBeenCalled();
    expect(buttons()).toContain("Discard it");
    expect(buttons()).toContain("Cancel");
  });

  it("discards it on the confirm, and only then", async () => {
    renderDraft();
    click("Discard");
    await clickAndSettle("Discard it");
    expect(fake.deleteChangeOrderDraft).toHaveBeenCalledTimes(1);
    expect(fake.deleteChangeOrderDraft).toHaveBeenCalledWith("co-1");
  });

  it("hides Send to GC while the discard is armed", () => {
    // RowActions rule 1, and the reason it is a component: an ordinary
    // action left live beside an armed confirm is issue #152, twenty times
    // over. "Send to GC" is the ordinary action in this cluster.
    renderDraft();
    expect(buttons()).toContain("Send to GC");
    click("Discard");
    expect(
      buttons(),
      "Send to GC is still clickable beside an armed discard",
    ).not.toContain("Send to GC");
    click("Cancel");
    expect(buttons()).toContain("Send to GC");
  });

  it("renders Cancel FIRST, because this cluster is left-aligned", () => {
    renderDraft();
    click("Discard");
    const armed = buttons().filter((b) => b === "Discard it" || b === "Cancel");
    expect(armed).toEqual(["Cancel", "Discard it"]);
  });
});

describe("the fixture still reaches both controls", () => {
  // Absence of a failure is not a pass: every assertion above is about a
  // button being absent or a spy not being called, and a fixture that
  // rendered no draft at all would satisfy most of them. So name both
  // controls as present BEFORE anything is clicked.
  it("renders an unarmed remove and an unarmed discard", () => {
    renderDraft();
    expect(buttons()).toContain("remove");
    expect(buttons()).toContain("Discard");
    expect(buttons()).not.toContain("Remove it");
    expect(buttons()).not.toContain("Discard it");
  });
});

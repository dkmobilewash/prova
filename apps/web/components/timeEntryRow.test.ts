// @vitest-environment happy-dom

/**
 * Renders one field time entry and clicks it, for both halves of issue #63.
 *
 * A logged hour had exactly one control — Remove — and it deleted on the
 * first click. These are the rows a WH-347 is built from, so the two things
 * asserted here are that the delete now asks twice, and that the edit form
 * OFFERS NO WAY to change who worked or which day. The second is the one a
 * source scan cannot answer: a `<select name="employeeUserId">` rendered in
 * the edit form would be a reassignment path with a friendly label on it.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts and not .test.tsx — same reason as rowActions.test.ts.
 *
 * What this cannot see, said plainly: position. happy-dom does no layout, so
 * the rule that the confirm must not land on the pixel Delete vacated is not
 * checkable here. The ORDER of the pair is, and order is what decides
 * position once the cluster's alignment is known — this cluster is
 * right-pinned (`shrink-0`), so Cancel must come last.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = {
  updateTimeEntry: vi.fn<(id: string, formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>>(),
};

vi.mock("@/lib/actions", () => ({ updateTimeEntry: fake.updateTimeEntry }));

const { TimeEntryRow } = await import("@/components/TimeEntryRow");
type TimeEntryRowData = import("@/components/TimeEntryRow").TimeEntryRowData;

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
  fake.updateTimeEntry.mockReset();
  fake.updateTimeEntry.mockResolvedValue({ ok: true });
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

/** Every control a user could actually operate, in document order. */
function liveControls() {
  return Array.from(container.querySelectorAll<HTMLElement>("button, a[href]"))
    .filter((el) => !(el as HTMLButtonElement).disabled)
    .map((el) => (el.textContent ?? "").trim());
}

function click(text: string) {
  const el = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!el) throw new Error(`no button labelled "${text}" — found: ${liveControls().join(", ")}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const entry: TimeEntryRowData = {
  id: "te-1",
  dateLabel: "Aug 31, 2026",
  employeeLabel: "Mike Alvarez",
  hours: "10",
  payType: "STRAIGHT",
  note: null,
  perDiemAmount: null,
  travelPayAmount: null,
  lineItemId: null,
  lineItemLabel: null,
  craftClassificationId: null,
  craftLabel: null,
  estimatedCostLabel: null,
  lastCorrectedLabel: null,
  lockedLabel: null,
};

function row(overrides: Partial<TimeEntryRowData> = {}, deleteAction = () => {}) {
  return createElement(TimeEntryRow, {
    entry: { ...entry, ...overrides },
    lineItems: [{ id: "li-1", description: "Level 3 corridor framing" }],
    craftOptions: [{ id: "cc-1", label: "Carpenters 300 — Journeyman" }],
    deleteAction,
  });
}

function editForm() {
  return container.querySelector("form");
}

async function submitEdit() {
  const form = editForm();
  if (!form) throw new Error("no edit form is open");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("a field time entry row", () => {
  it("shows the day, the person and the hours, with an edit and a remove", () => {
    render(row());
    expect(container.textContent).toContain("Aug 31, 2026");
    expect(container.textContent).toContain("Mike Alvarez");
    expect(container.textContent).toContain("10h");
    expect(liveControls()).toEqual(["Edit", "Remove"]);
  });

  it("offers neither Edit nor Remove on a signed day, and says why", () => {
    render(row({ lockedLabel: "Signed" }));
    expect(liveControls()).toEqual([]);
    expect(container.textContent).toContain("Signed · locked");
    expect(container.textContent).toContain("10h");
  });

  it("does NOT delete on the first click — Remove arms a second step", () => {
    const deleteAction = vi.fn();
    render(row({}, deleteAction));
    click("Remove");
    expect(deleteAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Confirm remove");
  });

  it("hides the edit while the delete is armed, and puts Cancel last in a right-pinned cluster", () => {
    render(row());
    click("Remove");
    // Cancel last: this cluster is `shrink-0` off the right of the row, so
    // the LAST control is the one that keeps its position when the row
    // empties. [Confirm][Cancel] is `pinned="end"`.
    expect(liveControls()).toEqual(["Confirm remove", "Cancel"]);
  });

  it("offers no way to change the person or the day worked", () => {
    render(row());
    click("Edit");
    const form = editForm();
    expect(form, "clicking Edit opened no form").not.toBeNull();
    if (!form) return;

    expect(form.querySelector('[name="hours"]')).not.toBeNull();
    expect(form.querySelector('[name="note"]')).not.toBeNull();
    expect(form.querySelector('[name="payType"]')).not.toBeNull();

    // The identity of a payroll record: who, and which day. Correcting
    // either makes it a different record, so it is a delete-and-re-enter,
    // not an edit — and the form must not offer it at all.
    expect(form.querySelector('[name="date"]'), "the edit form offers a date input").toBeNull();
    expect(
      form.querySelector('[name="employeeUserId"]'),
      "the edit form offers an employee picker",
    ).toBeNull();
    expect(
      form.querySelector('[name="crewMemberId"]'),
      "the edit form offers a crew member picker",
    ).toBeNull();

    // Still SHOWN, so the person editing knows whose day they are changing.
    expect(form.textContent).toContain("Mike Alvarez");
    expect(form.textContent).toContain("Aug 31, 2026");
  });

  it("keeps the delete out of the row while an edit is open", () => {
    render(row());
    click("Edit");
    expect(liveControls()).not.toContain("Remove");
  });

  it("sends the corrected hours to updateTimeEntry and closes on success", async () => {
    render(row());
    click("Edit");

    const hours = editForm()?.querySelector<HTMLInputElement>('[name="hours"]');
    expect(hours?.value, "the form did not open on the stored hours").toBe("10");
    if (hours) hours.value = "8";

    await submitEdit();

    expect(fake.updateTimeEntry).toHaveBeenCalledTimes(1);
    const [id, formData] = fake.updateTimeEntry.mock.calls[0] as [string, FormData];
    expect(id).toBe("te-1");
    expect(formData.get("hours")).toBe("8");
    expect(formData.get("date")).toBeNull();
    expect(formData.get("employeeUserId")).toBeNull();

    // Back to the row, which is how the user knows it saved.
    expect(editForm()).toBeNull();
    expect(liveControls()).toEqual(["Edit", "Remove"]);
  });

  it("renders the refusal the action returns, rather than swallowing it", async () => {
    // Production redacts a THROWN Server Action message to a digest, so the
    // action returns its refusals. They are worth nothing unrendered.
    fake.updateTimeEntry.mockResolvedValue({
      ok: false,
      error: "Hours must be a positive number.",
    });
    render(row());
    click("Edit");
    await submitEdit();

    expect(container.textContent).toContain("Hours must be a positive number.");
    expect(editForm(), "the form closed on a failure and lost what was typed").not.toBeNull();
  });

  it("says on the row when an entry has been corrected, and by whom", () => {
    // The half of issue #63 that an edit path alone does not answer: a
    // silently mutable hour is not evidence either.
    render(row({ lastCorrectedLabel: "corrected Sep 13, 2026 by Cyrus Obiz" }));
    expect(container.textContent).toContain("corrected Sep 13, 2026 by Cyrus Obiz");
  });

  it("says nothing about corrections on an entry nobody has corrected", () => {
    render(row());
    expect(container.textContent).not.toContain("corrected");
  });
});

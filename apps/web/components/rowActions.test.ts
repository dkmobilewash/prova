// @vitest-environment happy-dom

/**
 * Renders <RowActions> into a real DOM and clicks it.
 *
 * Deliberately NOT a source scan. Issue #152's whole history is guards that
 * read correctly and behaved wrongly, and a grep-shaped test cannot see an
 * inverted one — CLAUDE.md says so in as many words. So this mounts the
 * component, clicks Delete, and then asks the DOM what a user could still
 * click. Invert the guard in RowActions.tsx and "hides every ordinary
 * action" fails; swap the two branches of `pinned` and both order tests fail.
 *
 * What it CANNOT see: position. happy-dom does no layout, so
 * `getBoundingClientRect` is zeros here and rule 2 — the confirm must not
 * land on the pixel Delete vacated — is not directly checkable in this file.
 * The order of the two buttons is checkable, and order is what decides
 * position once you know the cluster's alignment; the alignments were
 * measured in a real browser and written onto the `pinned` prop.
 *
 * Written with createElement rather than JSX only because the suite's
 * `include` matches .test.ts and not .test.tsx; nothing about it needs JSX.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

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
  return Array.from(
    container.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea"),
  )
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

/** A row shaped like the ones issue #152 found: ordinary actions, then a
 *  delete. `Mark received` is the second one — the position a later merge
 *  filled on ApprenticeshipRowActions after the first fix emptied it. */
function row(onConfirm = () => {}) {
  return createElement(
    RowActions,
    {
      className: "flex gap-2",
      destructive: createElement(ConfirmDelete, { onConfirm }),
    },
    createElement("button", { type: "button", key: "e" }, "Edit"),
    createElement("button", { type: "button", key: "m" }, "Mark received"),
  );
}

describe("RowActions", () => {
  it("shows the ordinary actions and a single-word delete before it is armed", () => {
    render(row());
    expect(liveControls()).toEqual(["Edit", "Mark received", "Delete"]);
  });

  it("hides EVERY ordinary action once the delete is armed", () => {
    render(row());
    click("Delete");

    const live = liveControls();
    expect(live).not.toContain("Edit");
    expect(live).not.toContain("Mark received");
    // And nothing else survived either — the row is only the confirm pair.
    expect(live).toEqual(["Cancel", "Confirm delete"]);
  });

  /* Rule 2 is about WHERE the confirm lands, and this environment cannot see
     where anything lands: happy-dom and jsdom do no layout, so every
     `getBoundingClientRect` here is zeros. Asserting on one would be a test
     that cannot fail — issue #150's whole subject. What the DOM CAN answer is
     the ORDER of the two buttons, which is the one decision `pinned` makes,
     and the geometry that makes each order right was measured in real
     Chromium and is recorded on the prop's docstring in RowActions.tsx.

     Both directions are asserted, because a component that ignored `pinned`
     entirely would still pass either one on its own. */
  it("renders [Cancel][Confirm] by default — the start-pinned cluster, where the first slot is the stable one", () => {
    render(row());
    click("Delete");

    const live = liveControls();
    expect(live).toEqual(["Cancel", "Confirm delete"]);
    expect(live.indexOf("Cancel")).toBeLessThan(live.indexOf("Confirm delete"));
  });

  it("renders [Confirm][Cancel] when pinned=\"end\" — the right-pinned cluster, where the LAST control is the stable one", () => {
    render(
      createElement(
        RowActions,
        {
          className: "flex shrink-0 gap-2",
          destructive: createElement(ConfirmDelete, { pinned: "end" as const }),
        },
        createElement("button", { type: "button", key: "e" }, "Edit"),
      ),
    );
    click("Delete");

    const live = liveControls();
    expect(live).toEqual(["Confirm delete", "Cancel"]);
    expect(live.indexOf("Confirm delete")).toBeLessThan(live.indexOf("Cancel"));
  });

  it("still hides every ordinary action when pinned=\"end\" — the order is the only thing that changes", () => {
    render(
      createElement(
        RowActions,
        { destructive: createElement(ConfirmDelete, { pinned: "end" as const }) },
        createElement("button", { type: "button", key: "e" }, "Edit"),
        createElement("button", { type: "button", key: "m" }, "Mark received"),
      ),
    );
    click("Delete");

    expect(liveControls()).toEqual(["Confirm delete", "Cancel"]);
  });

  /* ---- the phone half of rule 2 (#184) ----------------------------------
     Below 640px the armed pair is its own full-width column with CANCEL ON
     TOP, because in a stacked cluster there is no "end" for Cancel to
     inherit — the ordinary actions are gone and nothing is at the delete's
     pixel any more. Measured in real Chromium: 86% confirm overlap on main
     at 375px, 0% with this, and Cancel covering 100% of the vacated box.

     None of THAT is checkable here and no test in this repo can check it —
     happy-dom does no layout (issue #150). What this environment can see is
     structural, and it is enough to catch the mutation that matters: the
     column direction and the DOM order have to disagree in exactly the right
     way, or the CONFIRM ends up on top. So these tests compute the VISUAL
     order from the two things a DOM can read — the order of the buttons and
     the flex-direction class of their wrapper — and require Cancel first for
     both values of `pinned`. Swap the two class constants and they go red. */

  /** The wrapper the two armed buttons share, and nothing else. */
  function armedPair() {
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Cancel",
    );
    if (!cancel) throw new Error("not armed — no Cancel button");
    return cancel.parentElement as HTMLElement;
  }

  /** Top-to-bottom order below `sm`, which is DOM order through the
   *  wrapper's flex-direction. `-reverse` is the whole point of the prop. */
  function orderBelowSm() {
    const pair = armedPair();
    const labels = Array.from(pair.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").trim(),
    );
    return pair.className.includes("max-sm:flex-col-reverse") ? [...labels].reverse() : labels;
  }

  it("puts Cancel on top of the armed column below sm — the default order", () => {
    render(row());
    click("Delete");

    expect(orderBelowSm()).toEqual(["Cancel", "Confirm delete"]);
  });

  it("puts Cancel on top of the armed column below sm — pinned=\"end\" too, which is the reversed one", () => {
    render(
      createElement(
        RowActions,
        {
          className: "flex shrink-0 gap-2",
          destructive: createElement(ConfirmDelete, { pinned: "end" as const }),
        },
        createElement("button", { type: "button", key: "e" }, "Edit"),
      ),
    );
    click("Delete");

    // DOM order is [Confirm][Cancel] — that is what makes the DESKTOP right.
    expect(liveControls()).toEqual(["Confirm delete", "Cancel"]);
    // Reversed by the column, so the phone gets Cancel on top from the same
    // markup. Both halves of rule 2 out of one order.
    expect(orderBelowSm()).toEqual(["Cancel", "Confirm delete"]);
  });

  it("holds the two buttons in ONE wrapper that is `contents` at desktop widths", () => {
    render(row());
    click("Delete");

    const pair = armedPair();
    expect(Array.from(pair.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Cancel",
      "Confirm delete",
    ]);
    // `contents` is why the 1100px rects are byte-identical to before this
    // fix: at >=640px the wrapper is not a box and the buttons are flex items
    // of the caller's own cluster, exactly as they were.
    expect(pair.className.split(/\s+/)).toContain("contents");
    expect(pair.className).toMatch(/max-sm:flex\b/);
    expect(pair.className).toMatch(/max-sm:w-full/);
  });

  it("leaves the prompt OUTSIDE the column, so reversing it cannot put the question under the buttons", () => {
    render(
      createElement(RowActions, {
        destructive: createElement(ConfirmDelete, {
          pinned: "end" as const,
          prompt: "Delete Acme Drywall?",
        }),
      }),
    );
    click("Delete");

    const pair = armedPair();
    expect(pair.textContent).not.toContain("Delete Acme Drywall?");
    expect(container.textContent).toContain("Delete Acme Drywall?");
  });

  it("adds nothing at all to the row while it is unarmed", () => {
    render(row());
    const del = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Delete",
    )!;
    // The delete is a direct child of the cluster, not wrapped in anything —
    // the armed column exists only while armed, so the resting row is
    // untouched at every width.
    expect(del.parentElement?.className).toBe("flex gap-2");
  });

  it("does not delete, and gives the row back, when Cancel is clicked", () => {
    const onConfirm = vi.fn();
    render(row(onConfirm));
    click("Delete");
    click("Cancel");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(liveControls()).toEqual(["Edit", "Mark received", "Delete"]);
  });

  it("deletes on the confirm, and only once however many times it is clicked", () => {
    const onConfirm = vi.fn();
    render(row(onConfirm));
    click("Delete");
    click("Confirm delete");
    click("Confirm delete");

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("hides an ordinary action added to the row later, without being told about it", () => {
    // The #117 -> #119 regression: a new button dropped into the action
    // cluster. As a child of RowActions there is no guard to forget.
    render(
      createElement(
        RowActions,
        { destructive: createElement(ConfirmDelete, {}) },
        createElement("button", { type: "button", key: "a" }, "Edit"),
        createElement("button", { type: "button", key: "b" }, "Record a period"),
        createElement("button", { type: "button", key: "c" }, "Edit enrolment"),
        createElement("a", { href: "/file.pdf", key: "d" }, "View file"),
      ),
    );
    click("Delete");

    expect(liveControls()).toEqual(["Cancel", "Confirm delete"]);
  });

  it("keeps the confirm disabled while the row's own action is in flight", () => {
    const onConfirm = vi.fn();
    render(
      createElement(RowActions, {
        destructive: createElement(ConfirmDelete, { onConfirm, pending: true }),
      }),
    );
    // `pending` while unarmed also blocks arming, so nothing is live at all.
    expect(liveControls()).toEqual([]);
  });

  it("refuses to render outside a RowActions, rather than silently not hiding anything", () => {
    expect(() =>
      render(createElement(ConfirmDelete, { onConfirm: () => {} })),
    ).toThrow(/destructive/);
  });
});

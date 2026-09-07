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

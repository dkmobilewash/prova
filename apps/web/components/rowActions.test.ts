// @vitest-environment happy-dom

/**
 * Renders <RowActions> into a real DOM and clicks it.
 *
 * Deliberately NOT a source scan. Issue #152's whole history is guards that
 * read correctly and behaved wrongly, and a grep-shaped test cannot see an
 * inverted one — CLAUDE.md says so in as many words. So this mounts the
 * component, clicks Delete, and then asks the DOM what a user could still
 * click. Invert the guard in RowActions.tsx and "hides every ordinary
 * action" fails; swap Cancel and the confirm and "cancel comes first" fails.
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

  it("puts Cancel before the confirm, so the confirm never takes the delete's place", () => {
    render(row());
    click("Delete");

    const live = liveControls();
    expect(live.indexOf("Cancel")).toBeLessThan(live.indexOf("Confirm delete"));
    expect(live[0]).toBe("Cancel");
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

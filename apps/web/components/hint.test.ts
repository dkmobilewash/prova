// @vitest-environment happy-dom

/**
 * Mounts <Hint> into a real DOM and operates it.
 *
 * The census in `hintCensus.test.ts` answers "does every dangerous control
 * carry a description". This file answers the prior question — is the
 * description reachable at all, and does adding one change the row it sits
 * in. Both halves have failed separately in this repo's history: a control
 * with prose nobody can reach is the same as no prose, and a wrapper that
 * moves a delete button by four pixels reopens issue #152's rule 2, which
 * was measured in a real browser and cannot be re-measured here.
 *
 * WHAT IT CANNOT SEE, stated so nobody trusts it further than it goes.
 * happy-dom does no layout: `getBoundingClientRect` is zeros and no test in
 * this repo can assert where the tooltip lands or that the trigger's box is
 * unchanged. What it CAN assert is the mechanism that makes the box
 * unchanged — the wrapper is `display: contents` (no box of its own, the
 * same device `ConfirmDelete`'s armed column uses and had measured
 * byte-identical at 1100px), and the tooltip is `position: fixed` and
 * `hidden` until asked for, so it is never a flex item of the caller's
 * cluster and never eats a gap. Those three class names are the whole of
 * the geometry argument, so they are asserted literally.
 */

/* eslint-disable react/no-children-prop -- This suite's `include` matches
   .test.ts and not .test.tsx, so every element here is built with
   createElement (same reason rowActions.test.ts gives). `createElement`'s
   types do not fold rest-argument children into the component's props, so a
   component with a REQUIRED `children` can only be constructed by passing it
   in the props object — and `children` stays required on <Hint> because a
   Hint with nothing to describe is meaningless. The rule is about JSX
   readability; there is no JSX in this file. */

import { createElement, type ButtonHTMLAttributes } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hint } from "@/components/Hint";

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

const DESCRIPTION = "Records the release. Does not notify the GC.";

/** The props are annotated rather than inferred so the element's type is the
 *  full set of button attributes, which is what a JSX call site hands
 *  `<Hint>`. Inferred from the literal it would be `{ type: string }`, and
 *  the component quite correctly refuses an element that cannot carry
 *  `aria-describedby`. */
function control(label: string, extra: ButtonHTMLAttributes<HTMLButtonElement> = {}) {
  const props: ButtonHTMLAttributes<HTMLButtonElement> = { type: "button", ...extra };
  return createElement("button", props, label);
}

function mount(label = "Release retainage") {
  act(() => {
    root.render(createElement(Hint, { text: DESCRIPTION, children: control(label) }));
  });
}

function trigger() {
  const el = container.querySelector("button");
  if (!el) throw new Error("no trigger rendered");
  return el;
}

function tooltip() {
  const el = container.querySelector('[role="tooltip"]');
  if (!el) throw new Error("no tooltip rendered");
  return el as HTMLElement;
}

function fire(type: string, init: EventInit = {}) {
  act(() => {
    trigger().dispatchEvent(new Event(type, { bubbles: true, ...init }));
  });
}

function isOpen() {
  return !tooltip().hasAttribute("hidden");
}

describe("Hint", () => {
  it("describes the control it wraps, by id rather than by title alone", () => {
    mount();
    const described = trigger().getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    // The one thing that makes it reachable by a screen reader: the id the
    // control points at has to be the node holding the words.
    expect(tooltip().id).toBe(described);
    expect(tooltip().textContent).toBe(DESCRIPTION);
    // A title would give the same words to a mouse and nothing to a
    // keyboard, and two tooltips to anyone who hovers.
    expect(trigger().hasAttribute("title")).toBe(false);
  });

  it("starts closed", () => {
    mount();
    expect(isOpen()).toBe(false);
  });

  it("opens on hover and closes when the pointer leaves", () => {
    mount();
    fire("mouseover");
    expect(isOpen()).toBe(true);
    fire("mouseout");
    expect(isOpen()).toBe(false);
  });

  it("opens on keyboard focus — a hover-only hint is invisible to anyone tabbing", () => {
    mount();
    fire("focusin");
    expect(isOpen()).toBe(true);
    fire("focusout");
    expect(isOpen()).toBe(false);
  });

  it("does NOT open on the focus a mouse click causes", () => {
    // Every click focuses its button, so opening on focus alone would leave
    // a tooltip standing over the row you just acted on — and on a phone,
    // over the row you just tapped.
    mount();
    fire("pointerdown");
    fire("focusin");
    expect(isOpen()).toBe(false);
  });

  it("closes on Escape while the control keeps focus", () => {
    mount();
    fire("focusin");
    expect(isOpen()).toBe(true);
    act(() => {
      trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(isOpen()).toBe(false);
  });

  it("closes on click, so a tap is never left under a popover", () => {
    mount();
    fire("mouseover");
    expect(isOpen()).toBe(true);
    fire("click");
    expect(isOpen()).toBe(false);
  });

  /* THE GEOMETRY ARGUMENT. See the header: this is the part that keeps the
     armed-delete measurements in CLAUDE.md valid, and it is three class
     names rather than a position, because a position is not observable
     here. */
  it("adds no layout box: the wrapper is display:contents", () => {
    mount();
    const wrapper = trigger().parentElement;
    expect(wrapper?.className.split(/\s+/)).toContain("contents");
  });

  it("keeps the tooltip out of flow and out of the way, open or closed", () => {
    mount();
    const classes = () => tooltip().className.split(/\s+/);
    expect(classes()).toContain("fixed");
    // Never intercepts the tap that was meant for the control under it.
    expect(classes()).toContain("pointer-events-none");
    fire("mouseover");
    expect(classes()).toContain("fixed");
    expect(classes()).toContain("pointer-events-none");
  });

  it("puts nothing between the control and its cluster", () => {
    // The wrapper generates no box, so its element children ARE the flex
    // items of the caller's cluster: the control, and a tooltip that is
    // display:none until asked for. Anything else here is a box that moved
    // the row.
    mount();
    const wrapper = trigger().parentElement!;
    expect(Array.from(wrapper.children).map((el) => el.tagName)).toEqual(["BUTTON", "SPAN"]);
    expect(wrapper.children[1].hasAttribute("hidden")).toBe(true);
  });

  it("keeps a description the control already had", () => {
    act(() => {
      root.render(
        createElement(Hint, {
          text: DESCRIPTION,
          children: control("Delete", { "aria-describedby": "existing-note" }),
        }),
      );
    });
    const described = (trigger().getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toContain("existing-note");
    expect(described).toContain(tooltip().id);
  });
});

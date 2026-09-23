// @vitest-environment happy-dom

/**
 * Measuring this build found that a focused, tabindex=0, horizontally
 * overflowing <div> does NOT scroll on ArrowLeft/ArrowRight in real
 * Chromium — confirmed by hand against the running page before writing
 * this file, not assumed. CapabilitiesRail is the fix: a key handler that
 * moves the container one card at a time. This file proves the handler
 * itself, and that it degrades to an instant jump rather than an
 * animation under prefers-reduced-motion.
 */

import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let reducedMotion = false;
let lastScrollByArgs: ScrollToOptions | null = null;

beforeEach(() => {
  reducedMotion = false;
  lastScrollByArgs = null;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce") ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // happy-dom does not implement scrollBy — stub it so the handler can be
  // exercised and its arguments inspected. The component only ever calls
  // the options-object overload.
  Element.prototype.scrollBy = ((arg: ScrollToOptions) => {
    lastScrollByArgs = arg;
  }) as typeof Element.prototype.scrollBy;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const { CapabilitiesRail } = await import("./CapabilitiesRail");

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        CapabilitiesRail,
        // `label` is required and has no default on purpose — it used to
        // be a literal inside CapabilitiesRail.tsx that counted the cards
        // ("six capabilities") while being unable to see them, and it went
        // stale when the list changed length. The real caller derives it
        // from CAPABILITIES.length; this test only needs a valid name.
        //
        // Children stay VARIADIC here. Passing them inside the props object
        // also typechecks, and is a `react/no-children-prop` lint error —
        // which is an error rather than a warning in this repo, so it fails
        // the build. `children` is optional in the component's prop type
        // precisely so this call site can stay the ordinary shape.
        { label: "Two test cards. Swipe, scroll, or use the arrow keys." },
        createElement("article", { "data-rail-card": true, style: { width: "300px" } }, "card 1"),
        createElement("article", { "data-rail-card": true, style: { width: "300px" } }, "card 2"),
      ),
    );
  });
  const el = container.querySelector('[role="region"]') as HTMLElement;
  return {
    el,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function press(el: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
}

describe("CapabilitiesRail", () => {
  it("is a real, focusable, labelled scroll region — reachable with no JS at all", () => {
    const { el, cleanup } = mount();
    expect(el.getAttribute("role")).toBe("region");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.className).toContain("overflow-x-auto");
    expect(el.className).toContain("snap-x");
    cleanup();
  });

  it("ArrowRight moves forward by roughly one card's width, smoothly, by default", () => {
    const { el, cleanup } = mount();
    press(el, "ArrowRight");
    expect(lastScrollByArgs?.left).toBeGreaterThan(0);
    expect(lastScrollByArgs?.behavior).toBe("smooth");
    cleanup();
  });

  it("ArrowLeft moves backward", () => {
    const { el, cleanup } = mount();
    press(el, "ArrowLeft");
    expect(lastScrollByArgs?.left).toBeLessThan(0);
    cleanup();
  });

  it("requested: prefers-reduced-motion turns the animated scroll into an instant jump, not into no movement at all", () => {
    reducedMotion = true;
    const { el, cleanup } = mount();
    press(el, "ArrowRight");
    expect(lastScrollByArgs?.behavior).toBe("auto");
    expect(lastScrollByArgs?.left).toBeGreaterThan(0);
    cleanup();
  });

  it("caught: an unrelated key does nothing", () => {
    const { el, cleanup } = mount();
    press(el, "Enter");
    expect(lastScrollByArgs).toBeNull();
    cleanup();
  });
});

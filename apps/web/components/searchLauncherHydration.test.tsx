// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// `useRouter` throws "invariant expected app router to be mounted" outside
// a real app tree. It plays no part in what this file measures — the
// markup of the shortcut hint — so it is stubbed rather than staged.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

const { SearchLauncher } = await import("@/components/SearchLauncher");

/**
 * THE SERVER AND THE BROWSER ARE DIFFERENT MACHINES, AND THIS COMPONENT
 * USED TO ASK THE MACHINE A QUESTION WHILE RENDERING.
 *
 * `isMac()` was called in the component body to pick between "⌘K" and
 * "Ctrl K". Vercel runs Linux, so the HTML said "Ctrl K"; a reader on a
 * Mac, iPhone or iPad got "⌘K" on the first client render. Two different
 * text nodes in the same place on the first render is a React hydration
 * mismatch — and `SearchLauncher` is in the Topbar, which
 * `app/(app)/layout.tsx` mounts on EVERY authenticated page. One error per
 * page load, per Mac user, since c538c3ad (2026-09-20).
 *
 * WHY NOTHING CAUGHT IT. The `typeof navigator === "undefined"` guard
 * reads like it handles the server, and that is what made it look safe. It
 * only stops the call from THROWING. Answering DIFFERENTLY on the server
 * than in the browser is the whole defect, and a guard that confidently
 * returns `false` is how it was produced.
 *
 * THE TEST IS THE DEFECT, NOT A GREP FOR IT. Both renders below are real
 * `renderToString` calls; the only thing that changes between them is the
 * `navigator` the render can see. Server-shaped and Mac-shaped markup must
 * be identical, because that identity IS what hydration checks. A lint
 * rule about `navigator` could be satisfied without this being true; this
 * cannot.
 */

/** happy-dom supplies a `navigator`, so "the server" here means the shape
 * Node 20 actually presents to a render: no such global at all. */
function renderWithNavigator(platform: string | undefined): string {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    if (platform === undefined) {
      Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
    } else {
      Object.defineProperty(globalThis, "navigator", {
        value: { platform, userAgent: platform },
        configurable: true,
      });
    }
    return renderToString(createElement(SearchLauncher));
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

afterEach(() => {
  // Nothing should leak a patched navigator into another file's tests.
  expect(typeof navigator).toBe("object");
});

describe("SearchLauncher renders the same markup wherever it is rendered", () => {
  it("is byte-identical on a Linux server and a Mac browser", () => {
    const server = renderWithNavigator(undefined);
    const mac = renderWithNavigator("MacIntel");

    // The exact comparison hydration makes. Before the fix these differed
    // by one text node — "Ctrl K" against "⌘K".
    expect(mac).toBe(server);
  });

  it("is byte-identical on an iPhone and an iPad too", () => {
    const server = renderWithNavigator(undefined);
    expect(renderWithNavigator("iPhone")).toBe(server);
    expect(renderWithNavigator("iPad")).toBe(server);
  });

  it("is byte-identical on a Linux browser, the case CI runs and cannot see", () => {
    // Worth pinning precisely because it ALWAYS passed: CI is ubuntu with
    // a Linux Chromium, so both sides answered "Ctrl K" and the E2E
    // hydration monitor was blind to this bug. A guard that only holds on
    // the machine that never reproduces the defect is not a guard.
    expect(renderWithNavigator("Linux x86_64")).toBe(renderWithNavigator(undefined));
  });

  it("renders a shortcut hint at all", () => {
    // Vacuity guard: if the label ever stops being rendered, every
    // comparison above is trivially true and this file proves nothing.
    expect(renderWithNavigator(undefined)).toContain("Ctrl K");
  });

  it("shows the server's answer first, so hydration has something to match", () => {
    // Not "⌘K" even on a Mac. The Mac label arrives from an effect, after
    // the first render has already agreed with the HTML.
    expect(renderWithNavigator("MacIntel")).not.toContain("⌘K");
  });
});

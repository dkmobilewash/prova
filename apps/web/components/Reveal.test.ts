// @vitest-environment happy-dom

/**
 * Reveal is the only new client-side motion the landing page ships, and it
 * exists to satisfy one constraint from the redesign brief: "everything
 * visible at rest, never parked at opacity 0 waiting on an observer that
 * may not fire." This file proves each way that could go wrong stays
 * impossible — the CSS half of the same guarantee is
 * app/globals.reveal.test.ts, which checks the styles these states drive
 * are gated behind prefers-reduced-motion independently of this file.
 */

import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Entry = { isIntersecting: boolean };
type ObserverCallback = (entries: Entry[]) => void;

let capturedCallback: ObserverCallback | null = null;
let observeCalls = 0;
let disconnectCalls = 0;
let reducedMotion = false;

class FakeIntersectionObserver {
  constructor(cb: ObserverCallback) {
    capturedCallback = cb;
  }
  observe() {
    observeCalls += 1;
  }
  unobserve() {}
  disconnect() {
    disconnectCalls += 1;
  }
}

beforeEach(() => {
  capturedCallback = null;
  observeCalls = 0;
  disconnectCalls = 0;
  reducedMotion = false;
  // @ts-expect-error — test double, narrower than the real constructor
  global.IntersectionObserver = FakeIntersectionObserver;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce") ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

const { Reveal } = await import("./Reveal");

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Reveal, null, createElement("p", null, "content")));
  });
  return {
    root,
    container,
    el: () => container.querySelector("[data-reveal]") as HTMLElement | null,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("Reveal", () => {
  it("starts idle — the exact state the CSS treats as fully visible, matching a server render", () => {
    const { el, cleanup } = mount();
    expect(el()?.dataset.reveal).toBe("idle");
    cleanup();
  });

  it("only hides once the observer POSITIVELY reports the element is off-screen, then reveals it on entry", () => {
    const { el, cleanup } = mount();
    expect(observeCalls).toBe(1);
    act(() => capturedCallback?.([{ isIntersecting: false }]));
    expect(el()?.dataset.reveal).toBe("pending");
    act(() => capturedCallback?.([{ isIntersecting: true }]));
    expect(el()?.dataset.reveal).toBe("visible");
    expect(disconnectCalls).toBe(1);
    cleanup();
  });

  it("requested: an element already on screen at mount is never hidden at all", () => {
    const { el, cleanup } = mount();
    act(() => capturedCallback?.([{ isIntersecting: true }]));
    expect(el()?.dataset.reveal).toBe("visible");
    cleanup();
  });

  it("prefers-reduced-motion: reduce — the observer is never even created, so state can never leave idle", () => {
    reducedMotion = true;
    const { el, cleanup } = mount();
    expect(observeCalls).toBe(0);
    expect(capturedCallback).toBeNull();
    expect(el()?.dataset.reveal).toBe("idle");
    cleanup();
  });

  it("a stuck observer does not strand the element hidden — the 4s safety timer forces visible", () => {
    vi.useFakeTimers();
    const { el, cleanup } = mount();
    act(() => capturedCallback?.([{ isIntersecting: false }]));
    expect(el()?.dataset.reveal).toBe("pending");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(el()?.dataset.reveal).toBe("visible");
    cleanup();
  });

  it("caught: the safety timer does not fire early, before the observer has had its say", () => {
    vi.useFakeTimers();
    const { el, cleanup } = mount();
    act(() => capturedCallback?.([{ isIntersecting: false }]));
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(el()?.dataset.reveal).toBe("pending");
    cleanup();
  });
});

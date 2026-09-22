// @vitest-environment happy-dom

/**
 * The Ask demo's player, mounted in a DOM and operated.
 *
 * What this can assert: which layer is mounted (still or moving), that the
 * still is what reduced motion gets, that the pause button stops the clock
 * and holds the frame, that scrolling in starts it and scrolling out stops
 * it, and that unmounting leaves no frame request or observer behind.
 *
 * What it cannot: happy-dom does no layout, so nothing here can measure
 * the width at 320px or where the tap ring lands — CLAUDE.md's rule, and
 * the reason those were checked in real Chromium instead (see the PR).
 *
 * The clock is real time on purpose. Faking requestAnimationFrame and
 * performance.now together is fragile, and the assertions here are about
 * whether the frame CHANGES over a few hundred milliseconds, which real
 * time answers plainly.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AskDemo } from "./AskDemo";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type Entry = { isIntersecting: boolean; intersectionRatio: number };
type ObserverCallback = (entries: Entry[]) => void;

let capturedCallback: ObserverCallback | null = null;
let observeCalls = 0;
let disconnectCalls = 0;
let reducedMotion = false;
let rafLive = 0;

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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  capturedCallback = null;
  observeCalls = 0;
  disconnectCalls = 0;
  reducedMotion = false;
  rafLive = 0;
  // @ts-expect-error — test double, narrower than the real constructor
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce") ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // Count outstanding frame requests, so "nothing leaked" is a number.
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    rafLive += 1;
    return realRaf((now) => {
      rafLive -= 1;
      cb(now);
    });
  };
  window.cancelAnimationFrame = (id) => {
    rafLive -= 1;
    realCancel(id);
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount() {
  act(() => {
    root.render(createElement(AskDemo));
  });
}

const stage = () => container.querySelector("[data-ask-demo='stage']") as HTMLElement;
const pause = () => container.querySelector("[data-ask-demo='pause']") as HTMLButtonElement | null;
const reading = () => ({
  t: stage().getAttribute("data-ask-demo-t"),
  step: stage().getAttribute("data-ask-demo-step"),
  playing: stage().getAttribute("data-ask-demo-playing"),
});

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function scrollIn() {
  act(() => capturedCallback?.([{ isIntersecting: true, intersectionRatio: 1 }]));
}
function scrollOut() {
  act(() => capturedCallback?.([{ isIntersecting: false, intersectionRatio: 0 }]));
}

describe("AskDemo", () => {
  it("mounts the moving layer after hydration when motion is allowed, paused until it is seen", () => {
    mount();
    expect(stage().getAttribute("data-ask-demo-mode")).toBe("motion");
    expect(observeCalls).toBe(1);
    expect(reading().playing).toBe("false");
    expect(pause()).not.toBeNull();
    expect(pause()!.getAttribute("aria-label")).toBe("Play the example");
  });

  it("under prefers-reduced-motion it renders the still frame and no clock, no observer, no pause button", async () => {
    reducedMotion = true;
    mount();
    expect(stage().getAttribute("data-ask-demo-mode")).toBe("static");
    expect(observeCalls).toBe(0);
    expect(pause()).toBeNull();
    // The still is the settled hours card.
    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("Logged 8 hours for Luis Ortega");
    await wait(120);
    expect(rafLive).toBe(0);
    // The screen-reader sentence is there in both modes.
    expect(container.querySelector(".sr-only")?.textContent).toContain("An example of Ask C Stream");
  });

  it("plays when scrolled into view and stops when scrolled out", async () => {
    mount();
    scrollIn();
    expect(reading().playing).toBe("true");
    await wait(250);
    const moving = reading();
    expect(Number(moving.t)).toBeGreaterThan(0);

    scrollOut();
    expect(reading().playing).toBe("false");
    const held = reading();
    await wait(250);
    expect(reading().t).toBe(held.t);
    expect(reading().step).toBe(held.step);
    expect(rafLive).toBe(0);
  });

  it("the pause button stops the clock and holds the frame; play resumes from there", async () => {
    mount();
    scrollIn();
    await wait(250);
    expect(pause()!.getAttribute("aria-label")).toBe("Pause the example");

    act(() => pause()!.click());
    expect(reading().playing).toBe("false");
    expect(pause()!.getAttribute("aria-label")).toBe("Play the example");
    expect(pause()!.getAttribute("aria-pressed")).toBe("true");
    const held = reading();
    await wait(400);
    // Nothing moved: no frame request is alive, and the stage is exactly
    // where it was. If the loop kept running, the typing would have
    // advanced and these attributes with it.
    expect(rafLive).toBe(0);
    expect(reading().t).toBe(held.t);
    expect(reading().step).toBe(held.step);

    // A person's pause sticks across scrolling.
    scrollOut();
    scrollIn();
    expect(reading().playing).toBe("false");
    expect(reading().t).toBe(held.t);

    act(() => pause()!.click());
    expect(reading().playing).toBe("true");
    await wait(250);
    const resumed = Number(reading().t);
    expect(resumed).toBeGreaterThan(Number(held.t));
    // Resumed from the held instant, not from where the wall clock would be.
    expect(resumed - Number(held.t)).toBeLessThan(600);
  });

  it("unmounting cancels the frame request and disconnects the observer", async () => {
    mount();
    scrollIn();
    await wait(100);
    expect(rafLive).toBeGreaterThanOrEqual(1);
    act(() => root.unmount());
    expect(disconnectCalls).toBe(1);
    expect(rafLive).toBe(0);
    // afterEach unmounts again; React tolerates it, but re-create so it
    // has something to unmount.
    root = createRoot(container);
  });
});

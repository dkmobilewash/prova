// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/cash-flow" }));

const { HashLanding } = await import("./HashLanding");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const scrolled = vi.fn();

beforeEach(() => {
  scrolled.mockReset();
  (HTMLElement.prototype as { scrollIntoView: unknown }).scrollIntoView = function (this: HTMLElement) {
    scrolled(this.id);
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.getElementById("retainage")?.remove();
  window.history.replaceState(null, "", "/");
});

async function sectionArrives() {
  const section = document.createElement("section");
  section.id = "retainage";
  document.body.appendChild(section);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The real failure: the page under the hash arrives AFTER the navigation
// commits (loading.tsx's skeleton first), so the section is not there yet
// when Next looks for it.
it("scrolls to the anchored section when it arrives after the navigation", async () => {
  window.history.replaceState(null, "", "/cash-flow#retainage");
  act(() => root.render(createElement(HashLanding)));
  expect(scrolled).not.toHaveBeenCalled();
  await sectionArrives();
  expect(scrolled).toHaveBeenCalledWith("retainage");
});

it("does nothing without a hash", async () => {
  window.history.replaceState(null, "", "/cash-flow");
  act(() => root.render(createElement(HashLanding)));
  await sectionArrives();
  expect(scrolled).not.toHaveBeenCalled();
});

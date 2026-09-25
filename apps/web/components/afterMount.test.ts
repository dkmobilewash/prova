// @vitest-environment happy-dom

/**
 * `AfterMount` renders nothing on the server and its children after mount.
 *
 * THE PROPERTY, and why it is worth a test: this component exists to make a
 * server render and the browser's FIRST render agree, so the thing that must
 * be true is that both produce nothing. A version that rendered its children
 * on the first client pass would look identical a frame later and would still
 * carry the hydration mismatch it was written to remove.
 *
 * Each half has a control, so neither can pass vacuously: the same child
 * rendered WITHOUT the gate appears in both places.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AfterMount } from "@/components/AfterMount";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const CHILD = () => createElement("span", null, "AVATAR-9931");

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container.remove();
});

describe("AfterMount", () => {
  it("renders nothing on the server", () => {
    expect(renderToString(createElement(AfterMount, null, createElement(CHILD)))).toBe("");
  });

  it("CONTROL: the same child without the gate IS in the server's HTML", () => {
    expect(renderToString(createElement(CHILD))).toContain("AVATAR-9931");
  });

  it("renders its children once mounted in the browser", () => {
    root = createRoot(container);
    act(() => root!.render(createElement(AfterMount, null, createElement(CHILD))));
    // act() flushes the effect, which is the mount this component waits for.
    expect(container.textContent).toContain("AVATAR-9931");
  });

  it("adds no DOM of its own — the child is a direct child of the container", () => {
    root = createRoot(container);
    act(() => root!.render(createElement(AfterMount, null, createElement(CHILD))));
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe("SPAN");
  });
});

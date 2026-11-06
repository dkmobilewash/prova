// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SetWallHeight } from "./SetWallHeight";

// With no legend read, Set height offered only the ceiling and said nothing (Chrome, Baker on :3010).
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));
const missing = { text: "No height from the drawings: the wall legend has not been read yet.", href: "/jobs/j1/takeoff", action: "Read the wall legend" };
const ceiling = { kind: "ceiling" as const, feet: 10, from: "ceiling of 101" };
const legend = { kind: "legend" as const, feet: 15, from: "legend S1: TO DECK" };
const paint = (options: (typeof ceiling | typeof legend)[]) =>
  act(() => root.render(createElement(SetWallHeight, { name: "S1 walls", options, missing, onSet: async () => null })));

describe("Set height when the legend has not been read", () => {
  it("says why beside the ceiling, with the way to read it", () => {
    paint([ceiling]);
    const note = host.querySelector("[data-takeoff=set-height-missing]")!;
    expect(note.textContent).toContain("legend has not been read yet");
    expect(note.querySelector("a")!.getAttribute("href")).toBe("/jobs/j1/takeoff");
  });

  it("says nothing once the legend offers a height", () => {
    paint([ceiling, legend]);
    expect(host.querySelector("[data-takeoff=set-height-missing]")).toBeNull();
  });
});

// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpeningPick } from "@/lib/takeoff/openingPicks";
import { ProposedOpenings } from "./ProposedOpenings";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const picks: OpeningPick[] = [
  { kind: "door", leaves: 1, width: "3.00", height: "", keep: true },
  { kind: "window", leaves: 1, width: "4.00", height: "", keep: true },
];

function Harness({ carried, onPicks }: { carried: boolean; onPicks?: (p: OpeningPick[]) => void }) {
  const [state, setState] = useState(picks);
  return createElement(ProposedOpenings, {
    sentence: "1 door and 1 window drawn in these walls",
    picks: state,
    onChange: (next: OpeningPick[]) => {
      setState(next);
      onPicks?.(next);
    },
    carried,
  });
}

describe("ProposedOpenings", () => {
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
  });

  it("starts as one line — what was drawn, and a way to add it — with no inputs", () => {
    const html = renderToStaticMarkup(createElement(Harness, { carried: true }));
    expect(html).toContain("1 door and 1 window drawn in these walls");
    expect(html).toContain("add them");
    expect(html).not.toContain("<input");
  });

  it("opens to a row per opening, width filled and height BLANK, and says none will be added yet", () => {
    act(() => root.render(createElement(Harness, { carried: true })));
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    const inputs = [...container.querySelectorAll("input:not([type=checkbox])")] as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["3.00", "", "4.00", ""]);
    expect(container.textContent).toContain("None will be added yet — no height typed.");
  });

  it("counts a row as going on once its height is typed", () => {
    let latest: OpeningPick[] = [];
    act(() => root.render(createElement(Harness, { carried: true, onPicks: (p) => (latest = p) })));
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    const height = container.querySelectorAll("input:not([type=checkbox])")[1] as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(height, "7");
      height.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latest[0].height).toBe("7");
    expect(container.textContent).toContain("1 will be added with this group. 1 still need a height and will be left off.");
  });

  it("on an unpriced group, says there is nothing to carry them and takes no input", () => {
    act(() => root.render(createElement(Harness, { carried: false })));
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(container.textContent).toContain("no wall run to carry openings yet");
    const inputs = [...container.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.disabled)).toBe(true);
    expect(container.textContent).not.toContain("will be added");
  });

  it("never uses a number input — a value the browser dislikes would submit blank", () => {
    act(() => root.render(createElement(Harness, { carried: true })));
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(container.querySelector('input[type="number"]')).toBeNull();
    for (const input of container.querySelectorAll("input:not([type=checkbox])")) {
      expect(input.getAttribute("inputmode")).toBe("decimal");
    }
  });
});

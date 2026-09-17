// @vitest-environment happy-dom

/**
 * Mounts <ScopeSectionList> and reads the headings back out of the DOM.
 *
 * THIS TEST EXISTS BECAUSE THE GC'S COPY WAS UNGUARDED AND NOBODY COULD
 * TELL. The portal hand-rolled its own markup for the scope notes, so the
 * only checks on it were source-text greps — `toContain("scopeSections(…)")`
 * answers "is the splitter called", not "does the GC's copy keep the kinds
 * apart". A review proved the gap by deleting the portal's
 * `{section.heading}`, and then by flattening every kind into one
 * undifferentiated bulleted list: **all 3,215 tests stayed green both
 * times**, on the one copy a general contractor actually reads.
 *
 * The portal now renders this component, and this is what reads it back.
 *
 * Why it matters more here than on the sub's own page: an exclusion —
 * "temporary dance floor to be provided by others" — is what stops a GC
 * later arguing the item was inside the price. Folded into the scope of
 * work on their copy, the sub has lost the argument.
 *
 * What this CANNOT see: layout. happy-dom does no layout, so "the
 * exclusions look like their own block" is not checkable. What IS checkable
 * is that every sentence sits under its own kind's heading and no ancestor
 * chain files one kind under another — and structure is what survives a
 * restyle anyway.
 *
 * createElement rather than JSX only because the suite's `include` matches
 * .test.ts and not .test.tsx.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ScopeSectionList } from "./ScopeSectionList";

const SECTIONS = [
  {
    kind: "INCLUSION",
    heading: "What the price covers",
    notes: [{ id: "n1", text: "Furnish and install 3/4 inch FRT plywood at catwalk" }],
  },
  {
    kind: "EXCLUSION",
    heading: "What it does not cover",
    notes: [
      { id: "n2", text: "Temporary dance floor to be provided by others" },
      { id: "n3", text: "Hecklift provided by others" },
    ],
  },
  {
    kind: "ASSUMPTION",
    heading: "What it was figured on",
    notes: [{ id: "n4", text: "Steel angle figured at continuous perimeter" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(sections: unknown) {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    root.render(createElement(ScopeSectionList as any, { sections }));
  });
}

describe("the GC's copy of a change order's scope", () => {
  it("renders a heading for every kind it was given", () => {
    mount(SECTIONS);
    const headings = [...container.querySelectorAll("[data-scope-heading]")].map((e) => e.textContent);
    expect(headings).toEqual([
      "What the price covers",
      "What it does not cover",
      "What it was figured on",
    ]);
  });

  it("KEEPS AN EXCLUSION OUT OF THE SCOPE OF WORK — the whole point", () => {
    mount(SECTIONS);
    const exclusion = [...container.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("dance floor"),
    );
    expect(exclusion, "the exclusion should be rendered at all").toBeTruthy();
    // Its own kind, not merely "some list item somewhere".
    expect(exclusion?.getAttribute("data-scope-kind")).toBe("EXCLUSION");

    // And nothing of another kind shares its list. This is the assertion
    // that fails when someone flattens the sections into one <ul>.
    const siblings = [...(exclusion?.closest("ul")?.querySelectorAll("li") ?? [])];
    expect(siblings.length).toBe(2);
    for (const li of siblings) expect(li.getAttribute("data-scope-kind")).toBe("EXCLUSION");
  });

  it("puts every note in its own kind's list, with none lost", () => {
    mount(SECTIONS);
    const items = [...container.querySelectorAll("li")];
    // Assert the SIZE before the contents: a selector that matched nothing
    // would satisfy a per-item loop and prove nothing at all.
    expect(items.length).toBe(4);
    const byKind = items.reduce<Record<string, number>>((acc, li) => {
      const k = li.getAttribute("data-scope-kind") ?? "none";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    expect(byKind).toEqual({ INCLUSION: 1, EXCLUSION: 2, ASSUMPTION: 1 });
  });

  it("renders nothing at all when a change order has no scope notes", () => {
    // Not an empty heading, not a stray rule — a change order without scope
    // notes should read exactly as it did before this feature existed.
    mount([]);
    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("li").length).toBe(0);
  });
});

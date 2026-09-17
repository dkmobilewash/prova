// @vitest-environment happy-dom

/**
 * Mounts <ChangeOrderScope> and asks the DOM where each sentence ended up.
 *
 * `lib/change-order-scope.test.ts` proves the SPLIT is right. That is not
 * the same claim as "an exclusion is rendered distinctly from the scope of
 * work": a component handed correctly split sections can still print them
 * as one run of text under one heading, and every pure test would stay
 * green. This repo's own history is a queue of checks that were green about
 * a question nobody asked, so this one renders the thing and reads it back.
 *
 * What it CANNOT see: layout. happy-dom does no layout, so "the exclusions
 * look like their own block" is not checkable here — what IS checkable is
 * that each sentence lives inside an element carrying its own kind and its
 * own heading, and that no ancestor chain puts an exclusion under the
 * inclusion heading. Structure is what survives a restyle anyway.
 *
 * Written with createElement rather than JSX only because the suite's
 * `include` matches .test.ts and not .test.tsx.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The component imports the server-action barrel for its three writes.
// Mocked so this test mounts React and nothing else — the barrel pulls in
// every action module and, through them, the Prisma client.
vi.mock("@/lib/actions", () => ({
  addChangeOrderScopeNote: vi.fn(),
  removeChangeOrderScopeNote: vi.fn(),
  updateChangeOrderScopeNote: vi.fn(),
}));

import { ChangeOrderScope, type LaborBreakoutView } from "@/components/ChangeOrderScope";
import { SCOPE_NOTE_HEADING, scopeSections, type ScopeNote } from "@/lib/change-order-scope";

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
});

const WORK = "Furnish and install 3/4 inch FRT APA plywood at catwalk";
const DANCE_FLOOR = "Temporary dance floor to be provided BY OTHERS";
const HECKLIFT = "Hecklift provided BY OTHERS, to be used for stocking materials";
const ASSUMPTION = "Top of dance floor to be no more than three feet below catwalk";
const BASIS = "Steel angle figured at continuous perimeter";

const NOTES: ScopeNote[] = [
  { id: "n1", kind: "INCLUSION", text: WORK, sortOrder: 0 },
  { id: "n2", kind: "EXCLUSION", text: DANCE_FLOOR, sortOrder: 0 },
  { id: "n3", kind: "EXCLUSION", text: HECKLIFT, sortOrder: 1 },
  { id: "n4", kind: "ASSUMPTION", text: ASSUMPTION, sortOrder: 0 },
  { id: "n5", kind: "PRICING_BASIS", text: BASIS, sortOrder: 0 },
];

const BREAKOUT: LaborBreakoutView = {
  laborBase: "$4,000.00",
  foremanLines: [
    { id: "p3", description: "Foreman", percent: "10", amount: "$400.00", figuredAt: "$400.00" },
  ],
  foreman: "$400.00",
  labor: "$4,400.00",
  material: "$3,072.00",
  subcontractor: "$0.00",
  other: "$0.00",
  uncategorized: "$0.00",
  adjustments: "$0.00",
  total: "$7,472.00",
  foremanOutOfStep: [],
};

function render(notes: ScopeNote[] = NOTES, editable = true) {
  const sections = scopeSections(notes).map((section) => ({
    kind: section.kind,
    heading: section.heading,
    hint: section.hint,
    notes: section.notes.map((note) => ({ id: note.id, kind: note.kind, text: note.text })),
  }));

  act(() => {
    root.render(
      createElement(ChangeOrderScope, {
        changeOrderId: "co1",
        sections,
        breakout: BREAKOUT,
        editable,
        missingDefence: false,
      }),
    );
  });
}

/** The section element a given sentence was rendered inside, by its kind. */
function sectionKindOf(text: string): string | null {
  const node = [...container.querySelectorAll("li")].find((li) => li.textContent?.includes(text));
  return node?.closest("[data-scope-section]")?.getAttribute("data-scope-section") ?? null;
}

describe("<ChangeOrderScope>", () => {
  it("renders every exclusion inside the exclusion section and nowhere else", () => {
    render();

    expect(sectionKindOf(DANCE_FLOOR)).toBe("EXCLUSION");
    expect(sectionKindOf(HECKLIFT)).toBe("EXCLUSION");
    expect(sectionKindOf(WORK)).toBe("INCLUSION");
    expect(sectionKindOf(ASSUMPTION)).toBe("ASSUMPTION");
    expect(sectionKindOf(BASIS)).toBe("PRICING_BASIS");

    // Once each, not once per section — a component that printed all five
    // notes in all four sections would satisfy every lookup above.
    const body = container.textContent ?? "";
    expect(body.split(DANCE_FLOOR).length - 1).toBe(1);
    expect(body.split(WORK).length - 1).toBe(1);
  });

  it("never lets an exclusion share a section with the scope of work", () => {
    render();

    const inclusionSection = container.querySelector('[data-scope-section="INCLUSION"]');
    expect(inclusionSection?.textContent).toContain(WORK);
    expect(inclusionSection?.textContent).not.toContain(DANCE_FLOOR);
    expect(inclusionSection?.textContent).not.toContain(HECKLIFT);
  });

  it("gives the exclusions their own heading, saying they are not included", () => {
    render();

    const exclusionSection = container.querySelector('[data-scope-section="EXCLUSION"]');
    const heading = exclusionSection?.querySelector("h4")?.textContent ?? "";

    expect(heading).toBe(SCOPE_NOTE_HEADING.EXCLUSION);
    expect(heading).toMatch(/not included/i);
    // The heading and the sentence are separate elements, not one paragraph.
    expect(exclusionSection?.querySelectorAll("li")).toHaveLength(2);
  });

  it("shows the foreman as a percentage of the labour, with both numbers", () => {
    render();

    const text = container.textContent ?? "";
    expect(text).toContain("Foreman @ 10%");
    expect(text).toContain("10% of $4,000.00 is $400.00");
    expect(text).toContain("Labour subtotal");
    expect(text).toContain("$4,400.00");
  });

  it("hides every editing control once the change order has been sent", () => {
    render(NOTES, false);

    expect(container.textContent).toContain(DANCE_FLOOR);
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
      "Add a scope note",
    );
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Remove");
  });

  it("says what belongs here when a change order has no scope notes at all", () => {
    render([]);
    expect(container.textContent).toMatch(/No scope notes yet/);
  });
});

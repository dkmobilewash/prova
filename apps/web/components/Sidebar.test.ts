// @vitest-environment happy-dom

/**
 * Mounts the Money Rail into a real DOM and clicks its group headings.
 *
 * The regression this file exists for: the rail was rewritten to carry the
 * five money figures on its group headings and lost the collapse behaviour in
 * the process, so every item of every group rendered at once, the column
 * scrolled, and the LAST figure — "Getting paid" — sat below the fold on a
 * laptop. The product is the figures; a rail that scrolls them away is
 * broken in the one way that matters.
 *
 * So the assertions here are about SHAPE, not styling:
 *
 *   - every heading and every figure renders whatever is open or closed;
 *   - a heading toggles its own group and NOTHING ELSE (the founder approved
 *     `open[key] = !open[key]` semantics off a prototype — an accordion is a
 *     different product decision wearing the same chevron, and the
 *     independence test below is the thing that notices if one arrives);
 *   - the group holding the current page starts open, the rest closed;
 *   - a closed group's links are not in the document at all, so they cannot
 *     be tabbed to.
 *
 * What this environment CANNOT see is layout: happy-dom does no layout, so
 * heights and "above the fold" are not checkable here and are not pretended
 * at — CLAUDE.md's rule about vacuous tests. The structural guarantee behind
 * the fold claim (headings `shrink-0`, item lists the only shrinkable part)
 * is in Sidebar.tsx and was clicked in a browser.
 *
 * Written with createElement rather than JSX only because the suite's
 * `include` matches .test.ts and not .test.tsx.
 */

import { createElement, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyRailStage } from "@/lib/moneyRail";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

// next/link needs the app-router context a real render provides. Nothing
// here navigates; an anchor with the same href is all these assertions read.
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children?: ReactNode;
    } & Record<string, unknown>) => h("a", { href, ...rest }, children),
  };
});

const { Sidebar, navGroupPanelId, STAGE_KEY_FOR_HEADING } = await import("@/components/Sidebar");
const { navGroupsFor } = await import("@/components/navItems");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** An OWNER sees every group, which is the state the demo is filmed in. */
const principal = { role: "OWNER", jobFunction: null };

/** Figures chosen so each one is a string that appears nowhere else in the
 * rail — an assertion that could match a label instead of a figure would be
 * the vacuous-watcher failure from CLAUDE.md. */
const stages: MoneyRailStage[] = [
  {
    key: "bidding",
    label: "Bidding",
    figure: { kind: "money", amount: 111_111 },
    detail: "bidding detail",
  },
  {
    key: "building",
    label: "Building",
    figure: { kind: "money", amount: 222_222 },
    detail: "building detail",
  },
  {
    key: "proving",
    label: "Proving",
    figure: { kind: "count", n: 33, noun: "waiting on the GC" },
    detail: "proving detail",
  },
  {
    key: "staying-legal",
    label: "Staying legal",
    figure: { kind: "count", n: 44, noun: "documents at risk" },
    detail: "staying legal detail",
  },
  {
    key: "getting-paid",
    label: "Getting paid",
    figure: { kind: "money", amount: 555_555 },
    detail: "getting paid detail",
  },
];

/** The five figures as they are rendered. `$111,111` etc. for money; a count
 * is the bare number, so it is paired with its noun to stay distinctive. */
const FIGURE_TEXTS = ["$111,111.00", "$222,222.00", "33", "44", "$555,555.00"];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  nav.pathname = "/dashboard";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function renderRail() {
  act(() => {
    root.render(
      createElement(Sidebar, { companyName: "Acme Drywall", principal, stages }),
    );
  });
}

/** Every heading button, by the heading text it draws. */
function headingButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"));
}

function headingButton(heading: string): HTMLButtonElement {
  const found = headingButtons().find((b) => (b.textContent ?? "").includes(heading));
  if (!found) {
    throw new Error(
      `no heading button for "${heading}" — found: ${headingButtons()
        .map((b) => (b.textContent ?? "").trim())
        .join(" | ")}`,
    );
  }
  return found;
}

function isExpanded(heading: string): boolean {
  return headingButton(heading).getAttribute("aria-expanded") === "true";
}

function clickHeading(heading: string) {
  const button = headingButton(heading);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Every link a user could tab to, by href. */
function linkHrefs(): string[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) =>
    a.getAttribute("href") ?? "",
  );
}

const HEADINGS = navGroupsFor(principal).map((group) => group.heading);

describe("the Money Rail's groups collapse", () => {
  it("renders a toggle for every group, and nothing but groups is a toggle", () => {
    renderRail();
    // Six on an OWNER's rail since #240: Pre-construction, Operations,
    // Paper trail, Logistics, Financials, Compliance & safety. Read from
    // navGroupsFor rather than written down, which is why #240 adding a
    // sixth group did not leave this asserting about five.
    expect(HEADINGS.length).toBeGreaterThan(1);
    expect(headingButtons()).toHaveLength(HEADINGS.length);
    for (const heading of HEADINGS) {
      expect(headingButton(heading).getAttribute("aria-controls")).toBe(
        navGroupPanelId(heading),
      );
      expect(container.querySelector(`#${navGroupPanelId(heading)}`)).not.toBeNull();
    }
  });

  it("opens the group holding the current page, and only that one", () => {
    nav.pathname = "/cash-flow"; // Financials
    renderRail();

    expect(isExpanded("Financials")).toBe(true);
    for (const heading of HEADINGS.filter((h) => h !== "Financials")) {
      expect(isExpanded(heading)).toBe(false);
    }
    // And its items are the ones on screen.
    expect(linkHrefs()).toContain("/cash-flow");
    expect(linkHrefs()).not.toContain("/bids");
  });

  it("starts everything closed on a page that is in no group", () => {
    nav.pathname = "/jobs/abc123";
    renderRail();

    for (const heading of HEADINGS) expect(isExpanded(heading)).toBe(false);
    expect(linkHrefs()).toEqual([]);
  });

  it("keeps a closed group's links OUT of the document, not merely invisible", () => {
    nav.pathname = "/jobs/abc123";
    renderRail();

    // Nothing tabbable inside any panel, and the panel element still exists
    // so the heading's aria-controls points at something real.
    for (const heading of HEADINGS) {
      const panel = container.querySelector(`#${navGroupPanelId(heading)}`)!;
      expect(panel.querySelectorAll("a, button").length).toBe(0);
      expect(panel.hasAttribute("hidden")).toBe(true);
      expect(panel.className).toBe("hidden");
    }
  });

  it("TOGGLES ARE INDEPENDENT — opening one does not close another", () => {
    nav.pathname = "/cash-flow"; // Financials starts open
    renderRail();
    expect(isExpanded("Financials")).toBe(true);

    clickHeading("Pre-construction");
    expect(isExpanded("Pre-construction")).toBe(true);
    expect(isExpanded("Financials")).toBe(true); // NOT an accordion

    clickHeading("Operations");
    expect(isExpanded("Operations")).toBe(true);
    expect(isExpanded("Pre-construction")).toBe(true);
    expect(isExpanded("Financials")).toBe(true);

    // Three groups' worth of links, all reachable at once.
    const hrefs = linkHrefs();
    expect(hrefs).toContain("/bids"); // Pre-construction
    expect(hrefs).toContain("/schedule"); // Operations
    expect(hrefs).toContain("/cash-flow"); // Financials
  });

  it("closes only the group whose heading is clicked twice", () => {
    nav.pathname = "/cash-flow";
    renderRail();
    clickHeading("Pre-construction");
    expect(linkHrefs()).toContain("/bids");

    clickHeading("Pre-construction");
    expect(isExpanded("Pre-construction")).toBe(false);
    expect(linkHrefs()).not.toContain("/bids");
    // The one that was already open is untouched.
    expect(isExpanded("Financials")).toBe(true);
    expect(linkHrefs()).toContain("/cash-flow");
  });
});

describe("the five figures are never what collapses", () => {
  it("draws every heading and every figure with every group closed", () => {
    nav.pathname = "/jobs/abc123"; // nothing starts open
    renderRail();

    const text = container.textContent ?? "";
    for (const heading of HEADINGS) expect(text).toContain(heading);
    // "Proving" is a linkless heading beside Operations rather than a
    // group's figure, and the collapse must not take it with Operations'
    // items. #240 gave its routes a group ("Paper trail" holds /rfis and
    // /submittals), so this is now a deliberate arrangement rather than the
    // only one available — see the note in Sidebar.tsx.
    expect(text).toContain("Proving");
    for (const figure of FIGURE_TEXTS) expect(text).toContain(figure);
  });

  it("still draws all five after every group has been opened and closed again", () => {
    renderRail();
    for (const heading of HEADINGS) clickHeading(heading);
    for (const heading of HEADINGS) clickHeading(heading);

    const text = container.textContent ?? "";
    for (const figure of FIGURE_TEXTS) expect(text).toContain(figure);
    for (const heading of HEADINGS) expect(text).toContain(heading);
  });

  it("puts the figure inside its heading button, so the money is part of the target", () => {
    renderRail();
    expect(headingButton("Financials").textContent).toContain("$555,555.00");
    expect(headingButton("Pre-construction").textContent).toContain("$111,111.00");
    // Logistics carries no stage and must not have borrowed one.
    for (const figure of FIGURE_TEXTS) {
      expect(headingButton("Logistics").textContent ?? "").not.toContain(figure);
    }
  });

  it("uses no <p> inside the heading button — a button is phrasing content", () => {
    // The `<li>`-inside-`<li>` hydration scar (#149) in a different costume:
    // invalid nesting renders fine in a server string and then the browser's
    // parser builds a tree React did not render.
    renderRail();
    for (const heading of HEADINGS) {
      expect(headingButton(heading).querySelectorAll("p").length).toBe(0);
    }
  });
});

/* This file used to carry its own `activeGroupHeading` cases, because the
 * rail used to carry its own copy of the function. It now uses the one in
 * navItems.tsx, whose longest-href match is strictly better — /vendors/pricing
 * lands in Logistics and /settings/assistant in Financials, which the old
 * first-prefix-wins version got wrong — and which navItems.test.ts pins,
 * including those two cases and the null for a route in no group. The
 * behaviour those deleted cases asserted is still asserted; it is asserted
 * once, next to the function. */

describe("the stage map cannot silently miss", () => {
  const headings = navGroupsFor(principal).map((group) => group.heading);

  it("keys the stage map on headings that actually exist", () => {
    // The one thing this merge made newly breakable: the four keys are
    // heading TEXT from navItems.tsx, so a rename there matches nothing here
    // and drops four figures with every other test still passing. An empty
    // question, not a wrong answer — CLAUDE.md's parser rule, in a Record.
    expect(Object.keys(STAGE_KEY_FOR_HEADING).length).toBe(4);
    for (const heading of Object.keys(STAGE_KEY_FOR_HEADING)) {
      expect(headings, `"${heading}" is not a nav group heading`).toContain(heading);
    }
  });

  it("places all five stages — four on headings, Proving beside Operations", () => {
    const placed = new Set(Object.values(STAGE_KEY_FOR_HEADING));
    expect(placed.size).toBe(4);
    // Proving is the fifth and is drawn by the component, not the map.
    renderRail();
    for (const figure of FIGURE_TEXTS) expect(container.textContent ?? "").toContain(figure);
    expect(placed.has("proving")).toBe(false);
  });

});

describe("navGroupPanelId", () => {
  it("makes an id that is legal in an attribute", () => {
    expect(navGroupPanelId("Compliance & safety")).toBe("nav-group-compliance-safety");
    expect(navGroupPanelId("Pre-construction")).toBe("nav-group-pre-construction");
    // #240's sixth group, whose two words must not collide into one.
    expect(navGroupPanelId("Paper trail")).toBe("nav-group-paper-trail");
  });
});

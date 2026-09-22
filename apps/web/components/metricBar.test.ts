// @vitest-environment happy-dom

/**
 * The bar along the bottom of every screen, and the 52px it used to take
 * from a brand-new account to say nothing.
 *
 * WHY THIS RENDERS RATHER THAN CALLING `hasNothingToSay` AGAIN. That
 * function has its own cases in `lib/company-financials.test.ts` and they
 * prove the arithmetic. They prove nothing about the bar: deleting the one
 * line in `MetricBar.tsx` that consults it leaves every one of them green
 * while the row of zeros comes straight back. "Written, documented, and
 * never called" is the shape CLAUDE.md names, and a predicate nothing
 * consults is the cheapest way to reproduce it. So the component is
 * mounted, and what is asserted is what a reader would see.
 *
 * createElement rather than JSX for the reason bidWizardSteps.test.ts
 * gives: the suite's `include` matches `.test.ts`, not `.test.tsx`.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompanyFinancials } from "@/lib/company-financials";

const { MetricBar } = await import("@/components/MetricBar");

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

const nothing: CompanyFinancials = {
  estimatedRevenue: 0,
  grossProfit: 0,
  earnedCoverage: 0,
  grossMarginRate: null,
  cashPosition: 0,
  outstandingReceivable: 0,
  retainageHeld: 0,
};

describe("the account that signed up this morning", () => {
  it("renders no bar at all — not a bar of zeros", () => {
    render(createElement(MetricBar, { financials: nothing }));

    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("*").length).toBe(0);
    // Named, because "renders nothing" and "renders nothing VISIBLE" are
    // different claims and only the first gives the 52px back.
    expect(container.innerHTML).not.toContain("$0.00");
  });
});

describe("the account with a book", () => {
  const some: CompanyFinancials = { ...nothing, estimatedRevenue: 250_000 };

  it("comes back the instant one figure is a number", () => {
    render(createElement(MetricBar, { financials: some }));

    // Anti-vacuity, and the counterpart to the case above: without this,
    // the test would pass just as happily on a component that renders
    // nothing ever.
    expect(container.textContent).toContain("Estimated revenue");
    expect(container.textContent).toContain("$250,000.00");
    // All four figures, not only the one with a value in it. Hiding the
    // zeros individually would cost the same pixels and say less.
    expect(container.textContent).toContain("Cash collected");
    expect(container.textContent).toContain("Retainage held");
    expect(container.textContent).toContain("Gross margin");
  });

  it("shows for a LOSS, where nothing is sold and money has gone out", () => {
    // The case the predicate turns on: "nothing sold yet" and "this is
    // going badly" must not look alike, and the bar exists for the second.
    render(createElement(MetricBar, { financials: { ...nothing, grossProfit: -12_000 } }));
    expect(container.textContent).toContain("Gross margin");
  });

  it("keeps its labels off the shade that could not be read", () => {
    render(createElement(MetricBar, { financials: some }));
    const html = container.innerHTML;
    // 3.66:1 on this ground, at 10px. `lib/theme-contrast.test.ts` bans the
    // shade across the whole app; this pins the one element the scar was
    // actually found on, so the fix cannot be undone here quietly.
    expect(html).not.toContain("text-slate-500");
    expect(html).toContain("text-ink-muted");
  });
});

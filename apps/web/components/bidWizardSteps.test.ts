// @vitest-environment happy-dom

/**
 * What the stepper header actually renders and links to, at each of the
 * TWO steps — the "visible progress and clear back/next" the founder asked
 * for, and the guarantee that step 2 is UNREACHABLE before a job exists to
 * key its URL on (see BidWizardSteps's own comment for why that is
 * load-bearing rather than incidental).
 *
 * TWO, NOT THREE, SINCE 2026-09-21. The third step — "Review" — collected
 * nothing and echoed back what the reader had just typed; the cases below
 * are what stops it growing back by accident, and they assert its absence
 * rather than merely not mentioning it. Same for the "Skip ahead — open
 * this bid in full" link, which on the last step pointed where the primary
 * button points.
 *
 * Written with createElement rather than JSX for the same reason
 * logTimeEntryForm.test.ts is: the suite's `include` matches `.test.ts`,
 * not `.test.tsx`.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { BidWizardSteps } = await import("@/components/BidWizardSteps");

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

function links() {
  return [...container.querySelectorAll("a")];
}

describe("step 1, before a job exists", () => {
  it("renders step 2 as plain text, not a link", () => {
    render(createElement(BidWizardSteps, { current: 1 }));

    const hrefs = links().map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/jobs/new");
    // Note: step 1 is the CURRENT step, and BidWizardSteps deliberately
    // does not link the current step to itself (no point navigating to
    // where you already are) — so the only assertion this file can make
    // about step 1's own link is that it's absent. What matters here is
    // step 2.
    expect(container.textContent).toContain("Add work");
    for (const a of links()) {
      expect(a.getAttribute("href")).not.toMatch(/\/jobs\/new\/.+\/items/);
    }
    // No "skip ahead to the full job" escape hatch either — there is no
    // job yet for it to point at.
    expect(container.textContent).not.toContain("open this bid in full");
  });
});

describe("step 2, once a job exists", () => {
  it("links back to step 1, and marks step 1 done", () => {
    render(createElement(BidWizardSteps, { current: 2, jobId: "job-1" }));

    const hrefs = links().map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/jobs/new");
    // The current step (2) is not a link to itself, same reasoning as step 1.
    expect(hrefs).not.toContain("/jobs/new/job-1/items");
    // One checkmark — step 1, done — not zero and not two.
    expect(container.textContent?.match(/✓/g)?.length).toBe(1);
  });

  it("no longer offers a second control to the same place as the page's own button", () => {
    render(createElement(BidWizardSteps, { current: 2, jobId: "job-1" }));

    // The step-2 page's primary button already goes to /jobs/job-1 and says
    // so ("Done — open the job"). The stepper's "Skip ahead" link went to
    // the identical URL from four lines above it, which on the LAST step is
    // two controls for one destination, one of them implying the wizard is
    // something to escape from.
    expect(container.textContent).not.toContain("open this bid in full");
    expect(links().map((a) => a.getAttribute("href"))).not.toContain("/jobs/job-1");
  });
});

describe("the Review step, which is gone", () => {
  // Asserted rather than merely unmentioned. A step that collected nothing
  // is the kind of thing that grows back because somebody remembers a
  // three-chip screenshot, and these two lines are what makes that a build
  // failure instead of a shipped click.
  it("is named nowhere and linked nowhere, at either step", () => {
    for (const current of [1, 2] as const) {
      render(createElement(BidWizardSteps, { current, jobId: "job-9" }));
      expect(container.textContent).not.toContain("Review");
      for (const a of links()) {
        expect(a.getAttribute("href")).not.toMatch(/\/review$/);
      }
    }
  });

  it("leaves exactly two steps, numbered 1 and 2", () => {
    render(createElement(BidWizardSteps, { current: 1 }));
    // Anti-vacuity and a size assertion in one: the chips are <li>s, and a
    // render that produced none would pass every `not.toContain` above.
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.textContent).toContain("Job & GC");
    expect(container.textContent).toContain("Add work");
    expect(container.textContent).not.toContain("3");
  });
});

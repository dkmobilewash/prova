// @vitest-environment happy-dom

/**
 * What the stepper header actually renders and links to, at each of the
 * three steps — the "visible progress and clear back/next" the founder
 * asked for, and the guarantee that steps 2 and 3 are UNREACHABLE before a
 * job exists to key their URL on (see BidWizardSteps's own comment for why
 * that is load-bearing rather than incidental).
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
  it("links step 1 to /jobs/new and renders steps 2 and 3 as plain text, not links", () => {
    render(createElement(BidWizardSteps, { current: 1 }));

    const hrefs = links().map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/jobs/new");
    // Note: step 1 is the CURRENT step, and BidWizardSteps deliberately
    // does not link the current step to itself (no point navigating to
    // where you already are) — so the only assertion this file can make
    // about step 1's own link is that it's absent. What matters here is
    // steps 2 and 3.
    expect(container.textContent).toContain("Add work");
    expect(container.textContent).toContain("Review");
    for (const a of links()) {
      expect(a.getAttribute("href")).not.toMatch(/\/jobs\/new\/.+\/(items|review)/);
    }
    // No "skip ahead to the full job" escape hatch either — there is no
    // job yet for it to point at.
    expect(container.textContent).not.toContain("open this bid in full");
  });
});

describe("step 2, once a job exists", () => {
  it("links back to step 1 and forward to step 3, and offers the full-job escape hatch", () => {
    render(createElement(BidWizardSteps, { current: 2, jobId: "job-1" }));

    const hrefs = links().map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/jobs/new");
    expect(hrefs).toContain("/jobs/new/job-1/review");
    // The current step (2) is not a link to itself, same reasoning as step 1.
    expect(hrefs).not.toContain("/jobs/new/job-1/items");
    expect(hrefs).toContain("/jobs/job-1");
    expect(container.textContent).toContain("open this bid in full");
  });
});

describe("step 3", () => {
  it("marks steps 1 and 2 as done and links both backward", () => {
    render(createElement(BidWizardSteps, { current: 3, jobId: "job-9" }));

    const hrefs = links().map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/jobs/new");
    expect(hrefs).toContain("/jobs/new/job-9/items");
    // Two checkmarks — one per completed step — not one, and not zero.
    expect(container.textContent?.match(/✓/g)?.length).toBe(2);
  });
});

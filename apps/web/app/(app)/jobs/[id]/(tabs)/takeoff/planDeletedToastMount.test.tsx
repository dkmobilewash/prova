// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

/**
 * ── THE UNDO TOAST MUST OUTLIVE THE JOB'S LAST PLAN ──
 *
 * Found by #1268's own production proof (2026-11-26, ZZ job): deleting the job's ONLY plan refreshed the page into its
 * `loaded === null` branch ("No drawing on this job yet"), which did not render `<PlanDeletedToast />`. The toast
 * unmounted with its Undo, so the one way back did not exist on the commonest job there is. The component tests mounted
 * the toast on its own and could not see it.
 *
 * Two halves, because a census can prove the code is THERE and never that React keeps it:
 *   1. the page renders the toast as the FIRST child of its <section> in EVERY return, the one position both share;
 *   2. the real toast, at that position, keeps its message and Undo when the siblings after it change wholesale.
 */
vi.mock("@/lib/actions", () => ({ undoTakeoffPlanDelete: async () => ({ ok: true, value: { label: "A-201" } }) }));
const { PlanDeletedToast } = await import("@/components/DeletePlanButton");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source = readFileSync(join(process.cwd(), "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  // What a JSX comment leaves once stripped: `{}` is not a child.
  .replace(/\{\s*\}/g, "");

describe("the page mounts the toast where both branches share it", () => {
  const sections = [...source.matchAll(/return \(\s*<section[^>]*>\s*([^\n]*)/g)];
  it("finds both returns: the no-plan one and the plan one", () => {
    expect(sections).toHaveLength(2);
  });
  it("renders <PlanDeletedToast /> as the first child of each, and nowhere else", () => {
    for (const s of sections) expect(s[1]!.trim()).toBe("<PlanDeletedToast />");
    expect(source.match(/<PlanDeletedToast \/>/g)).toHaveLength(2);
  });
});

describe("React keeps the toast across the switch to the no-plan page", () => {
  it("still shows the message and Undo after the siblings after it change", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const withPlan = createElement("section", null, createElement(PlanDeletedToast), createElement("header"), createElement("div", null, "viewer"), createElement("div", null, "sheets"));
    const noPlan = createElement("section", null, createElement(PlanDeletedToast), createElement("header"), createElement(Fragment, null, createElement("h3", null, "No drawing on this job yet")));
    act(() => root.render(withPlan));
    act(() => {
      window.dispatchEvent(new CustomEvent("prova:plan-deleted", { detail: { text: "A-201 deleted.", jobId: "j", planId: "p", undoUntil: new Date(Date.now() + 600_000).toISOString() } }));
    });
    expect(host.querySelector('[data-takeoff="plan-delete-undo"]')).not.toBeNull();
    act(() => root.render(noPlan));
    expect(host.textContent).toContain("No drawing on this job yet");
    expect(host.querySelector('[data-takeoff="plan-deleted-toast"]')?.textContent).toContain("A-201 deleted.");
    expect(host.querySelector('[data-takeoff="plan-delete-undo"]')).not.toBeNull();
    act(() => root.unmount());
  });
});

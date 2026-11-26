// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDeleteImpact } from "@/lib/takeoff/planDelete";

/** Diego, 2026-11-26 (coordination/plan-delete-undo.md U7): after a delete the toast offers Undo for the 10 minutes. */
const impact: PlanDeleteImpact = {
  label: "A-201",
  estimateUpdates: true,
  wallFeet: 70,
  counts: 3,
  linesRetired: 4,
  linesChanged: [],
  handPriced: [],
  totalBefore: 1000,
  totalAfter: 600,
  signingLink: null,
  undoUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
};
const undone: string[][] = [];
vi.mock("@/lib/actions", () => ({
  previewDeleteTakeoffPlan: async () => ({ ok: true, value: impact }),
  deleteTakeoffPlan: async () => ({ ok: true, value: impact }),
  undoTakeoffPlanDelete: async (jobId: string, planId: string) => (undone.push([jobId, planId]), { ok: true, value: { label: "A-201" } }),
}));
const { DeletePlanButton, PlanDeletedToast } = await import("./DeletePlanButton");
const { planDeleteWords } = await import("@/lib/takeoff/planDeleteWords");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  undone.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

describe("U7: the delete can be undone from its toast", () => {
  it("the dialog says the delete can be undone for 10 minutes", () => {
    expect(planDeleteWords(impact, true).body.join(" ")).toContain("You can undo this for 10 minutes.");
  });
  it("after the delete the toast offers Undo; Undo brings the plan back and says so", async () => {
    act(() => root.render(createElement("div", null, createElement(DeletePlanButton, { jobId: "j", planId: "p" }), createElement(PlanDeletedToast))));
    await act(async () => button("Delete plan")!.click());
    await settle();
    await act(async () => button("Delete plan and update estimate")!.click());
    await settle();
    const toast = host.querySelector('[data-takeoff="plan-deleted-toast"]');
    expect(toast?.textContent).toContain("A-201 deleted.");
    await act(async () => button("Undo")!.click());
    await settle();
    expect(undone).toEqual([["j", "p"]]);
    expect(host.querySelector('[data-takeoff="plan-deleted-toast"]')?.textContent).toContain("A-201 is back.");
    expect(button("Undo")).toBeUndefined();
  });
});

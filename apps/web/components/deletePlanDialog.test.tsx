// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDeleteImpact } from "@/lib/takeoff/planDelete";
import { planDeletedToast, planDeleteWords } from "@/lib/takeoff/planDeleteWords";

/**
 * ── THE PLAN-DELETE CONFIRMATION, RENDERED (coordination/plan-delete-sync.md, the dialog) ──
 * The numbers are the server's (planDelete.dbtest.ts proves them); this proves a person SEES them, can keep or drop
 * the lines they priced, has one primary button and Cancel, and gets a toast from what the delete actually did.
 */
const impact: PlanDeleteImpact = {
  label: "A-201",
  estimateUpdates: true,
  wallFeet: 1240,
  counts: 18,
  linesRetired: 6,
  linesChanged: [{ description: "W1 walls — runner track", from: "50", to: "20" }],
  handPriced: [{ description: "Walls — untyped", quantity: "40", unitPrice: "9", total: 360 }],
  totalBefore: 20000,
  totalAfter: 5620,
  signingLink: { status: "PENDING", sentOn: "2026-11-20" },
  undoUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
};
const calls: { preview: number; remove: { keepHandPriced?: boolean }[] } = { preview: 0, remove: [] };
vi.mock("@/lib/actions", () => ({
  previewDeleteTakeoffPlan: async () => ((calls.preview += 1), { ok: true, value: impact }),
  deleteTakeoffPlan: async (_j: string, _p: string, options: { keepHandPriced?: boolean }) => (calls.remove.push(options), { ok: true, value: { ...impact, totalAfter: options.keepHandPriced === false ? 5260 : 5620 } }),
}));
const { DeletePlanButton, PlanDeletedToast } = await import("./DeletePlanButton");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  calls.preview = 0;
  calls.remove = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // happy-dom's <dialog>: showModal opens it, close closes it and fires "close", as a browser does.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

describe("the plan-delete confirmation", () => {
  it("asks the server first, then shows the delete's own numbers in plain words, one primary button and Cancel", async () => {
    act(() => root.render(createElement("div", null, createElement(DeletePlanButton, { jobId: "j", planId: "p" }), createElement(PlanDeletedToast))));
    // Nothing is asked, and no dialog shows, until the person presses Delete plan.
    expect(calls.preview).toBe(0);
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    await act(async () => button("Delete plan")!.click());
    await settle();
    expect(calls.preview).toBe(1);
    const dialog = host.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    // Named for a screen reader by its own title.
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Delete A-201?");
    const text = dialog.textContent!;
    expect(text).toContain("This removes 1,240 ft of walls, 18 counted doors and windows and 6 estimate lines ($14,380.00) from this job.");
    expect(text).toContain("W1 walls — runner track goes from 50 to 20.");
    expect(text).toContain("A signing link sent to the GC on 2026-11-20 shows this estimate as it is now. After this it shows $5,620.00 instead of $20,000.00.");
    const buttons = [...dialog.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(["Cancel", "Delete plan and update estimate"]);
  });

  it("the hand-priced lines are kept by default; unticking adds them to what goes, and the delete is told so", async () => {
    act(() => root.render(createElement("div", null, createElement(DeletePlanButton, { jobId: "j", planId: "p" }), createElement(PlanDeletedToast))));
    await act(async () => button("Delete plan")!.click());
    await settle();
    const box = host.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    expect(box.closest("label")?.textContent).toBe("Keep the line you priced by hand ($360.00) as a typed line");
    await act(async () => box.click());
    expect(host.querySelector("dialog")!.textContent).toContain("7 estimate lines ($14,740.00)");
    await act(async () => button("Delete plan and update estimate")!.click());
    await settle();
    expect(calls.remove).toEqual([{ keepHandPriced: false }]);
    // The toast is the DELETE's figures, raised on the page.
    // Its words; the Undo beside them is planDeleteUndo.test.tsx's (Diego, 2026-11-26).
    expect(host.querySelector('[data-takeoff="plan-deleted-toast"] > span')?.textContent).toBe("A-201 deleted. Estimate updated: −$14,740.00.");
  });

  it("Cancel deletes nothing", async () => {
    act(() => root.render(createElement(DeletePlanButton, { jobId: "j", planId: "p" })));
    await act(async () => button("Delete plan")!.click());
    await settle();
    await act(async () => button("Cancel")!.click());
    expect(calls.remove).toEqual([]);
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });
});

describe("the words", () => {
  it("on a job past the estimate: the drawing goes and the estimate is the contract", () => {
    const words = planDeleteWords({ ...impact, estimateUpdates: false, handPriced: [], signingLink: null }, true);
    expect(words.body).toEqual([
      "This removes the drawing and the 1,240 ft of walls and 18 counted doors and windows traced on it.",
      "This job is past the estimate, so its estimate is the contract and does not change here. Change it with a change order.",
      "You can undo this for 10 minutes.",
    ]);
    expect(words.primary).toBe("Delete plan");
    expect(planDeletedToast({ ...impact, estimateUpdates: false })).toBe("A-201 deleted.");
  });

  it("a plan nothing on the estimate came from says so, and the toast says nothing changed", () => {
    const none = { ...impact, linesRetired: 0, linesChanged: [], handPriced: [], totalAfter: impact.totalBefore, signingLink: null };
    expect(planDeleteWords(none, true).body).toEqual(["This removes 1,240 ft of walls and 18 counted doors and windows from this job.", "You can undo this for 10 minutes."]);
    expect(planDeletedToast(none)).toBe("A-201 deleted. The estimate did not change.");
  });
});

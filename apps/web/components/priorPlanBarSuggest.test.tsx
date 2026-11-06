// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "COMPARE WITH A001?" HAS TO BE ON THE SCREEN, AND APPLY ONLY ON A PRESS.
 *
 * A sheet the titles paired with nothing asks the server which demolition plan
 * lines up with it (`suggestPriorPlanChoice`, the layout check is server-side:
 * `bakerDemoSuggest.dbtest.ts` holds it on the real drawing). The bar shows the
 * offer, saves nothing by itself, and a real click saves A001 as the person's
 * own choice. A paired sheet, and a read-only viewer, are never asked.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const savePriorPlanChoice = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const suggestPriorPlanChoice = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, value: { demoPage: 11, sheet: "A001", votes: 10 } as { demoPage: number; sheet: string; votes: number } | null }));
vi.mock("@/lib/actions", () => ({ savePriorPlanChoice, suggestPriorPlanChoice }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { PriorPlanBar } = await import("./PriorPlanBar");

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  savePriorPlanChoice.mockClear();
  suggestPriorPlanChoice.mockClear();
});
afterEach(() => host.remove());

const sheets = [
  { pageNumber: 11, sheetNumber: "A001", title: "DEMOLITION PLAN" },
  { pageNumber: 13, sheetNumber: "A101", title: "FLOOR PLAN" },
];
const unpaired = { page: 13, pairing: null, sheet: null, n: 0, feet: 0, why: null };

async function render(props: Partial<Parameters<typeof PriorPlanBar>[0]> = {}) {
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(PriorPlanBar, { status: unpaired, sheets, pageNumber: 13, jobId: "job_1", planId: "plan_1", readOnly: false, ...props }));
  });
  await act(async () => {});
  return root;
}

describe("the demolition plan the drawing lines up with is offered on an unpaired sheet", () => {
  it("offers A001, saves nothing until pressed, and a press saves it as the person's choice", async () => {
    await render();
    expect(suggestPriorPlanChoice).toHaveBeenCalledWith({ jobId: "job_1", planId: "plan_1", pageNumber: 13 });
    const offer = host.querySelector('[data-takeoff="prior-plan-suggest"]');
    expect(offer?.textContent).toContain("Compare with A001?");
    expect(savePriorPlanChoice).not.toHaveBeenCalled();
    const accept = host.querySelector<HTMLButtonElement>('[data-takeoff="prior-plan-accept"]')!;
    await act(async () => accept.click());
    expect(savePriorPlanChoice).toHaveBeenCalledWith({ jobId: "job_1", planId: "plan_1", pageNumber: 13, choice: 11 });
    expect(host.querySelector('[data-takeoff="prior-plan-suggest"]')).toBeNull();
  });

  it("shows nothing when the server finds no drawing that lines up", async () => {
    suggestPriorPlanChoice.mockResolvedValueOnce({ ok: true, value: null });
    await render();
    expect(host.querySelector('[data-takeoff="prior-plan-suggest"]')).toBeNull();
    expect(host.querySelector('[data-takeoff="prior-plan-none"]')).not.toBeNull();
  });

  it("never asks for a paired sheet or a read-only viewer", async () => {
    await render({ status: { ...unpaired, pairing: { demoPage: 11, source: "user", basis: "chosen" }, sheet: "A001" } });
    await render({ readOnly: true });
    expect(suggestPriorPlanChoice).not.toHaveBeenCalled();
  });
});

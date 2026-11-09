// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestView } from "@/lib/plan-ingest/runner";

// Walk, 2026-11-08 (Green Bay, AI off): the panel offered "Read the title blocks —
// uses 76 sheets" to a company whose plan reading is off; every sheet would refuse.
vi.mock("@/lib/plan-ingest/advanceOverHttp", () => ({ advanceOverHttp: vi.fn() }));
vi.mock("@/lib/actions", () => ({
  startPlanIngest: async () => ({ ok: false, error: "not in this test" }),
  advancePlanIngest: vi.fn(),
  retryPlanIngestPage: async () => ({ ok: true }),
  planIngestFailures: async () => ({ ok: true, value: [] }),
  queuedPlanReads: async () => ({ ok: true, value: [] }),
}));
const { PlanIngestPanel } = await import("./PlanIngestPanel");

const inventoryDone: IngestView = { jobId: "inv_1", stage: "PAGE_INVENTORY", total: 76, finished: 76, exhausted: 0, pending: 0, inFlight: 0, percent: 100, complete: true, waiting: false } as IngestView;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const paint = (reading?: { on: boolean; why: string | null }) =>
  act(() => root.render(createElement(PlanIngestPanel, { legend: { on: false, reviewHref: "#", typeCount: 0 }, planId: "plan_1", existing: inventoryDone, scheduleSheetCount: 0, ...(reading ? { reading } : {}) } as never)));

describe("the title-block offer when plan reading is off", () => {
  it("says plan reading is off and offers no read; with it on, offers the read as before", () => {
    paint({ on: false, why: "AI is switched off for your company." });
    expect(host.querySelector('[data-plan-ingest="reading-off"]')?.textContent).toMatch(/Plan reading is off/);
    expect(host.textContent).not.toMatch(/Read the title blocks/);
    paint({ on: true, why: null });
    expect(host.querySelector('[data-plan-ingest="reading-off"]')).toBeNull();
    expect(host.textContent).toMatch(/Read the title blocks — uses 76 sheets/);
  });
});

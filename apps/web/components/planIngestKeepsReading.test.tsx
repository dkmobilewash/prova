// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IngestView } from "@/lib/plan-ingest/runner";

/**
 * THE TITLE-BLOCK READ DOES NOT PAUSE ITSELF WITH SOMEBODY ON THE PAGE.
 *
 * New-customer run v2, M6: on Baker the title blocks needed "Keep reading" on
 * every run. The slice loop asked "did that slice move?" against the panel's
 * `view` from the closure that started it — the finished 65-page inventory —
 * so every title-block slice (0, 1, 2… of 65) read as standing still, and three
 * of those stop the loop. Here the read is started from the panel after an
 * inventory and every slice settles one more page: it must run to the end.
 */
const startPlanIngest = vi.fn();
const advancePlanIngest = vi.fn();
vi.mock("@/lib/actions", () => ({
  startPlanIngest: (...a: unknown[]) => startPlanIngest(...a),
  advancePlanIngest: (...a: unknown[]) => advancePlanIngest(...a),
  retryPlanIngestPage: async () => ({ ok: true }),
  planIngestFailures: async () => ({ ok: true, value: [] }),
  queuedPlanReads: async () => ({ ok: true, value: [] }),
}));
const { PlanIngestPanel } = await import("./PlanIngestPanel");

const view = (over: Partial<IngestView>): IngestView => ({ jobId: "inv", stage: "PAGE_INVENTORY", total: 6, finished: 6, exhausted: 0, pending: 0, inFlight: 0, percent: 100, complete: true, waiting: false, ...over });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("reads every title block without stopping, after a finished inventory", async () => {
  startPlanIngest.mockResolvedValue({ ok: true, value: view({ jobId: "tb", stage: "TITLE_BLOCK", finished: 0, percent: 0, complete: false, pending: 6 }) });
  let finished = 0;
  advancePlanIngest.mockImplementation(async () => {
    finished += 1;
    return { ok: true, value: view({ jobId: "tb", stage: "TITLE_BLOCK", finished, pending: 6 - finished, percent: Math.round((finished / 6) * 100), complete: finished === 6 }) };
  });
  act(() => {
    root.render(createElement(PlanIngestPanel, { legend: { on: false, reviewHref: "#", typeCount: 0 }, planId: "plan_1", existing: view({}), scheduleSheetCount: 0 } as never));
  });
  const button = [...host.querySelectorAll("button")].find((b) => /Read the title blocks/.test(b.textContent ?? ""));
  expect(button, "the title-block button").toBeDefined();
  await act(async () => {
    button!.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(advancePlanIngest).toHaveBeenCalledTimes(6);
  expect(host.textContent ?? "").not.toContain("Keep reading");
});

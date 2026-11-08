// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestView } from "@/lib/plan-ingest/runner";
import { PLAN_READING_UNAVAILABLE } from "@/lib/ai/providerOutage";

// 2026-11-07: the account ran out of Anthropic credit; the panel said each sheet
// "couldn't be identified just now" and the walk pressed Keep reading 107 times.
const advancePlanIngest = vi.fn();
vi.mock("@/lib/plan-ingest/advanceOverHttp", () => ({ advanceOverHttp: (...a: unknown[]) => advancePlanIngest(...a) }));
vi.mock("@/lib/actions", () => ({
  startPlanIngest: async () => ({ ok: false, error: "not in this test" }),
  advancePlanIngest: (...a: unknown[]) => advancePlanIngest(...a),
  retryPlanIngestPage: async () => ({ ok: true }),
  planIngestFailures: async () => ({ ok: true, value: [] }),
  queuedPlanReads: async () => ({ ok: true, value: [] }),
}));
const { PlanIngestPanel } = await import("./PlanIngestPanel");

const view = (over: Partial<IngestView> = {}): IngestView => ({
  jobId: "titles_1",
  stage: "TITLE_BLOCK",
  total: 65,
  finished: 0,
  exhausted: 0,
  pending: 65,
  inFlight: 0,
  percent: 0,
  complete: false,
  waiting: true,
  outage: true,
  ...over,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
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
function paint(existing: IngestView) {
  act(() => {
    root.render(createElement(PlanIngestPanel, { legend: { on: false, reviewHref: "#", typeCount: 0 }, planId: "plan_1", fileName: "set.pdf", existing, scheduleSheetCount: 0 } as never));
  });
}
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => {});
};

describe("plan reading while the provider refuses reads", () => {
  it("SAYS SO ONCE, offers no Keep reading, and picks the reading up by itself until the provider answers", async () => {
    advancePlanIngest.mockResolvedValue({ ok: true, value: view() });
    paint(view());
    const banner = host.querySelector("[data-plan-ingest=outage]");
    expect(banner?.textContent).toBe(PLAN_READING_UNAVAILABLE);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Keep reading")).toBe(false);
    expect(advancePlanIngest).not.toHaveBeenCalled();
    // 15 s later it looks again on its own …
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(advancePlanIngest).toHaveBeenCalled();
    // … and keeps looking while the outage lasts (idle slices, then every 15 s).
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      await flush();
    }
    const before = advancePlanIngest.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(advancePlanIngest.mock.calls.length).toBeGreaterThan(before);
    // The provider answers: the pages read, and the banner goes.
    advancePlanIngest.mockResolvedValue({ ok: true, value: view({ finished: 65, pending: 0, percent: 100, complete: true, waiting: false, outage: false }) });
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(host.querySelector("[data-plan-ingest=outage]")).toBeNull();
  });

  it("without an outage, a paused reading still waits for Keep reading, as before", async () => {
    paint(view({ outage: false, waiting: false }));
    expect(host.querySelector("[data-plan-ingest=outage]")).toBeNull();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Keep reading")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(advancePlanIngest).not.toHaveBeenCalled();
  });
});

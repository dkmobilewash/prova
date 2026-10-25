// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestView } from "@/lib/plan-ingest/runner";

/**
 * THE IDLE GUARD HAS TO FIRE ON A FRESH START, NOT ONLY ON A RESUMED ONE.
 *
 * ── THE BUG THIS PINS ──
 *
 * `pump` decided whether a slice moved by comparing against the `view` STATE
 * from the closure it was created in, and its `setTimeout` recursion re-calls
 * that same closure. On a fresh start (the auto-start, or any of the four start
 * buttons) that `view` was `null`, so `!view` made every slice count as
 * "moved" and `MAX_IDLE_SLICES` could never be reached. A run whose remaining
 * pages were all waiting out their backoff therefore asked `advancePlanIngest`
 * every 400ms for as long as the tab stayed open, which is the "infinite loop
 * of free work" the panel's own comment says the guard exists to stop.
 *
 * "Keep reading" on a paused run looked fine, because that closure's `view` is
 * non-null. That is why the only path anybody had checked was the one that
 * worked.
 *
 * ── THE CONTROL ──
 *
 * The second case drives the same no-progress server from "Keep reading", the
 * path that always worked, and the third proves a run that DOES progress is not
 * stopped by the guard. Without that third case, a guard that always stopped
 * after three slices would pass the first two.
 */

const startPlanIngest = vi.fn();
const advancePlanIngest = vi.fn();
const planIngestFailures = vi.fn(async () => ({ ok: true, value: [] }));

vi.mock("@/lib/actions", () => ({
  startPlanIngest: (...a: unknown[]) => startPlanIngest(...a),
  advancePlanIngest: (...a: unknown[]) => advancePlanIngest(...a),
  retryPlanIngestPage: async () => ({ ok: true }),
  planIngestFailures: (...a: unknown[]) => planIngestFailures(...(a as [])),
}));

const { PlanIngestPanel } = await import("./PlanIngestPanel");

/** A run stuck part-way: 10 of 29 settled, the rest backing off. */
const stuck = (over: Partial<IngestView> = {}): IngestView => ({
  jobId: "job_1",
  stage: "PAGE_INVENTORY",
  total: 29,
  finished: 10,
  exhausted: 0,
  pending: 19,
  inFlight: 0,
  percent: 34,
  complete: false,
  waiting: true,
  ...over,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function paint(existing: IngestView | null) {
  act(() => {
    root.render(
      createElement(PlanIngestPanel, {
        legend: { on: false, reviewHref: "#", typeCount: 0 },
        planId: "plan_1",
        existing,
        scheduleSheetCount: 0,
      }),
    );
  });
}

/** Let `ms` of slice gaps elapse, flushing each slice's awaited action. */
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const state = () => host.querySelector('[data-plan-ingest="state"]')?.textContent ?? "";

describe("a run whose remaining pages are all backing off", () => {
  it("STOPS after three idle slices on a FRESH start", async () => {
    startPlanIngest.mockResolvedValue({ ok: true, value: stuck() });
    advancePlanIngest.mockResolvedValue({ ok: true, value: stuck() });

    paint(null); // auto-starts, the path the bug lived on
    await elapse(0);
    expect(startPlanIngest).toHaveBeenCalledTimes(1);

    // Far longer than three 400ms gaps. With the bug, this is ~25 more asks.
    await elapse(10_000);

    expect(advancePlanIngest).toHaveBeenCalledTimes(3);
    // Stopped, and saying why: every page left is inside its backoff window.
    expect(state()).not.toContain("Reading…");
    expect(state()).toContain("Waiting a moment before trying the sheets that failed.");
  });

  it("stops after three idle slices from Keep reading too (the path that always worked)", async () => {
    advancePlanIngest.mockResolvedValue({ ok: true, value: stuck() });

    paint(stuck({ waiting: false }));
    const resume = [...host.querySelectorAll("button")].find((b) => b.textContent === "Keep reading");
    expect(resume).toBeDefined();
    act(() => resume!.click());

    await elapse(10_000);

    expect(advancePlanIngest).toHaveBeenCalledTimes(3);
    // Stopped, and saying why: every page left is inside its backoff window.
    expect(state()).not.toContain("Reading…");
    expect(state()).toContain("Waiting a moment before trying the sheets that failed.");
  });

  it("does NOT stop a fresh run that is making progress", async () => {
    startPlanIngest.mockResolvedValue({ ok: true, value: stuck({ finished: 0 }) });
    let finished = 0;
    advancePlanIngest.mockImplementation(async () => {
      finished += 1;
      return { ok: true, value: stuck({ finished, complete: finished === 29, pending: 29 - finished }) };
    });

    paint(null);
    await elapse(29 * 400 + 1_000);

    expect(advancePlanIngest).toHaveBeenCalledTimes(29);
    expect(state()).toContain("Every sheet read.");
  });
});

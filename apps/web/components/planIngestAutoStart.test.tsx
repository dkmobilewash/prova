// @vitest-environment happy-dom
import { StrictMode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestView } from "@/lib/plan-ingest/runner";

/**
 * THE FREE READ STARTS ITSELF.
 *
 * ── THE GAP THIS CLOSES ──
 *
 * Uploading a plan set did NOTHING. `startPlanIngest` had two callers and both
 * were buttons, so a set sat unread until somebody pressed "Read the sheets" —
 * and everything downstream waits on that pass: the sheet numbers, the titles,
 * which sheets are worth a takeoff at all, and the per-page scale readings that
 * prefill a calibration.
 *
 * ── THE TWO CASES THAT MATTER ARE THE ONES IT MUST **NOT** DO ──
 *
 * Starting on a fresh set is the easy half. The half worth testing is that it
 * cannot fire on a set somebody has already read, cannot resume a paused run
 * behind their back, and cannot fire twice — React runs effects twice in
 * development, and a second `startPlanIngest` is a second job over the same
 * pages, which is the duplicate the schema's own partial index exists to stop.
 *
 * ── THE PAID STAGE IS NOT TOUCHED, AND THAT IS PINNED HERE ──
 *
 * `PAGE_INVENTORY` calls no model, so starting it spends nothing. Reading the
 * title blocks claims a plan sheet per page, and `PlanIngestPanel`'s own
 * comment records Diego's call: *"A SEPARATE BUTTON RATHER THAN A CHAIN…
 * Chaining would make one click spend that, with the figure only visible
 * afterwards."* A case below fails if this ever starts the paid one.
 */

const startPlanIngest = vi.fn();
const advancePlanIngest = vi.fn();
const planIngestFailures = vi.fn(async () => ({ ok: true, value: [] }));
const queuedPlanReads = vi.fn(async () => ({ ok: true, value: [] as IngestView[] }));

vi.mock("@/lib/actions", () => ({
  startPlanIngest: (...a: unknown[]) => startPlanIngest(...a),
  advancePlanIngest: (...a: unknown[]) => advancePlanIngest(...a),
  retryPlanIngestPage: async () => ({ ok: true }),
  planIngestFailures: (...a: unknown[]) => planIngestFailures(...(a as [])),
  queuedPlanReads: (...a: unknown[]) => queuedPlanReads(...(a as [])),
}));

const { PlanIngestPanel } = await import("./PlanIngestPanel");

const view = (over: Partial<IngestView> = {}): IngestView => ({
  jobId: "job_1",
  stage: "PAGE_INVENTORY",
  total: 29,
  finished: 29,
  exhausted: 0,
  pending: 0,
  inFlight: 0,
  percent: 100,
  complete: true,
  waiting: false,
  ...over,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  startPlanIngest.mockResolvedValue({ ok: true, value: view({ finished: 0, percent: 0, complete: false }) });
  advancePlanIngest.mockResolvedValue({ ok: true, value: view() });
  queuedPlanReads.mockResolvedValue({ ok: true, value: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A fresh mount every time, for `planIngestReread.test.tsx`'s reason: the panel
 *  seeds its run from `useState(existing)`, whose initialiser runs once, so
 *  re-rendering one instance with new props reads the FIRST call's screen. */
function paint(existing: IngestView | null) {
  act(() => root.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(PlanIngestPanel, {
        legend: { on: false, reviewHref: "#", typeCount: 0 },
        planId: "plan_1",
        fileName: "set.pdf",
        existing,
        scheduleSheetCount: 0,
      } as never),
    );
  });
  return host.textContent ?? "";
}

describe("a set nobody has touched", () => {
  it("STARTS READING ON ITS OWN", async () => {
    paint(null);
    await act(async () => {});
    expect(startPlanIngest).toHaveBeenCalledTimes(1);
  });

  it("starts the FREE stage and never the paid one", async () => {
    // Reading the title blocks claims a plan sheet per page. Diego's call is
    // that it stays a press which names its price first; this would be the
    // change that quietly overturned it.
    paint(null);
    await act(async () => {});
    expect(startPlanIngest).toHaveBeenCalledWith("plan_1", "PAGE_INVENTORY");
  });

  it("still offers the button, for the case where starting FAILED", async () => {
    // `startPlanIngest` refuses a set over 2,000 pages, a file it cannot read,
    // and a caller without the capability. Each leaves the panel with no run
    // and a sentence — and no way to try again would be a dead end.
    startPlanIngest.mockResolvedValue({ ok: false, error: "That plan set is too big to read." });
    paint(null);
    // READ AFTER THE AWAIT, not before it. The first draft captured the text at
    // render time, which is the screen before the refusal has come back — it
    // passed for the wrong reason on a run that had not failed yet.
    await act(async () => {});
    expect(host.textContent ?? "").toContain("Read the sheets");
    expect(host.textContent ?? "").toContain("too big to read");
  });
});

describe("a set that has already been read", () => {
  it("DOES NOT START ANYTHING on a finished run", async () => {
    paint(view());
    await act(async () => {});
    expect(startPlanIngest).not.toHaveBeenCalled();
  });

  it("GOES ON WITH EVERY READING STILL QUEUED, OLDEST FIRST — never starting a new one", async () => {
    // Diego, 2026-11-06, reversing "resume only on a press": the wall legend
    // queued behind the free pass waited for the daily cron, so a new customer
    // had no suggested types until the next day. Every queued run now advances
    // while the page is open, the oldest first; nothing new is started.
    const legend = view({ jobId: "legend_1", stage: "WALL_LEGEND", finished: 0, percent: 0, complete: false, total: 65 });
    const titles = view({ jobId: "titles_1", stage: "TITLE_BLOCK", finished: 12, percent: 18, complete: false, total: 65 });
    queuedPlanReads.mockResolvedValueOnce({ ok: true, value: [legend, titles] }).mockResolvedValueOnce({ ok: true, value: [titles] }).mockResolvedValue({ ok: true, value: [] });
    advancePlanIngest.mockImplementation(async (jobId: string) => ({ ok: true, value: view({ jobId, stage: jobId === "legend_1" ? "WALL_LEGEND" : "TITLE_BLOCK", complete: true }) }));
    paint(titles);
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    expect(startPlanIngest).not.toHaveBeenCalled();
    expect(advancePlanIngest.mock.calls.map((c) => c[0])).toEqual(["legend_1", "titles_1"]);
    expect(queuedPlanReads).toHaveBeenCalledTimes(3);
  });

  it("STILL OFFERS THE TITLE BLOCKS once the legend queued behind the free pass has run (walk v6)", async () => {
    // The legend run took the view when it ran, and the offer was keyed on the
    // view's stage: a new company with plan reading on never saw the button.
    const legend = view({ jobId: "legend_1", stage: "WALL_LEGEND", finished: 0, percent: 0, complete: false, total: 65 });
    advancePlanIngest.mockImplementation(async (jobId: string) => ({ ok: true, value: view({ jobId, stage: jobId === "legend_1" ? "WALL_LEGEND" : "PAGE_INVENTORY", complete: true }) }));
    queuedPlanReads.mockResolvedValueOnce({ ok: true, value: [legend] }).mockResolvedValue({ ok: true, value: [] });
    paint(null);
    for (let i = 0; i < 6; i += 1) await act(async () => {});
    expect(advancePlanIngest.mock.calls.map((c) => c[0])).toEqual(["job_1", "legend_1"]);
    expect(host.textContent).toContain("Read the title blocks");
  });

  it("OFFERS THE TITLE BLOCKS WHILE THE LEGEND READS, AND PRESSED, THEY TAKE THE LOOP (Topeka: 82 s behind the legend)", async () => {
    vi.useFakeTimers();
    try {
      const legend = view({ jobId: "legend_1", stage: "WALL_LEGEND", finished: 3, percent: 2, complete: false, total: 137 });
      const titles = view({ jobId: "titles_1", stage: "TITLE_BLOCK", finished: 0, percent: 0, complete: false, total: 137 });
      let legendDone = 3;
      advancePlanIngest.mockImplementation(async (jobId: string) =>
        jobId === "titles_1"
          ? { ok: true, value: view({ jobId, stage: "TITLE_BLOCK", total: 137, complete: true }) }
          : { ok: true, value: view({ jobId, stage: "WALL_LEGEND", total: 137, finished: (legendDone += 1), percent: 5, complete: false }) },
      );
      queuedPlanReads.mockResolvedValueOnce({ ok: true, value: [legend] }).mockResolvedValue({ ok: true, value: [legend] });
      startPlanIngest.mockResolvedValue({ ok: true, value: titles });
      paint(view({ total: 137 }));
      for (let i = 0; i < 4; i += 1) await act(async () => {});
      // The legend is reading, and the offer is there anyway.
      expect(advancePlanIngest.mock.calls.map((c) => c[0])).toContain("legend_1");
      const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Read the title blocks"));
      expect(button, "no Read the title blocks while the legend reads").toBeDefined();
      advancePlanIngest.mockClear();
      await act(async () => {
        button!.click();
      });
      for (let i = 0; i < 4; i += 1) await act(async () => {});
      // The title blocks went first; the legend's scheduled slice did not run alongside.
      expect(startPlanIngest).toHaveBeenCalledWith(expect.any(String), "TITLE_BLOCK");
      expect(advancePlanIngest.mock.calls[0]?.[0]).toBe("titles_1");
      // When they finish, the legend picks up again — ONE loop, not two: the
      // legend slice scheduled before the press must not start a second one.
      const legendCalls = () => advancePlanIngest.mock.calls.filter((c) => c[0] === "legend_1").length;
      const resumed = legendCalls();
      for (let gap = 0; gap < 5; gap += 1) {
        await act(async () => {
          vi.advanceTimersByTime(400);
        });
        for (let i = 0; i < 3; i += 1) await act(async () => {});
      }
      expect(advancePlanIngest.mock.calls.filter((c) => c[0] === "titles_1")).toHaveLength(1);
      expect(legendCalls() - resumed).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the title blocks on a reload whose free pass is done and legend still queued", async () => {
    const legend = view({ jobId: "legend_1", stage: "WALL_LEGEND", finished: 0, percent: 0, complete: false, total: 65 });
    advancePlanIngest.mockResolvedValue({ ok: true, value: view({ jobId: "legend_1", stage: "WALL_LEGEND", complete: true }) });
    queuedPlanReads.mockResolvedValueOnce({ ok: true, value: [legend] }).mockResolvedValue({ ok: true, value: [] });
    paint(view());
    for (let i = 0; i < 4; i += 1) await act(async () => {});
    expect(advancePlanIngest.mock.calls.map((c) => c[0])).toEqual(["legend_1"]);
    expect(host.textContent).toContain("Read the title blocks");
  });

  it("names what is queued after the reading on screen", async () => {
    const legend = view({ jobId: "legend_1", stage: "WALL_LEGEND", finished: 0, percent: 0, complete: false, total: 65 });
    const titles = view({ jobId: "titles_1", stage: "TITLE_BLOCK", finished: 12, percent: 18, complete: false, total: 65 });
    queuedPlanReads.mockResolvedValue({ ok: true, value: [legend, titles] });
    advancePlanIngest.mockImplementation(() => new Promise(() => {}));
    paint(titles);
    await act(async () => {});
    expect(host.querySelector('[data-plan-ingest="reading"]')?.textContent).toBe("The wall legend:");
    expect(host.querySelector('[data-plan-ingest="queued"]')?.textContent).toBe("Next: The title blocks (12 of 65)");
  });

  it("does not start on a run that finished with failures", async () => {
    paint(view({ finished: 27, exhausted: 2, complete: true }));
    await act(async () => {});
    expect(startPlanIngest).not.toHaveBeenCalled();
  });

  it("does not start when a LATER stage is the newest run", async () => {
    // `view.stage` is the stage of the latest run. A set whose title blocks
    // have been read must not have its free pass started again underneath it.
    paint(view({ stage: "TITLE_BLOCK" }));
    await act(async () => {});
    expect(startPlanIngest).not.toHaveBeenCalled();
  });
});

describe("it cannot fire twice", () => {
  it("starts once under StrictMode, which double-invokes every effect", async () => {
    // ── THE FIRST VERSION OF THIS TEST WAS VACUOUS ──
    //
    // It mounted normally and awaited twice, which does not re-run an effect
    // whose deps have not changed — so it passed with the once-guard REMOVED,
    // measured by mutation. The guard exists because React double-invokes
    // effects in development, and the only honest way to assert that is to make
    // React actually do it.
    //
    // A second `startPlanIngest` is a second job over the same pages: the
    // duplicate the schema's own partial index exists to stop.
    act(() => root.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(PlanIngestPanel, {
        legend: { on: false, reviewHref: "#", typeCount: 0 },
            planId: "plan_1",
            fileName: "set.pdf",
            existing: null,
            scheduleSheetCount: 0,
          } as never),
        ),
      );
    });
    await act(async () => {});
    expect(startPlanIngest).toHaveBeenCalledTimes(1);
  });
});

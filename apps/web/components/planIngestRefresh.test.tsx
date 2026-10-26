// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestView } from "@/lib/plan-ingest/runner";

/**
 * WHEN THE READ FINISHES, THE PAGE AROUND IT HEARS ABOUT IT — ONCE.
 *
 * The free sheet read writes a scale reading per page, and the viewer's toolbar
 * offers that scale ("Use scale 1/8" = 1'-0"") from its `scalePrefillByPage`
 * prop. The panel takes its own progress from each slice's return value and
 * never revalidated — deliberately, because a re-render on every slice threw
 * the viewer back to sheet 1 (`startPlanIngest`'s own comment). So on a freshly
 * read set the offer appeared only after somebody reloaded the page.
 *
 * The fix is ONE `router.refresh()`, when a run this panel was driving reaches
 * COMPLETE. Not per slice, not on mount, not when a run stops short: those are
 * the re-renders the panel was right to refuse. `router.refresh()` keeps client
 * state — the same call `TakeoffRoomsPanel` makes from inside the viewer, and
 * the same root re-render every calibration save already does — so the sheet
 * somebody is on stays the sheet they are on.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const startPlanIngest = vi.fn();
const advancePlanIngest = vi.fn();
vi.mock("@/lib/actions", () => ({
  startPlanIngest: (...a: unknown[]) => startPlanIngest(...a),
  advancePlanIngest: (...a: unknown[]) => advancePlanIngest(...a),
  retryPlanIngestPage: async () => ({ ok: true }),
  planIngestFailures: async () => ({ ok: true, value: [] }),
}));

const { PlanIngestPanel } = await import("./PlanIngestPanel");

const view = (over: Partial<IngestView> = {}): IngestView => ({
  jobId: "job_1",
  stage: "PAGE_INVENTORY",
  total: 12,
  finished: 12,
  exhausted: 0,
  pending: 0,
  inFlight: 0,
  percent: 100,
  complete: true,
  waiting: false,
  ...over,
});
const partway = (finished: number) => view({ finished, percent: Math.round((finished / 12) * 100), complete: false });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
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

/** Lets the slice loop's 400ms gaps run out. */
const settle = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

describe("the page refreshes when a read it drove finishes", () => {
  it("refreshes once, after the last slice — never while the read is still going", async () => {
    startPlanIngest.mockResolvedValue({ ok: true, value: partway(0) });
    advancePlanIngest
      .mockResolvedValueOnce({ ok: true, value: partway(4) })
      .mockResolvedValueOnce({ ok: true, value: partway(9) })
      .mockResolvedValueOnce({ ok: true, value: view() });
    paint(null);
    await settle(0);
    // Mid-run: slices have come back and nothing refreshed.
    expect(advancePlanIngest).toHaveBeenCalledTimes(1);
    expect(refresh, "refreshed in the middle of a read").not.toHaveBeenCalled();
    await settle(1000);
    expect(advancePlanIngest).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("Every sheet read.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when finishing with some sheets unread, since the read ones have readings", async () => {
    startPlanIngest.mockResolvedValue({ ok: true, value: partway(0) });
    advancePlanIngest.mockResolvedValue({ ok: true, value: view({ finished: 10, exhausted: 2 }) });
    paint(null);
    await settle(50);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on mount over a read that finished before the page loaded", async () => {
    paint(view());
    await settle(50);
    expect(startPlanIngest).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh when the loop stops short of complete", async () => {
    // Three slices that move nothing stop the loop — every page is waiting out
    // its backoff. Nothing new is written, so there is nothing to show.
    //
    // Driven through "Keep reading" on a paused run rather than a fresh start:
    // on a fresh start the loop's idle count compares against the `view` its
    // closure was created with, which is null, so it never counts idle at all.
    // That is a separate defect, reported rather than fixed here.
    advancePlanIngest.mockResolvedValue({ ok: true, value: partway(3) });
    paint(partway(3));
    const resume = [...host.querySelectorAll("button")].find((b) => b.textContent === "Keep reading");
    expect(resume, "no Keep reading button on a paused run").toBeDefined();
    act(() => resume?.click());
    await settle(1500);
    expect(advancePlanIngest.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(host.textContent).toContain("Paused.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh when a slice fails", async () => {
    startPlanIngest.mockResolvedValue({ ok: true, value: partway(0) });
    advancePlanIngest.mockResolvedValue({ ok: false, error: "The plan file could not be opened." });
    paint(null);
    await settle(50);
    expect(host.textContent).toContain("could not be opened");
    expect(refresh).not.toHaveBeenCalled();
  });
});

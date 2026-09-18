import { describe, expect, it } from "vitest";
import {
  FINISHED_KEY,
  markFinished,
  placeCard,
  readFinished,
  shownSteps,
  stepAfter,
  stepBefore,
  stepPosition,
} from "./engine";
import { routeMatches, walkthroughFor, type Walkthrough } from "./index";

const steps = ["a", "b", "c", "d"].map((anchor) => ({ anchor, title: anchor, body: anchor }));
const onScreen = (...ids: string[]) => (anchor: string) => ids.includes(anchor);

describe("skipping what is not on screen", () => {
  it("keeps order and drops hidden steps", () => {
    expect(shownSteps(steps, onScreen("d", "b")).map((s) => s.anchor)).toEqual(["b", "d"]);
  });

  it("Next skips a hidden step, and is null past the last shown one", () => {
    const shown = onScreen("a", "c", "d");
    expect(stepAfter(steps, "a", shown)?.anchor).toBe("c");
    expect(stepAfter(steps, "d", shown)).toBeNull();
  });

  it("Next still moves forward when the current step itself has vanished", () => {
    expect(stepAfter(steps, "b", onScreen("a", "c"))?.anchor).toBe("c");
  });

  it("Back skips hidden steps and is null on the first shown one", () => {
    const shown = onScreen("a", "c", "d");
    expect(stepBefore(steps, "d", shown)?.anchor).toBe("c");
    expect(stepBefore(steps, "c", shown)?.anchor).toBe("a");
    expect(stepBefore(steps, "a", shown)).toBeNull();
    expect(stepBefore(steps, "c", onScreen("c"))).toBeNull();
  });

  it("counts steps over what is on screen", () => {
    expect(stepPosition(steps, "c", onScreen("a", "c", "d"))).toEqual({ index: 2, total: 3 });
  });

  it("a step that vanished under the card still counts itself", () => {
    expect(stepPosition(steps, "b", onScreen("a", "c"))).toEqual({ index: 2, total: 3 });
  });
});

describe("placing the card", () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 350, height: 200 };

  it("goes below when it fits", () => {
    expect(placeCard({ top: 100, left: 300, width: 200, height: 50 }, card, viewport)).toEqual({ top: 162, left: 300 });
  });

  it("goes above when below does not fit", () => {
    expect(placeCard({ top: 600, left: 300, width: 200, height: 100 }, card, viewport)).toEqual({ top: 388, left: 300 });
  });

  it("pins to the bottom of the screen for an element taller than the room", () => {
    expect(placeCard({ top: 50, left: 300, width: 600, height: 700 }, card, viewport)).toEqual({ top: 584, left: 300 });
  });

  it("never leaves the screen when the element is below it, as it is mid-scroll", () => {
    // Seen on /dashboard: the element was 1,370px down a 740px screen while
    // the scroll to it was still running, and "above it" put the card at
    // 1,132px — off the bottom. Above was only checked against the top edge.
    const place = placeCard({ top: 1370, left: 300, width: 400, height: 38 }, card, viewport);
    expect(place.top).toBeGreaterThanOrEqual(16);
    expect(place.top + card.height).toBeLessThanOrEqual(viewport.height - 16);
  });

  it("never leaves the screen when the element is above it", () => {
    const place = placeCard({ top: -900, left: 300, width: 400, height: 38 }, card, viewport);
    expect(place.top).toBeGreaterThanOrEqual(16);
  });

  it("stays inside the screen horizontally", () => {
    expect(placeCard({ top: 100, left: 1100, width: 80, height: 40 }, card, viewport).left).toBe(834);
    expect(placeCard({ top: 100, left: -40, width: 80, height: 40 }, card, viewport).left).toBe(16);
  });
});

describe("remembering finished walkthroughs", () => {
  function memory(initial?: string) {
    const store = new Map<string, string>(initial === undefined ? [] : [[FINISHED_KEY, initial]]);
    return { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  }

  it("records a route once", () => {
    const storage = memory();
    markFinished(storage, "/schedule");
    markFinished(storage, "/schedule");
    markFinished(storage, "/jobs/[id]");
    expect(readFinished(storage)).toEqual(["/schedule", "/jobs/[id]"]);
  });

  it("reads garbage, a non-list, or no storage at all as nothing finished", () => {
    expect(readFinished(memory("{not json"))).toEqual([]);
    expect(readFinished(memory('{"a":1}'))).toEqual([]);
    expect(readFinished(null)).toEqual([]);
  });

  it("never throws when storage does", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFinished(hostile)).toEqual([]);
    expect(() => markFinished(hostile, "/schedule")).not.toThrow();
  });
});

describe("matching a page to its walkthrough", () => {
  it("matches static and dynamic segments exactly, never by prefix", () => {
    expect(routeMatches("/jobs/[id]", "/jobs/abc123")).toBe(true);
    expect(routeMatches("/jobs/[id]", "/jobs/abc123/certified-payroll")).toBe(false);
    expect(routeMatches("/settings", "/settings/import")).toBe(false);
    expect(routeMatches("/dashboard", "/dashboard?status=ESTIMATE")).toBe(true);
  });

  it("prefers a static route over a dynamic one", () => {
    const dynamic: Walkthrough = { route: "/jobs/[id]", title: "job", steps };
    const fixed: Walkthrough = { route: "/jobs/new", title: "new", steps };
    expect(walkthroughFor("/jobs/new", [dynamic, fixed])?.route).toBe("/jobs/new");
    expect(walkthroughFor("/jobs/xyz", [dynamic, fixed])?.route).toBe("/jobs/[id]");
    expect(walkthroughFor("/nowhere", [dynamic, fixed])).toBeNull();
  });

  it("the real registry sends the job pages to the right tours", () => {
    expect(walkthroughFor("/jobs/new")?.route).toBe("/jobs/new");
    expect(walkthroughFor("/jobs/cm123")?.route).toBe("/jobs/[id]");
    expect(walkthroughFor("/settings")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { currentRun, decide, droppedRuns, reviewCounter, reviewOrder, startReview, undoDecision, viewOfRun } from "./wallReview";

describe("the order a reviewer meets the runs", () => {
  it("by doubt alone: most doubted first, then the held ones, and a run with no score after the scored", () => {
    const order = reviewOrder(
      [
        { at: 0, held: false, score: 0.9 },
        { at: 1, held: true, score: 0.1 },
        { at: 2, held: false, score: 0.2 },
        { at: 3, held: false, score: null },
        { at: 4, held: true, score: 0.3 },
      ],
      "doubt",
    );
    expect(order).toEqual([2, 0, 3, 1, 4]);
  });
  it("by default, the most likely junk feet first: a long doubted run before a short more doubted one", () => {
    const order = reviewOrder([
      { at: 0, held: false, score: 0.1, lengthFeet: 4 },
      { at: 1, held: false, score: 0.4, lengthFeet: 60 },
      { at: 2, held: false, score: 0.95, lengthFeet: 80 },
      { at: 3, held: false, score: null, lengthFeet: 10 },
      { at: 4, held: true, score: 0.1, lengthFeet: 100 },
    ]);
    expect(order).toEqual([1, 3, 2, 0, 4]);
  });
});

describe("stepping through", () => {
  it("keep and drop move on, the counter counts, and undo shows the last run again", () => {
    let s = startReview([5, 2, 9]);
    expect(currentRun(s)).toBe(5);
    expect(reviewCounter(s)).toBe("0 of 3 reviewed");
    s = decide(s, "keep");
    s = decide(s, "drop");
    expect(currentRun(s)).toBe(9);
    expect(reviewCounter(s)).toBe("2 of 3 reviewed");
    expect([...droppedRuns(s)]).toEqual([2]);
    const back = undoDecision(s);
    expect(back.undone).toEqual({ at: 2, kind: "drop" });
    expect(currentRun(back.state)).toBe(2);
    expect(droppedRuns(back.state).size).toBe(0);
  });
  it("is done when every run is decided, and deciding then changes nothing", () => {
    let s = decide(startReview([1]), "drop");
    expect(currentRun(s)).toBeNull();
    expect(decide(s, "keep")).toBe(s);
    s = undoDecision(startReview([1])).state;
    expect(undoDecision(startReview([1])).undone).toBeNull();
    expect(currentRun(s)).toBe(1);
  });
});

describe("looking at one run", () => {
  const page = { widthPt: 3000, heightPt: 2000 };
  const frame = { width: 1000, height: 700 };
  it("zooms a short run in and centres it", () => {
    const v = viewOfRun({ x1: 0.5, y1: 0.3, x2: 0.52, y2: 0.3 }, page, frame, 400, 1.5);
    expect(v.zoom).toBeGreaterThan(1);
    const scale = 3000 * 1.5 * v.zoom;
    expect(v.left + frame.width / 2).toBeCloseTo(0.51 * scale, 3);
    expect(v.top + frame.height / 2).toBeCloseTo(0.3 * scale, 3);
  });
  it("never zooms past 6, nor out past 1, and never scrolls before the page", () => {
    expect(viewOfRun({ x1: 0.5, y1: 0.3, x2: 0.5001, y2: 0.3 }, page, frame, 100000, 1.5).zoom).toBe(6);
    expect(viewOfRun({ x1: 0, y1: 0.4, x2: 1, y2: 0.4 }, page, frame, 400, 1.5).zoom).toBe(1);
    const corner = viewOfRun({ x1: 0.001, y1: 0.001, x2: 0.01, y2: 0.001 }, page, frame, 400, 1.5);
    expect(corner.left).toBe(0);
    expect(corner.top).toBe(0);
  });
});

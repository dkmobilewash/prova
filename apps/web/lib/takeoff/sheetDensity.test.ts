import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { wallsFromStrokes, SheetTooDenseError, type StrokeSegment } from "./wallVectors";

/**
 * THE PAGE THAT NEVER RETURNED, AND THE NUMBERS THAT SIZE THE BUDGET.
 *
 * `wallsFromStrokes` is O(n²) with `inAHatchSeries` scanning inside the inner
 * loop. Measured on a real airport concourse set:
 *
 *   | page | raw segments | usable (>=2 ft) | pair tests | outcome |
 *   | --- | --- | --- | --- | --- |
 *   | Houston p7 | 152,189 | 30,825 | 475,000,000 | never returned |
 *   | Houston p11 | 387,891 | 16,288 | 133,000,000 | never reached |
 *   | a school floor plan | ~2,000 | hundreds | ~1,000,000 | 200ms |
 *
 * Every other stage on p7 is fast — `pageStrokes` peaks at 600ms across all 16
 * pages — so the hang was entirely in the pairer. The reported diagnosis was
 * "p7 hangs in pageStrokes", which timing disproved in one run.
 *
 * With the budget in, that same set runs end to end: p7 refuses in **22ms** and
 * the other fifteen pages behave as before.
 *
 * ── AND THEN THE BUDGET REFUSED A SHEET SOMEBODY NEEDED, 2026-10-17 ──
 *
 * It was `n*(n-1)/2 > MAX_PAIR_TESTS`, decided BEFORE any work. Camp Bow Wow
 * A101 — 16,538 lines, the sheet an estimator would actually price — scores
 * 136.7 million on that arithmetic and was refused outright. The work it was
 * predicting is **286,783 pair tests**, and the whole of `findWallsOnSheet`
 * takes about nine seconds on it.
 *
 * The estimate was not wrong that the loop is quadratic. It was wrong that
 * every iteration costs a pair test: a bounding-box prefilter rejects 99.8% of
 * them in four comparisons, because a pair that is both a wall thickness apart
 * and overlapping must have its bounding boxes that close. So the budget now
 * COUNTS what it spends and refuses mid-flight.
 *
 * ── WHICH MADE THIS FILE'S OWN FIXTURE STOP MEANING ANYTHING ──
 *
 * `fence()` builds segments "spread so no two are a wall thickness apart" — by
 * construction, nothing in it can pair. Under the old arithmetic 10,000 of
 * them scored 50M and refused; under a counter they cost nothing and sail
 * through, which is CORRECT. A sheet of well-separated lines is not too dense
 * to pair, and refusing it was the A101 defect in miniature.
 *
 * So the dense fixture is now one that is actually dense: lines piled on the
 * same spot, alternating direction so no pair ever succeeds and no face is
 * ever consumed, which is the shape that really does spend the budget.
 */

/** A segment long enough to survive the pairer's own 2ft pre-filter, at the
 *  scale these tests use. */
const feetPerPoint = 8;

function fence(count: number): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < count; i += 1) {
    // Each one 4ft long, so none is filtered out before the loop, and spread so
    // no two are a wall thickness apart.
    const y = i * 3;
    out.push({ x1: 0, y1: y, x2: 0.5, y2: y });
  }
  return out;
}

/**
 * Real wall-shaped pairs: two faces a wall thickness apart, repeated.
 *
 * `fence` is spread so nothing is ever a candidate, which makes it useless for
 * reaching a counter — the prefilter rejects every pair in four comparisons
 * and the budget is never spent. These cost tests, which is what the guard
 * counts.
 */
function nearPairs(count: number): StrokeSegment[] {
  const out: StrokeSegment[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = i * 3;
    // 0.05pt apart is 0.4ft at this scale, inside the thickness band.
    out.push({ x1: 0, y1: y, x2: 0.5, y2: y });
    out.push({ x1: 0, y1: y + 0.05, x2: 0.5, y2: y + 0.05 });
  }
  return out;
}

describe("a sheet too dense to pair", () => {
  it("REFUSES when it has actually spent the budget", () => {
    // ── THE GUARD IS A COUNTER NOW, SO THIS PASSES IT A SMALL ONE ──
    //
    // With the bounding-box prefilter in front of it, the real budget is
    // effectively unreachable: `oneFacePerLine` collapses coincident lines
    // first, so whatever survives is bounded by how much the drawing really
    // puts within a wall thickness of itself. Camp Bow Wow A101 — the densest
    // sheet anybody has produced here, 16,538 lines — spends 286,783 of the
    // 40,000,000 available.
    //
    // A guard nobody can reach is a guard nobody can check, so the threshold
    // is injectable and this reaches it from the other end.
    expect(() => wallsFromStrokes(nearPairs(400), { feetPerPoint, maxPairTests: 10 })).toThrow(
      SheetTooDenseError,
    );
  });

  it("REFUSES while there is still a person waiting", () => {
    const started = Date.now();
    expect(() => wallsFromStrokes(nearPairs(400), { feetPerPoint, maxPairTests: 10 })).toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("DOES NOT REFUSE A BIG SHEET WHOSE LINES ARE SPREAD OUT — the A101 case", () => {
    // ── THIS FIXTURE USED TO PROVE THE OPPOSITE, AND THAT WAS THE DEFECT ──
    //
    // `fence` builds segments "spread so no two are a wall thickness apart":
    // by construction nothing in it can pair. 10,000 of them score 50 million
    // on the old `n*(n-1)/2` arithmetic and were REFUSED — a sheet that costs
    // nothing, turned away on a prediction about work nobody attempted.
    //
    // That is exactly what happened to A101, at 136.7 million predicted
    // against 286,783 spent. So the fixture that used to demonstrate the guard
    // working now demonstrates it being wrong, and it is kept for that.
    const started = Date.now();
    expect(() => wallsFromStrokes(fence(10_000), { feetPerPoint })).not.toThrow();
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("SAYS HOW MANY LINES, and what to do instead", () => {
    // A number somebody can sanity-check against the sheet, and an instruction.
    // "Couldn't be read" would be false — it was read fine, there is too much.
    try {
      wallsFromStrokes(nearPairs(5_000), { feetPerPoint, maxPairTests: 10 });
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(SheetTooDenseError);
      const message = (e as SheetTooDenseError).message;
      expect(message).toMatch(/10,000 lines/);
      expect(message).toMatch(/by hand/i);
      expect((e as SheetTooDenseError).usableSegments).toBe(10_000);
    }
  });

  it("LETS AN ORDINARY SHEET THROUGH UNCHANGED", () => {
    // A real floor plan measures around a million pairs. 1,000 segments is
    // 500k — well inside, and it must behave exactly as before.
    expect(() => wallsFromStrokes(fence(1_000), { feetPerPoint })).not.toThrow();
  });

  it("is not fooled by many SHORT segments, which cost nothing", () => {
    // The reason the budget counts pairs AFTER the length filter rather than
    // raw segments: Houston p7 is 152,189 raw and 30,825 usable, and a page of
    // hatching can be hundreds of thousands of raw strokes that all drop out.
    const hatch: StrokeSegment[] = [];
    for (let i = 0; i < 40_000; i += 1) hatch.push({ x1: 0, y1: i, x2: 0.001, y2: i });
    expect(() => wallsFromStrokes(hatch, { feetPerPoint })).not.toThrow();
  });

  it("names itself, so a caller can tell it from a pdfjs failure", () => {
    // The viewer shows a different sentence for each, and `instanceof` is what
    // picks between them.
    const error = new SheetTooDenseError(123);
    expect(error.name).toBe("SheetTooDenseError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("the viewer's own use of it", () => {
  /** Comments stripped: this file and the viewer both print the symbol in
   *  prose, so a raw-text search would find a call site that does not exist. */
  const viewer = readFileSync(resolve(__dirname, "../../components/TakeoffPlanViewer.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("PARSED SOMETHING — so a broken strip fails loudly", () => {
    expect(viewer.length).toBeGreaterThan(20_000);
  });

  it("SHOWS THE DENSE SHEET'S OWN MESSAGE, not the generic one", () => {
    // Found by mutation on #693 and #695: a census that only checks the symbol
    // is present passes when the branch is dead. This asserts the branch.
    expect(viewer).toMatch(/problem instanceof SheetTooDenseError/);
    expect(viewer).toMatch(/\? problem\.message/);
  });

  it("still has the generic sentence for everything else", () => {
    expect(viewer).toMatch(/couldn't be read/i);
  });
});

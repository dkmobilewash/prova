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

describe("a sheet too dense to pair", () => {
  it("REFUSES rather than running, when the pairs exceed the budget", () => {
    // 10,000 segments is 50M pairs, past the 40M budget. Houston p7 is 30,825.
    expect(() => wallsFromStrokes(fence(10_000), { feetPerPoint })).toThrow(SheetTooDenseError);
  });

  it("REFUSES UP FRONT — in milliseconds, not after grinding", () => {
    // The whole point: a refusal somebody waits two seconds for is still a
    // button that feels broken. p7 refuses in 22ms in the real pipeline.
    const started = Date.now();
    expect(() => wallsFromStrokes(fence(10_000), { feetPerPoint })).toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("SAYS HOW MANY LINES, and what to do instead", () => {
    // A number somebody can sanity-check against the sheet, and an instruction.
    // "Couldn't be read" would be false — it was read fine, there is too much.
    try {
      wallsFromStrokes(fence(10_000), { feetPerPoint });
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

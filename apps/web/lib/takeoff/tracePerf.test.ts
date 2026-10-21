import { describe, expect, it } from "vitest";
import { draftFrom, keepReview, reviewSignature } from "./reviewDraft";
import { addTraced, startReview, type Candidate, type ReviewState } from "./answerKeyReview";

/**
 * ── A SHEET WITH A HUNDRED TRACES MUST STAY USABLE ──
 *
 * Central Bank A101 took 105 traces, and the final save left the tab
 * unresponsive for over three minutes. These functions run on EVERY decision,
 * split and trace — the autosave writes after each one, the leave-page
 * warning recomputes, and a re-detect compares — so anything quadratic in the
 * number of traces turns the last traces of a sheet into the slowest.
 *
 * The budgets are deliberately loose. The point is not to pin a millisecond
 * count that will drift with the machine: it is that the cost per trace does
 * not GROW with the number of traces. A hundred traces costing ten times a
 * ten-trace sheet is linear and fine; costing a hundred times is the shape
 * that produces a three-minute hang.
 */
const FPU = 336;

function sheetWith(traces: number, candidates = 142): ReviewState {
  const runs: Candidate[] = Array.from({ length: candidates }, (_, i) => ({
    id: `w${i}`,
    x1: 0.14 + (i % 20) * 0.02,
    y1: 0.35 + Math.floor(i / 20) * 0.03,
    x2: 0.14 + (i % 20) * 0.02 + 0.015,
    y2: 0.35 + Math.floor(i / 20) * 0.03,
    lengthFeet: 5,
    thicknessIn: 6,
    from: "pair",
    note: "detected",
  }));
  let state = startReview(runs, FPU);
  for (let i = 0; i < traces; i += 1) {
    state = addTraced(state, {
      id: `t${i}`,
      x1: 0.15 + (i % 25) * 0.02,
      y1: 0.36 + Math.floor(i / 25) * 0.03,
      x2: 0.15 + (i % 25) * 0.02 + 0.018,
      y2: 0.36 + Math.floor(i / 25) * 0.03,
      lengthFeet: 6,
      thicknessIn: 0,
      from: "single",
      note: "traced",
    });
  }
  return state;
}

/** Milliseconds for one call, averaged over a few. */
function timed(run: () => unknown, times = 5): number {
  const started = performance.now();
  for (let i = 0; i < times; i += 1) run();
  return (performance.now() - started) / times;
}

describe("the cost of a trace does not grow with the number of traces", () => {
  it("adding one trace costs the same at 100 as at 10", () => {
    const small = sheetWith(10);
    const big = sheetWith(100);
    const one = (state: ReviewState) => () =>
      addTraced(state, {
        id: "new",
        x1: 0.2,
        y1: 0.5,
        x2: 0.22,
        y2: 0.5,
        lengthFeet: 6,
        thicknessIn: 0,
        from: "single",
        note: "traced",
      });
    const atTen = timed(one(small), 20);
    const atHundred = timed(one(big), 20);
    // Ten times the traces may cost more; it must not cost catastrophically
    // more. 40x leaves room for a machine under load and still fails a
    // quadratic.
    expect(atHundred, `10 traces ${atTen.toFixed(3)}ms, 100 traces ${atHundred.toFixed(3)}ms`).toBeLessThan(
      Math.max(atTen * 40, 5),
    );
  });

  it("writing the draft stays proportional", () => {
    // The autosave runs after every change, so this is the per-keystroke cost.
    const atTen = timed(() =>
      draftFrom({ state: sheetWith(10), set: "S", page: 25, finderVersion: "abc" }),
    );
    const atHundred = timed(() =>
      draftFrom({ state: sheetWith(100), set: "S", page: 25, finderVersion: "abc" }),
    );
    expect(atHundred).toBeLessThan(Math.max(atTen * 40, 20));
  });

  it("the saved-signature stays proportional", () => {
    // Recomputed on every render by the leave-page warning.
    const atTen = timed(() => reviewSignature(sheetWith(10)));
    const atHundred = timed(() => reviewSignature(sheetWith(100)));
    expect(atHundred).toBeLessThan(Math.max(atTen * 40, 20));
  });

  it("a re-detect stays proportional", () => {
    const small = sheetWith(10);
    const big = sheetWith(100);
    const atTen = timed(() => keepReview(small, small));
    const atHundred = timed(() => keepReview(big, big));
    expect(atHundred).toBeLessThan(Math.max(atTen * 40, 20));
  });

  it("a hundred-trace sheet is built in a sane time at all", () => {
    // The absolute floor: if making the fixture is slow, every case above is
    // measuring the fixture rather than the thing.
    const started = performance.now();
    const state = sheetWith(105);
    const ms = performance.now() - started;
    expect(state.traced).toHaveLength(105);
    expect(ms, `building a 105-trace sheet took ${ms.toFixed(0)}ms`).toBeLessThan(4000);
  });
});

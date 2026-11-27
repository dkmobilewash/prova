import { describe, expect, it } from "vitest";
import { actionsToExact, type ActionsInput } from "./actionsToExact";

/**
 * Build gate 3 of prereg-scoreboard-v3.md: a PERFECT draft scores zero, and every
 * term B / E / J / L / R / M / H is pinned by a case that moves it alone — so
 * dropping any term from the sum turns a test red.
 */

const KEY2: ActionsInput["key"] = [
  { missed: false, type: "A1", knownFeet: 10 },
  { missed: false, type: "A1", knownFeet: 10 },
];
const realRun = (keyIndex: number, heightFeet = 10) => ({ lengthFeet: 10, held: false, junk: false, heightFeet, keyIndex });
const junkRun = () => ({ lengthFeet: 10, held: false, junk: true, heightFeet: 10, keyIndex: -1 });
const base = (over: Partial<ActionsInput>): ActionsInput => ({
  runs: [realRun(0), realRun(1)],
  key: KEY2,
  boxOptions: [],
  likeClasses: () => [],
  ...over,
});

describe("actions to exact", () => {
  it("scores a PERFECT draft at zero", () => {
    const r = actionsToExact(base({}));
    expect(r).toMatchObject({ actions: 0, B: 0, E: 0, J: 0, L: 0, R: 0, M: 0, H: 0 });
  });

  it("J: one posted junk run costs one remove", () => {
    const r = actionsToExact(base({ runs: [realRun(0), realRun(1), junkRun()] }));
    expect(r).toMatchObject({ actions: 1, J: 1 });
  });

  it("R: one HELD real run costs one restore", () => {
    const r = actionsToExact(base({ runs: [realRun(0), { ...realRun(1), held: true }] }));
    expect(r).toMatchObject({ actions: 1, R: 1 });
  });

  it("M: one key wall nothing covers costs one add", () => {
    const r = actionsToExact(base({ runs: [realRun(0)], key: [KEY2[0]!, { ...KEY2[1]!, missed: true }] }));
    expect(r).toMatchObject({ actions: 1, M: 1 });
  });

  it("H: a key-known type off by more than 0.25 ft costs ONE answer for the whole type", () => {
    const r = actionsToExact(base({ runs: [realRun(0, 9), realRun(1, 9)] }));
    expect(r).toMatchObject({ actions: 1, H: 1 });
  });

  it("H: a height the key does not know is never graded", () => {
    const r = actionsToExact(base({ runs: [realRun(0, 9)], key: [{ missed: false, type: "A1", knownFeet: null }] }));
    expect(r.H).toBe(0);
  });

  it("B + L: a box is taken only when it beats removing junk by hand, and a real wall it cuts is one restore", () => {
    const runs = [realRun(0), realRun(1), junkRun(), junkRun(), junkRun(), junkRun()];
    // the box keeps both reals but one only 40% inside: 1 box + 1 restore beats 4 removes
    const inside = new Map<number, number>([[0, 10], [1, 4]]);
    const r = actionsToExact(base({ runs, boxOptions: [{ boxes: 1, insideFeet: inside }] }));
    expect(r).toMatchObject({ B: 1, J: 0, L: 1, actions: 2 });
  });

  it("B: a box that saves nothing is not taken", () => {
    const runs = [realRun(0), realRun(1), junkRun()];
    const inside = new Map<number, number>([[0, 10], [1, 10]]);
    const r = actionsToExact(base({ runs, boxOptions: [{ boxes: 1, insideFeet: inside }] }));
    expect(r).toMatchObject({ B: 0, J: 1, actions: 1 });
  });

  it("E + L: a like-click is taken when it nets a saving, and the real wall it sweeps is charged as a loss", () => {
    const runs = [realRun(0), realRun(1), junkRun(), junkRun(), junkRun()];
    const r = actionsToExact(base({ runs, likeClasses: () => [[1, 2, 3, 4]] }));
    // 3 junk gone for 1 click + 1 real restore = 2, beating 3 removes
    expect(r).toMatchObject({ E: 1, J: 0, L: 1, actions: 2 });
  });

  it("E: a like-click that sweeps as much real as junk is never taken", () => {
    const runs = [realRun(0), realRun(1), junkRun(), junkRun()];
    const r = actionsToExact(base({ runs, likeClasses: () => [[0, 1, 2, 3]] }));
    expect(r).toMatchObject({ E: 0, J: 2, actions: 2 });
  });
});

/**
 * ERASE (W2 item 2, coordination/erase-area-tool.md P6): the product's "Erase walls in this area". The caller builds
 * each option's erased set with the product's own `eraseInBoxes` (pinned in eraseArea.test.ts); here only the counting.
 * One action per box; a real run it takes is a loss (one restore each, as for a work-area box); it acts after the
 * work area, on what the work area kept (the product's order); absent, every v3 count is unchanged.
 */
describe("actions to exact: erase boxes", () => {
  const junk3 = [realRun(0), realRun(1), junkRun(), junkRun(), junkRun()];
  it("one erase box that takes three junk runs costs 1 instead of 3 removes", () => {
    const r = actionsToExact(base({ runs: junk3, eraseOptions: [{ boxes: 1, erased: new Set([2, 3, 4]) }] }));
    expect(r).toMatchObject({ actions: 1, J: 0, L: 0, X: 1 });
  });
  it("a real run the box takes is charged as a loss (L)", () => {
    const r = actionsToExact(base({ runs: junk3, eraseOptions: [{ boxes: 1, erased: new Set([1, 2, 3, 4]) }] }));
    expect(r).toMatchObject({ actions: 2, X: 1, L: 1, J: 0 });
  });
  it("an erase option that does not pay is not taken", () => {
    const r = actionsToExact(base({ runs: [realRun(0), realRun(1), junkRun()], eraseOptions: [{ boxes: 1, erased: new Set([2]) }] }));
    expect(r).toMatchObject({ actions: 1, X: 0, J: 1 });
  });
  it("ties keep fewer boxes", () => {
    const r = actionsToExact(base({ runs: junk3, eraseOptions: [{ boxes: 1, erased: new Set([2, 3]) }, { boxes: 2, erased: new Set([2, 3, 4]) }] }));
    expect(r).toMatchObject({ actions: 2, X: 1, J: 1 });
  });
  it("acts after the work area: a run the work area already set aside is not erased again or counted twice", () => {
    // The work-area box keeps runs 0, 1, 2 (3 and 4 are outside it); erase then takes 2.
    const insideFeet = new Map([[0, 10], [1, 10], [2, 10]]);
    const r = actionsToExact(base({ runs: junk3, boxOptions: [{ boxes: 1, insideFeet }], eraseOptions: [{ boxes: 1, erased: new Set([2, 3, 4]) }] }));
    expect(r).toMatchObject({ B: 1, X: 0, J: 1, actions: 2 });
  });
  it("prices an erase box on what the work area KEPT: junk outside the work area is not its job", () => {
    // Work area keeps 0..3 (junk 2, 3 inside it); junk 4, 5 lie outside it. The erase box takes 2 and 3 only.
    const runs = [realRun(0), realRun(1), junkRun(), junkRun(), junkRun(), junkRun()];
    const insideFeet = new Map([[0, 10], [1, 10], [2, 10], [3, 10]]);
    const r = actionsToExact(base({ runs, boxOptions: [{ boxes: 1, insideFeet }], eraseOptions: [{ boxes: 1, erased: new Set([2, 3]) }] }));
    expect(r).toMatchObject({ B: 1, X: 1, J: 0, actions: 2 });
  });
  it("absent erase options change nothing (the OFF arm is v3)", () => {
    const runs = [realRun(0), realRun(1), junkRun()];
    expect(actionsToExact(base({ runs, eraseOptions: [] }))).toEqual(actionsToExact(base({ runs })));
  });
});

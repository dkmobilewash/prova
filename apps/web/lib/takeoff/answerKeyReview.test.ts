import { describe, expect, it } from "vitest";
import {
  addTraced,
  tracedWall,
  candidatesInBox,
  keyFromReview,
  nextUnreviewed,
  progressOf,
  setVerdict,
  startReview,
  type Candidate,
} from "./answerKeyReview";

/**
 * ── A KEY THAT AGREES WITH THE DETECTOR IS NOT A KEY ──
 *
 * The property worth defending above all others here: nothing counts until
 * somebody says it does. The obvious design — pre-accept the detection and let
 * the reviewer delete what is wrong — produces a key that agrees with the
 * thing it is grading, because nobody deletes 122 rows one at a time.
 */

function candidate(id: string, feet: number, from: "pair" | "single" = "pair"): Candidate {
  return {
    id,
    x1: 0.1,
    y1: Number(id.replace(/\D/g, "")) / 100,
    x2: 0.2,
    y2: Number(id.replace(/\D/g, "")) / 100,
    lengthFeet: feet,
    thicknessIn: from === "pair" ? 6 : null,
    from,
    note: "",
  };
}

const ABOUT = {
  set: "Camp Bow Wow",
  page: 9,
  number: "A102",
  reviewedBy: "diego",
  reviewedAt: "2026-10-17T12:00:00.000Z",
  feetPerUnit: 288,
};

describe("every candidate starts unreviewed", () => {
  it("SAVES NOTHING before anybody has said anything", () => {
    const state = startReview([candidate("c1", 30), candidate("c2", 40)]);
    expect(keyFromReview(state, ABOUT).walls).toHaveLength(0);
    expect(progressOf(state)).toMatchObject({ total: 2, reviewed: 0, walls: 0, feet: 0 });
  });

  it("A HALF-FINISHED REVIEW MAKES A SHORT KEY, not a wrong one", () => {
    // The alternative — quietly including the undecided — would grade every
    // later run against a number nobody stood behind. The progress count is
    // what says it is half finished.
    let state = startReview([candidate("c1", 30), candidate("c2", 40), candidate("c3", 50)]);
    state = setVerdict(state, ["c1"], "wall");
    expect(keyFromReview(state, ABOUT).walls).toHaveLength(1);
    expect(progressOf(state)).toMatchObject({ total: 3, reviewed: 1, walls: 1 });
  });
});

describe("deciding", () => {
  it("accepts and rejects, and counts both", () => {
    let state = startReview([candidate("c1", 30), candidate("c2", 40)]);
    state = setVerdict(state, ["c1"], "wall");
    state = setVerdict(state, ["c2"], "not-a-wall");
    const at = progressOf(state);
    expect(at).toMatchObject({ reviewed: 2, walls: 1, notWalls: 1 });
    expect(at.feet).toBeCloseTo(30, 6);
  });

  it("lets a decision be changed, because reviewers change their minds", () => {
    let state = startReview([candidate("c1", 30)]);
    state = setVerdict(state, ["c1"], "wall");
    state = setVerdict(state, ["c1"], "not-a-wall");
    expect(progressOf(state)).toMatchObject({ walls: 0, notWalls: 1 });
  });

  it("IGNORES AN ID THAT IS NOT ON THE SHEET, so a stray select invents nothing", () => {
    let state = startReview([candidate("c1", 30)]);
    state = setVerdict(state, ["nope"], "wall");
    expect(progressOf(state)).toMatchObject({ total: 1, reviewed: 0 });
    expect(keyFromReview(state, ABOUT).walls).toHaveLength(0);
  });
});

describe("moving through the sheet", () => {
  it("finds the next undecided one and wraps around", () => {
    let state = startReview([candidate("c1", 30), candidate("c2", 40), candidate("c3", 50)]);
    state = setVerdict(state, ["c2"], "wall");
    expect(nextUnreviewed(state, "c1")?.id).toBe("c3");
    // Past the end, back to the start — the one case an index walk gets wrong.
    expect(nextUnreviewed(state, "c3")?.id).toBe("c1");
  });

  it("returns nothing when the sheet is finished, which is how the mode ends", () => {
    let state = startReview([candidate("c1", 30)]);
    state = setVerdict(state, ["c1"], "wall");
    expect(nextUnreviewed(state, null)).toBeNull();
  });
});

describe("box select", () => {
  it("takes what is inside and leaves what is not", () => {
    const state = startReview([candidate("c10", 30), candidate("c50", 40), candidate("c90", 50)]);
    // Midpoints sit at y = 0.10, 0.50 and 0.90.
    const inside = candidatesInBox(state, { x1: 0, y1: 0.05, x2: 1, y2: 0.55 });
    expect(inside).toEqual(["c10", "c50"]);
  });

  it("works whichever corner the drag started from", () => {
    const state = startReview([candidate("c10", 30), candidate("c90", 50)]);
    const forward = candidatesInBox(state, { x1: 0, y1: 0.05, x2: 1, y2: 0.55 });
    const backward = candidatesInBox(state, { x1: 1, y1: 0.55, x2: 0, y2: 0.05 });
    expect(backward).toEqual(forward);
  });

  it("accepts many at once, which is the point of it", () => {
    let state = startReview([candidate("c10", 30), candidate("c50", 40), candidate("c90", 50)]);
    state = setVerdict(state, candidatesInBox(state, { x1: 0, y1: 0, x2: 1, y2: 1 }), "not-a-wall");
    expect(progressOf(state)).toMatchObject({ reviewed: 3, notWalls: 3 });
  });
});

describe("a wall the detector missed entirely", () => {
  it("is traced by hand and is in the key without a verdict", () => {
    // It has no candidate to accept, because nothing proposed it. Tracing one
    // IS the decision.
    let state = startReview([candidate("c1", 30)]);
    state = addTraced(state, { ...candidate("t1", 25, "single"), id: "t1" });
    const key = keyFromReview(state, ABOUT);
    expect(key.walls).toHaveLength(1);
    expect(key.walls[0].lengthFeet).toBeCloseTo(25, 6);
    expect(progressOf(state).traced).toBe(1);
    expect(progressOf(state).feet).toBeCloseTo(25, 6);
  });
});

describe("the key it produces", () => {
  it("records how the drawing showed each wall", () => {
    // The question the single-line measurement could not answer without a key:
    // 7,694 ft of unpaired lines on one sheet, and no way to know how much was
    // wall. The key says, per wall.
    let state = startReview([candidate("c1", 30, "pair"), candidate("c2", 40, "single")]);
    state = setVerdict(state, ["c1", "c2"], "wall");
    const key = keyFromReview(state, ABOUT);
    expect(key.walls.map((w) => w.from).sort()).toEqual(["pair", "single"]);
  });

  it("carries who reviewed it and when, because a key is a judgement", () => {
    const key = keyFromReview(startReview([]), ABOUT);
    expect(key.reviewedBy).toBe("diego");
    expect(key.reviewedAt).toBe("2026-10-17T12:00:00.000Z");
    expect(key.sheet).toEqual({ set: "Camp Bow Wow", page: 9, number: "A102" });
    expect(key.feetPerUnit).toBe(288);
  });
});

/**
 * ── A WALL THE FINDER MISSED, AND A LINE IT ALREADY EXPLAINED ──
 *
 * Two questions asked together because they are the two ends of the same
 * promise: what a reviewer draws goes in, and what the app decided for them
 * does not.
 */
describe("what can and cannot reach the key", () => {
  const about = {
    set: "Camp Bow Wow",
    page: 9,
    number: "A102",
    reviewedBy: "diego",
    reviewedAt: "2026-10-17T12:00:00.000Z",
    feetPerUnit: 288,
  };

  it("A TRACED WALL IS IN THE KEY, ACCEPTED, WITH NO VERDICT NEEDED", () => {
    // It was drawn by the person whose judgement the key records, so there is
    // nobody left to ask.
    const state = addTraced(
      startReview([]),
      tracedWall({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, 288, 0),
    );
    const key = keyFromReview(state, about);
    expect(key.walls).toHaveLength(1);
    expect(key.walls[0].lengthFeet).toBeCloseTo(0.2 * 288, 5);
  });

  it("records a traced wall's thickness as unknown rather than guessing one", () => {
    // Two clicks give a centreline and say nothing about thickness. A default
    // would be in the key for ever, and a key is what everything is graded
    // against.
    const wall = tracedWall({ x: 0, y: 0 }, { x: 0.1, y: 0 }, 288, 0);
    expect(wall.thicknessIn).toBeNull();
  });

  it("gives each traced wall its own id, so two of them are two walls", () => {
    let state = addTraced(startReview([]), tracedWall({ x: 0, y: 0 }, { x: 0.1, y: 0 }, 288, 0));
    state = addTraced(state, tracedWall({ x: 0, y: 0.5 }, { x: 0.1, y: 0.5 }, 288, 1));
    expect(new Set(state.traced.map((one) => one.id)).size).toBe(2);
    expect(keyFromReview(state, about).walls).toHaveLength(2);
  });

  it("A LINE THAT WAS NEVER OFFERED CANNOT BE IN THE KEY", () => {
    // The 136 lines A102 sets aside are not candidates at all: they have no
    // verdict to be `wall`, so there is no path from a hatch line to a key
    // except being offered and then accepted by hand.
    const offered = [candidate("c1", 20)];
    const state = startReview(offered);
    expect(keyFromReview(state, about).walls).toHaveLength(0);
    const accepted = setVerdict(state, ["c1"], "wall");
    expect(keyFromReview(accepted, about).walls).toHaveLength(1);
  });

  it("an offered line still starts unreviewed, so offering is not accepting", () => {
    // "Offer these too" puts the set-aside lines back on the list. It does not
    // decide about them — that is the whole shape of this mode.
    const state = startReview([candidate("c1", 20), candidate("c2", 30, "single")]);
    expect(progressOf(state).reviewed).toBe(0);
    expect(keyFromReview(state, about).walls).toHaveLength(0);
  });
});

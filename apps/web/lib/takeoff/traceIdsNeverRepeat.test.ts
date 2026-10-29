/**
 * A TRACE ID IS NEVER REISSUED, NOT EVEN AFTER THE TRACE IS DELETED.
 *
 * Chrome, round 8: after deleting traces, new ones took an id that was still
 * in use, and the drawing kept a ghost line that could not be deleted
 * (Hillside A-1, HACP A-2). The files on disk were correct — this is in-memory
 * identity only, which is why it survived a save and reappeared on screen.
 *
 * The cause was the same arithmetic in two places, `traced.length`, turned
 * into `t${n}`. Delete t3 of five and add one: the length is 4, the new id is
 * t4, and two entries answer to that name. `removeTraced` filters by id, so it
 * takes both or the wrong one, and what remains cannot be addressed again.
 *
 * This is CLAUDE.md's sequence rule in memory rather than in Postgres —
 * "anything derived from surviving rows is reissued when a row is deleted" —
 * so the fix is the rule's own shape: a counter that only goes up, kept beside
 * the thing it numbers, assigned where no caller can bypass it.
 */
import { describe, expect, it } from "vitest";
import { addTraced, removeTraced, startReview, tracedWall, type ReviewState } from "./answerKeyReview";

const trace = (y: number) => tracedWall({ x: 0.1, y }, { x: 0.5, y }, 10);

/** Every id ever handed out by this state, in order. */
function idsAfter(steps: (s: ReviewState) => ReviewState): string[] {
  return steps(startReview([])).traced.map((t) => t.id);
}

describe("trace ids", () => {
  it("are unique across a plain run of adds", () => {
    const ids = idsAfter((s) => addTraced(addTraced(addTraced(s, trace(0.1)), trace(0.2)), trace(0.3)));
    expect(ids).toEqual(["t0", "t1", "t2"]);
    expect(new Set(ids).size, "an id was handed out twice").toBe(ids.length);
  });

  it("DO NOT REPEAT after a delete — the exact sequence Chrome hit", () => {
    // Five traces, delete one from the middle, add two more.
    let state = startReview([]);
    for (const y of [0.1, 0.2, 0.3, 0.4, 0.5]) state = addTraced(state, trace(y));
    expect(state.traced.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3", "t4"]);

    state = removeTraced(state, "t2");
    state = addTraced(state, trace(0.6));
    state = addTraced(state, trace(0.7));

    const ids = state.traced.map((t) => t.id);
    expect(new Set(ids).size, `a deleted id came back: ${ids.join(", ")}`).toBe(ids.length);
    // And specifically: nothing reuses the freed name, because a reference held
    // anywhere else would then address a different line.
    expect(ids, "the freed id t2 was reissued").not.toContain("t2");
    expect(ids).toEqual(["t0", "t1", "t3", "t4", "t5", "t6"]);
  });

  it("keep counting up even when every trace is deleted", () => {
    let state = startReview([]);
    state = addTraced(state, trace(0.1));
    state = addTraced(state, trace(0.2));
    state = removeTraced(state, "t0");
    state = removeTraced(state, "t1");
    expect(state.traced).toEqual([]);
    state = addTraced(state, trace(0.3));
    expect(state.traced[0]?.id, "an empty list reset the counter, so ids restart and collide").toBe("t2");
  });

  it("the delete addresses exactly one line", () => {
    // The symptom, stated directly: with a duplicate id, removeTraced takes
    // both. With unique ids it takes one.
    let state = startReview([]);
    for (const y of [0.1, 0.2, 0.3]) state = addTraced(state, trace(y));
    const after = removeTraced(state, "t1");
    expect(after.traced.map((t) => t.id)).toEqual(["t0", "t2"]);
  });

  it("ignores an id the caller supplies, because two callers got it wrong", () => {
    // `tracedWall`'s index is provisional. If a caller computes one, the state
    // still decides — that is what stops this coming back through a third
    // call site.
    const state = addTraced(startReview([]), tracedWall({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, 99));
    expect(state.traced[0]?.id, "a caller's index reached the id").toBe("t0");
  });
});

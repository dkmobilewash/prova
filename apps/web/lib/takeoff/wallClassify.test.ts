import { describe, expect, it } from "vitest";
import { readWallLabels, type WallCandidateForLabel } from "@prova/integrations";

/**
 * WHAT A LABEL IS ALLOWED TO DO TO A QUANTITY, which is: decide whether a run
 * is counted, and nothing else.
 *
 * The wall finder measures every run before this is asked anything, so no
 * length, thickness or footage in a bid comes from a model. The reply is a
 * label per run and the only lever it has is inclusion. That makes the failure
 * modes narrow and worth pinning exactly, because each one moves footage:
 *
 *   - a label for a run that is not on this crop would apply to nothing, or to
 *     whatever happens to hold that id;
 *   - two answers for one run would make the verdict depend on iteration order;
 *   - an unrecognised label must not fall through to a default, because both
 *     available defaults — drop the run, keep the run — are decisions nobody
 *     made.
 *
 * A run with no usable answer is absent from the result, and the viewer leaves
 * such a run as the geometry found it. That direction is deliberate: a run
 * nobody has accepted yet is safer on the list than off it.
 */
const candidates: WallCandidateForLabel[] = [
  { id: 1, thicknessIn: 4.88, lengthFt: 30 },
  { id: 2, thicknessIn: 25, lengthFt: 12 },
  { id: 3, thicknessIn: 4.88, lengthFt: 18 },
];

describe("reading the labels back", () => {
  it("keeps a label for each run it was asked about", () => {
    const out = readWallLabels(
      [
        { id: 1, label: "WALL", reason: "corridor wall" },
        { id: 2, label: "CASEWORK", reason: "kitchen counter" },
        { id: 3, label: "UNSURE", reason: "could be a low wall" },
      ],
      candidates,
    );
    expect(out.map((one) => [one.id, one.label])).toEqual([
      [1, "WALL"],
      [2, "CASEWORK"],
      [3, "UNSURE"],
    ]);
  });

  it("DROPS AN ID IT WAS NEVER ASKED ABOUT", () => {
    const out = readWallLabels([{ id: 9, label: "CASEWORK", reason: "" }], candidates);
    expect(out, "a label landed on a run that is not on this crop").toEqual([]);
  });

  it("KEEPS THE FIRST ANSWER FOR A RUN AND DROPS A SECOND", () => {
    const out = readWallLabels(
      [
        { id: 1, label: "WALL", reason: "first" },
        { id: 1, label: "CASEWORK", reason: "second" },
      ],
      candidates,
    );
    expect(out).toHaveLength(1);
    expect(out[0].label, "the second answer won, so order decided a quantity").toBe("WALL");
  });

  it("REFUSES A LABEL OUTSIDE THE FOUR rather than defaulting it either way", () => {
    const out = readWallLabels(
      [
        { id: 1, label: "PROBABLY", reason: "" },
        { id: 2, label: "wall", reason: "lower case is not one of them" },
        { id: 3, label: "WALL", reason: "" },
      ],
      candidates,
    );
    expect(out.map((one) => one.id), "an unrecognised label was given a meaning").toEqual([3]);
  });

  it("survives a reply that is not a list at all", () => {
    for (const nonsense of [null, undefined, "WALL", 7, {}, { labels: [] }]) {
      expect(readWallLabels(nonsense, candidates)).toEqual([]);
    }
  });

  it("survives rows that are not objects, and ids that are not numbers", () => {
    const out = readWallLabels(
      [null, "WALL", 3, { id: "1", label: "WALL" }, { label: "WALL" }, { id: 1, label: "WALL" }],
      candidates,
    );
    expect(out.map((one) => one.id)).toEqual([1]);
  });

  it("bounds the reason, which is shown on screen beside a run", () => {
    const out = readWallLabels([{ id: 1, label: "WALL", reason: "x".repeat(5000) }], candidates);
    expect(out[0].reason.length).toBeLessThanOrEqual(200);
  });

  it("gives a run with no reason an empty one rather than undefined", () => {
    const out = readWallLabels([{ id: 1, label: "WALL" }], candidates);
    expect(out[0].reason).toBe("");
  });

  it("asks for nothing when there is nothing to ask about", () => {
    expect(readWallLabels([{ id: 1, label: "WALL", reason: "" }], [])).toEqual([]);
  });
});

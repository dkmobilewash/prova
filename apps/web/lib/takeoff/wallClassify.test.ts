import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readMissingWalls,
  readWallLabels,
  wallClassifyToolCall,
  WALL_CLASSIFY_TOOL_NAME,
  type WallCandidateForLabel,
} from "@prova/integrations";

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

/**
 * ── WHAT IT SAYS IS MISSING, which nothing else here can say ──
 *
 * Every other check in this repo reasons about runs that EXIST. A wall the
 * finder never paired is in no cluster, no group and no total, so no census, no
 * bench diagnosis and no sum downstream can notice it is gone. Only looking at
 * the drawing can — which is why the reply carries this half at all.
 *
 * It carries WORDS, never a quantity. There is no length, thickness or geometry
 * in a `MissingWall` on purpose: the estimator traces it with the measuring
 * tools and the number comes off the drawing like every other one. So the risks
 * are small and bounded, and these are the bounds.
 */
describe("the missing walls it reports", () => {
  it("keeps what it can act on", () => {
    expect(
      readMissingWalls([
        { where: "south side of EX'G FORD SPACE 139", why: "encloses the room, no run on it" },
        { where: "between the men's and women's restrooms", why: "demising wall" },
      ]),
    ).toEqual([
      { where: "south side of EX'G FORD SPACE 139", why: "encloses the room, no run on it" },
      { where: "between the men's and women's restrooms", why: "demising wall" },
    ]);
  });

  it("DROPS A ROW WITH NOWHERE TO LOOK, which is worse than no row", () => {
    // "a wall is missing" with no location is an alarm nobody can act on, and
    // it would sit on screen beside the ones they can.
    expect(readMissingWalls([{ where: "   ", why: "it is a wall" }, { where: "", why: "x" }])).toEqual([]);
  });

  it("survives a reply that is not a list, or rows that are not objects", () => {
    for (const nonsense of [null, undefined, "a wall", 7, {}]) expect(readMissingWalls(nonsense)).toEqual([]);
    expect(readMissingWalls([null, 3, "wall", { where: "north wall", why: "" }])).toHaveLength(1);
  });

  it("bounds the list, so a flood cannot bury the runs beside it", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ where: `wall ${i}`, why: "" }));
    expect(readMissingWalls(many)).toHaveLength(25);
  });

  it("bounds each field, which is rendered straight onto the panel", () => {
    const [one] = readMissingWalls([{ where: "x".repeat(900), why: "y".repeat(900) }]);
    expect(one.where.length).toBeLessThanOrEqual(200);
    expect(one.why.length).toBeLessThanOrEqual(200);
  });

  it("gives a row with no reason an empty one rather than undefined", () => {
    expect(readMissingWalls([{ where: "the corridor's north wall" }])[0].why).toBe("");
  });
});

describe("no tool call is a FAILURE, not a clean bill of health", () => {
  // ── THE DEFECT THIS PINS, FROM A REAL DRAWING ──
  //
  // 2026-10-13, a West Herr floor plan on production: the finder returned 216
  // runs, the estimator pressed "Check these are walls", it thought for about a
  // minute, and printed "0 run(s) set aside as casework or reference" — while
  // the overlay held title-block dividers, the company logo, five car outlines
  // and a dozen room-name tags. Nothing had been judged. The model returned no
  // tool call and the code read that as an empty verdict.
  //
  // A silent failure reported as a clean pass is the exact shape this repo
  // keeps paying for, and here it reached an estimator about to price a bid.

  const asked: WallCandidateForLabel[] = [{ id: 1, thicknessIn: 5, lengthFt: 10 }];

  it("throws when the response carries no tool call", () => {
    expect(() => wallClassifyToolCall([{ type: "text" }], "max_tokens", 216)).toThrow(
      /no label_candidates call for 216 candidates/,
    );
  });

  it("carries the stop reason in the NAME, because that is all the action logs", () => {
    // `takeoffClassify.ts` logs `err.name` and deliberately not the message —
    // metadata only, never text that could carry a key. So the one fact worth
    // having has to travel in the name.
    try {
      wallClassifyToolCall([{ type: "text" }], "max_tokens", 216);
      expect.unreachable("it should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("WallClassifyIncomplete:max_tokens");
    }
  });

  it("names it when there is no stop reason at all", () => {
    try {
      wallClassifyToolCall([], null, 3);
      expect.unreachable("it should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("WallClassifyIncomplete:none");
    }
  });

  it("returns the block when the model did call the tool", () => {
    const block = { type: "tool_use", name: WALL_CLASSIFY_TOOL_NAME, input: { labels: [] } };
    expect(wallClassifyToolCall([{ type: "text" }, block], "tool_use", 1)).toBe(block);
  });

  it("ignores a tool call by another name, rather than reading its input", () => {
    // A different tool's output is not a verdict about walls, and reading it
    // would be the same failure wearing a different hat.
    expect(() =>
      wallClassifyToolCall([{ type: "tool_use", name: "something_else", input: {} }], "tool_use", 1),
    ).toThrow();
  });

  void asked;
});

describe("the estimator is told what to do about it", () => {
  const source = readFileSync(
    resolve(process.cwd(), "lib/actions/takeoffClassify.ts"),
    "utf8",
  );

  it("tells them to check a smaller area, not to try again", () => {
    // "Try again in a minute" is wrong for this one: 216 runs will fail the
    // same way every time. The message has to name the number and the way out.
    // THE WIRING, not the strings. The first version asserted that both the
    // name and the sentence appeared somewhere in the file, and a mutation
    // setting `const incomplete = false` left both in place and stayed green —
    // the message was present and unreachable. So the derivation is what is
    // pinned.
    expect(source).toContain('err.name.startsWith("WallClassifyIncomplete")');
    expect(source).toContain("Zoom into part of the sheet");
    expect(source).toContain("${candidates.length} runs in one go");
  });

  it("still marks the allowance, because the call was made and billed", () => {
    expect(source).toContain("markAskAllowanceFailure");
  });
});

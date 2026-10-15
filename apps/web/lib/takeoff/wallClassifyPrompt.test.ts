import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WALL_CLASSIFY_PROMPT_VERSION } from "@prova/integrations";

/**
 * THE PROMPT IS THE FEATURE, so the rules it carries are pinned like code.
 *
 * Everything else about wall classification is geometry and parsing, and both
 * are tested by running them. What the model is ASKED is neither — it is a
 * paragraph, and a paragraph can lose a clause in an edit with every test still
 * green. Mutation showed exactly that: deleting "vehicles" from the not-a-wall
 * list, and deleting the shape rule outright, changed nothing anywhere.
 *
 * ── WHY THESE PARTICULAR SENTENCES ──
 *
 * Each one is a defect somebody reported off a real drawing:
 *
 *   - VEHICLES. A West Herr dealership plan draws cars in the showroom, and
 *     their body curves pair as neatly as any wall — the first run returned
 *     the rooflines. Curves are flattened on purpose (#743, so a curved wall is
 *     found), which is what makes a car's outline pairable at all.
 *   - THE SHAPE RULE. "Two STRAIGHT parallel lines a constant distance apart;
 *     an outline that curves or closes on itself is an object." This is the
 *     part that covers whatever nobody has thought of yet, and the list is only
 *     its worked examples.
 *   - WHAT IS MISSING. The model is the only thing in this pipeline that can
 *     see a wall that was never paired: such a wall is in no cluster, no total
 *     and no diagnosis, so nothing downstream can miss it.
 *
 * ── AND THE VERSION MOVES WITH IT ──
 *
 * `AskUsage.promptVersion` records which prompt produced a row. If the words
 * change and the version does not, every row afterwards reports what the old
 * prompt asked — the silent kind of wrong `promptVersionCensus.test.ts` exists
 * for. So the version is asserted to be the one the action records, and both
 * read the same constant rather than two spellings of it.
 */
const SOURCE = resolve(
  resolve(import.meta.dirname, "../../../.."),
  "packages/integrations/src/wallClassify.ts",
);
const ACTION = resolve(import.meta.dirname, "../actions/takeoffClassify.ts");

/** The system prompt's text, with the surrounding code stripped away. */
function systemPrompt(): string {
  const source = readFileSync(SOURCE, "utf8");
  const at = source.indexOf("const SYSTEM_PROMPT = `");
  expect(at, "no SYSTEM_PROMPT in wallClassify.ts").toBeGreaterThan(-1);
  const from = source.indexOf("`", at) + 1;
  const to = source.indexOf("`;", from);
  expect(to, "the system prompt never closes").toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("what the wall classifier is asked", () => {
  const prompt = systemPrompt();

  it("READS A PROMPT AT ALL — an empty parse would pass every rule below", () => {
    expect(prompt.length, "the prompt parsed to nothing").toBeGreaterThan(400);
  });

  it("GIVES THE SHAPE RULE, which covers what the list does not", () => {
    expect(prompt).toMatch(/two parallel lines/i);
    expect(prompt, "nothing says a closed or tapering outline is an object").toMatch(
      /closes on itself|tapers/i,
    );
  });

  it("DOES NOT DISQUALIFY A WALL FOR BENDING, which cost ten walls on one sheet", () => {
    // ── A REGRESSION GUARD WITH A MEASUREMENT BEHIND IT ──
    //
    // Prompt `.2` read "a wall is TWO STRAIGHT PARALLEL LINES" and "an outline
    // that curves ... is an OBJECT". That was written to catch a car's
    // bodywork and it was catching radius walls: graded on A-101 by
    // `bench/wallClassify.eval.ts`, NINE of the thirteen real walls it dropped
    // were consecutive chords of one 22ft-radius reception wall, each rejected
    // in as many words for being "part of a continuous curve, not a straight
    // run". `.3` moved the test from how it bends to what its outline does,
    // and the same sheet went from 13 walls lost to 3.
    //
    // So: the word STRAIGHT must not come back as the thing that defines a
    // wall, and the prompt must say outright that a curve is not by itself an
    // object.
    expect(prompt, "`straight` is defining a wall again — see wall-classify.3").not.toMatch(
      /two straight parallel lines/i,
    );
    expect(prompt, "nothing tells the model a radius wall is still a wall").toMatch(
      /curve is not by itself an object|concentric/i,
    );
  });

  it("NAMES THE THINGS REAL DRAWINGS PUT IN THE WAY", () => {
    // Each of these was returned as a wall on a drawing somebody looked at.
    for (const thing of ["vehicle", "counter", "cabinet", "fixture", "stair", "furniture", "grid"]) {
      expect(prompt.toLowerCase(), `the not-a-wall list no longer names ${thing}`).toContain(thing);
    }
  });

  it("ASKS WHAT IS MISSING, not only what is wrong", () => {
    expect(prompt, "it no longer asks for walls with no run on them").toMatch(/missing|no red line/i);
  });

  it("KEEPS THE VERSION AND THE LEDGER IN STEP", () => {
    // One constant, read by both. A literal in the action is a second spelling
    // that stops being true the moment the prompt moves.
    const action = readFileSync(ACTION, "utf8");
    expect(action, "the action records a hardcoded prompt version").toContain(
      "promptVersion: WALL_CLASSIFY_PROMPT_VERSION",
    );
    expect(action).not.toMatch(/promptVersion:\s*["'`]/);
    expect(WALL_CLASSIFY_PROMPT_VERSION).toMatch(/^wall-classify\.\d+$/);
  });
});

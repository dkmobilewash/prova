import { describe, expect, it } from "vitest";
import { TOOLS, type ToolId } from "./takeoff-plan-view";
import { RECIPES } from "./takeoff-recipes";

/**
 * `lib/takeoff-plan-view.ts` had no test of any kind.
 *
 * IT IS A UNIT TEST AND NOT A `.dbtest.ts`, deliberately, and the reason is
 * worth writing down because the file was on a list of "three query modules
 * with no coverage": it opens no database connection and has nothing to query.
 * It is pure types plus one constant — `TOOLS` — which exists because
 * `client-boundary.test.ts` fails the build when a server module imports a
 * plain value out of a `"use client"` module (it typechecks and then 500s in
 * production). A `.dbtest.ts` here would boot a Postgres to assert an array.
 *
 * What IS worth holding: the measuring vocabulary, and the decision recorded
 * in that file's own header — THERE IS NO CEILING TOOL, because a traced
 * polygon has an area and not a length and a width, and inventing them from a
 * bounding box is the guess this codebase refuses everywhere else. That
 * sentence is a comment today. Below it is a test.
 */

const ids = TOOLS.map((tool) => tool.id);

describe("the takeoff viewer's tool list", () => {
  it("offers exactly the five tools the ToolId union names", () => {
    // Written out rather than derived from TOOLS, so the two have to agree —
    // a list checked against itself is the census that asserts nothing.
    const expected: ToolId[] = ["pan", "calibrate", "linear", "area", "count"];
    expect(ids).toEqual(expected);
  });

  it("gives every tool a label and a hint somebody can act on", () => {
    for (const tool of TOOLS) {
      expect(tool.label.trim(), `${tool.id} needs a label`).not.toBe("");
      // The hint is what the panel shows before the first click. An empty one
      // leaves a person looking at a drawing with no idea what to press.
      expect(tool.hint.trim().length, `${tool.id} needs a hint`).toBeGreaterThan(10);
      expect(tool.hint.trim().endsWith("."), `${tool.id}'s hint should read as a sentence`).toBe(true);
    }
  });

  it("has no ceiling tool, and no recipe pretends a polygon has a width", () => {
    // The decision this module's header records. A "ceiling" tool would have
    // to invent a length and a width from a traced outline.
    expect(ids).not.toContain("ceiling");
    expect(TOOLS.some((tool) => /ceiling/i.test(tool.label))).toBe(false);
    // And the recipe it would have fed still exists — for the TYPED takeoff
    // form on the estimate tab, which is handed dimensions rather than a
    // shape. That is why the exclusion lives in the component
    // (`PLAN_RECIPES`) rather than by deleting the recipe.
    expect(RECIPES.map((recipe) => recipe.id)).toContain("ceiling");
  });

  it("names only the three primitives the capture layer has, plus the two that measure nothing", () => {
    // `pan` moves and `calibrate` sets the scale; neither produces a
    // measurement, which is why `kindOf` in the viewer returns null for them.
    const measuring = ids.filter((id) => id !== "pan" && id !== "calibrate");
    expect(measuring).toEqual(["linear", "area", "count"]);
  });
});

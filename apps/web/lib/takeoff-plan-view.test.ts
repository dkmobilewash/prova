import { describe, expect, it } from "vitest";
import { printedScalesFromProposals, TOOLS, type ToolId } from "./takeoff-plan-view";
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
  it("offers exactly the tools the ToolId union names, in the order it draws them", () => {
    // Written out rather than derived from TOOLS, so the two have to agree —
    // a list checked against itself is the census that asserts nothing.
    //
    // THREE MORE SINCE THIS WAS WRITTEN, and the order on the row is the
    // order of work: move, scale, then the three that CREATE a measurement,
    // then the two that change one that already exists.
    const expected: ToolId[] = ["pan", "calibrate", "linear", "area", "rect", "count", "symbol", "edit", "cutout", "exclude", "workarea"];
    expect(ids).toEqual(expected);
  });

  it("keeps a kind for every tool that creates a measurement, and none for the two that do not", () => {
    // `rect` stores AREA geometry — a faster way to draw the same four
    // points, not a different thing to measure, so nothing downstream learns
    // about it. `edit` and `cutout` change a measurement that already exists
    // and create nothing, which is why they have no kind at all.
    const creates: ToolId[] = ["linear", "area", "rect", "count"];
    const changes: ToolId[] = ["edit", "cutout"];
    for (const id of creates) expect(ids, `${id} should be offered`).toContain(id);
    for (const id of changes) expect(ids, `${id} should be offered`).toContain(id);
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

  it("STILL STORES ONLY THE THREE PRIMITIVES, however many tools draw them", () => {
    // The capture layer has three kinds and this is what keeps it that way.
    // Four tools create a measurement and only three kinds exist, because
    // `rect` is a faster way to draw an AREA — a tool is a gesture, a kind is
    // a row in the database, and growing the first must not grow the second.
    //
    // `pan` moves, `calibrate` sets the scale, and `edit` and `cutout` change
    // what is already there; none of the four produces a new measurement,
    // which is why `kindOf` in the viewer returns null for all of them.
    // `symbol` ("Count like this") saves COUNT rows too — from its own panel,
    // one point per kept match, through the same action a clicked count uses —
    // so the capture layer's `kindOf` knows nothing of it and returns null.
    // `exclude` and `workarea` write a sheet exclusion, never a measurement: not a quantity.
    const NO_KIND: ToolId[] = ["pan", "calibrate", "edit", "cutout", "symbol", "exclude", "workarea"];
    const creating = ids.filter((id) => !NO_KIND.includes(id));
    expect(creating).toEqual(["linear", "area", "rect", "count"]);

    // And the kinds themselves, which is the claim that matters.
    const kindOf = (id: ToolId) =>
      id === "linear" ? "LINEAR" : id === "area" || id === "rect" ? "AREA" : id === "count" ? "COUNT" : null;
    expect([...new Set(creating.map(kindOf))].sort()).toEqual(["AREA", "COUNT", "LINEAR"]);
    for (const id of NO_KIND) expect(kindOf(id), `${id} must create nothing`).toBeNull();
  });
});

/**
 * THE TITLE-BLOCK SCALE, KEYED BY PAGE NUMBER AND NOT BY SHEET.
 *
 * #623 shipped this on `PlanSheet` and a click-through found it dead. A
 * `PlanSheet` is built from a `TakeoffPlanPage`, and the only thing that
 * creates one is saving a calibration — so on the FIRST calibration of a
 * sheet there was no row, no sheet, and no printed scale, which is precisely
 * when the comparison has something to say. Every other notice in that dialog
 * is computed from the draft line and the live page width, so the feature
 * looked healthy while the one addition that needed stored data was null.
 *
 * The field is deleted rather than patched, so `sheet?.printedScale` is a type
 * error now. These tests cover what is left that can still be got wrong: the
 * mapping.
 */
describe("the printed scale per page", () => {
  it("keeps the NEWEST reading for a page, which is the one the caller lists first", () => {
    // Proposals are append-only — a re-read inserts rather than overwrites —
    // so first-seen under a `createdAt desc` order is the current reading.
    expect(
      printedScalesFromProposals([
        { pageNumber: 1, proposedScale: '1/4" = 1\'-0"' },
        { pageNumber: 1, proposedScale: '1/8" = 1\'-0"' },
      ]),
    ).toEqual({ 1: '1/4" = 1\'-0"' });
  });

  it("keys by page number, so a page nobody has calibrated still has its scale", () => {
    // The regression, stated as a property: nothing here involves a sheet, a
    // calibration or a TakeoffPlanPage id.
    expect(printedScalesFromProposals([{ pageNumber: 7, proposedScale: '1" = 20\'' }])).toEqual({
      7: '1" = 20\'',
    });
  });

  it("skips a proposal with no scale rather than storing an empty answer", () => {
    // A key that exists with nothing behind it invites a caller to read
    // presence as an answer.
    expect(printedScalesFromProposals([{ pageNumber: 2, proposedScale: null }])).toEqual({});
  });

  it("lets a later page's real reading through when an earlier one had none", () => {
    expect(
      printedScalesFromProposals([
        { pageNumber: 3, proposedScale: null },
        { pageNumber: 3, proposedScale: '3/32" = 1\'-0"' },
      ]),
    ).toEqual({ 3: '3/32" = 1\'-0"' });
  });

  it("handles several pages at once and an empty set", () => {
    expect(
      printedScalesFromProposals([
        { pageNumber: 1, proposedScale: '1/4" = 1\'-0"' },
        { pageNumber: 2, proposedScale: "AS NOTED" },
      ]),
    ).toEqual({ 1: '1/4" = 1\'-0"', 2: "AS NOTED" });
    // "AS NOTED" is carried verbatim on purpose: deciding it names no scale is
    // `standardScaleFromText`'s job, and this map is not where judgement goes.
    expect(printedScalesFromProposals([])).toEqual({});
  });
});

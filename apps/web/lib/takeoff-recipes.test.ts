import { describe, expect, it } from "vitest";
import { findRecipe, RECIPES, recipeLines, type RecipeArgs } from "./takeoff-recipes";

describe("paint", () => {
  it("turns an area into gallons, rounded up, with primer at one coat", () => {
    // 700 sq ft, two coats, 350 sq ft/gal.
    const lines = recipeLines("paint", [{ kind: "area", squareFeet: 700 }], {
      coats: 2,
      coverageSqFtPerGal: 350,
    });
    expect(lines).toEqual([
      { label: "Paint", quantity: 4, unit: "gal" },
      { label: "Primer", quantity: 2, unit: "gal" },
    ]);
  });

  it("defaults to two coats and 350 sq ft/gal when the args are absent", () => {
    const lines = recipeLines("paint", [{ kind: "area", squareFeet: 350 }], {});
    expect(lines).toEqual([
      { label: "Paint", quantity: 2, unit: "gal" },
      { label: "Primer", quantity: 1, unit: "gal" },
    ]);
  });

  it("produces nothing for no area", () => {
    expect(recipeLines("paint", [{ kind: "area", squareFeet: 0 }], {})).toEqual([]);
  });
});

describe("flooring", () => {
  it("derives waste and underlayment from area, and trim from a perimeter", () => {
    const lines = recipeLines(
      "flooring",
      [
        { kind: "area", squareFeet: 100 },
        { kind: "linear", feet: 40 },
      ],
      { wastePercent: 10 },
    );
    expect(lines).toEqual([
      { label: "Flooring", quantity: 100, unit: "sq ft" },
      { label: "Flooring + waste", quantity: 110, unit: "sq ft" },
      { label: "Underlayment", quantity: 100, unit: "sq ft" },
      { label: "Trim / base", quantity: 40, unit: "lin ft" },
    ]);
  });

  it("omits trim rather than inventing a perimeter", () => {
    const lines = recipeLines("flooring", [{ kind: "area", squareFeet: 100 }], { wastePercent: 10 });
    expect(lines.map((l) => l.label)).not.toContain("Trim / base");
  });
});

describe("fixture count", () => {
  it("emits one line per counted item, dropping empty or non-positive counts", () => {
    const lines = recipeLines(
      "fixture-count",
      [
        { kind: "count", item: "Outlets", count: 12 },
        { kind: "count", item: "Light fixtures", count: 5 },
        { kind: "count", item: "", count: 3 },
        { kind: "count", item: "Doors", count: 0 },
      ],
      {},
    );
    expect(lines).toEqual([
      { label: "Outlets", quantity: 12, unit: "ea" },
      { label: "Light fixtures", quantity: 5, unit: "ea" },
    ]);
  });
});

describe("wall and ceiling", () => {
  it("delegates a wall to the existing lib/takeoff.ts arithmetic", () => {
    // 20 ft x 9 ft, both sides, default waste/stud spacing: 360 sq ft of
    // board, 13 sheets, 16 studs, 40 lin ft of track.
    const lines = recipeLines(
      "wall",
      [{ kind: "wall", wall: { lengthFt: 20, heightFt: 9, sides: 2 } }],
      {},
    );
    expect(lines).toEqual([
      { label: "Drywall area", quantity: 360, unit: "sq ft" },
      { label: "Drywall sheets", quantity: 13, unit: "sheets" },
      { label: "Studs", quantity: 16, unit: "ea" },
      { label: "Track", quantity: 40, unit: "lin ft" },
    ]);
  });

  it("delegates a ceiling to the existing lib/takeoff.ts arithmetic", () => {
    const lines = recipeLines(
      "ceiling",
      [{ kind: "ceiling", ceiling: { lengthFt: 30, widthFt: 20 } }],
      {},
    );
    expect(lines).toEqual([
      { label: "Ceiling area", quantity: 600, unit: "sq ft" },
      { label: "Drywall sheets", quantity: 21, unit: "sheets" },
    ]);
  });
});

describe("the recipe table", () => {
  it("knows every recipe by id, and only by a real id", () => {
    for (const recipe of RECIPES) {
      expect(findRecipe(recipe.id)?.id).toBe(recipe.id);
    }
    expect(findRecipe("not-a-recipe")).toBeUndefined();
    expect(recipeLines("not-a-recipe", [], {} as RecipeArgs)).toEqual([]);
  });

  it("labels each recipe with a trade, so a scope is a tag not a branch", () => {
    expect(RECIPES.every((recipe) => recipe.trade.length > 0)).toBe(true);
  });
});

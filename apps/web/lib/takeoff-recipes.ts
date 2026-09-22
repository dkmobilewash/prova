/**
 * Trade-agnostic takeoff: primitives in, material lines out.
 *
 * The point of this file is that adding a scope is adding a RECIPE — a data
 * definition — not writing a new code path. A recipe says which measurements
 * it consumes, and a pure function turns them into material lines. Everything
 * here is pure: no database, no Server Action, no fetch, so the numbers a bid
 * rests on can be checked without one (the same contract as lib/takeoff.ts,
 * lib/wip.ts and lib/retainage.ts).
 *
 * The three primitives — linear feet, square feet, and a count — are the whole
 * measurement vocabulary. A wall or a ceiling keeps its richer structured
 * shape (it is not just a length), but paint, flooring, drywall area and
 * fixture counts all reduce to one of the three. Phase 2's on-screen capture
 * and Phase 3's AI read will both produce primitives; they will never produce
 * materials directly. That division is where the accuracy lives: the capture
 * is the fuzzy part a person confirms, and the recipe math is the exact,
 * deterministic part that can never drift.
 */

import { takeoffCeiling, takeoffWall, type TakeoffLine, type WallInput } from "./takeoff";

/** Feet. Everything dimensional in this file is feet / square feet — mixing
 * units is how a takeoff produces a number that is exactly twelve times wrong
 * (same rule as lib/takeoff.ts). */
export type Feet = number;
export type SquareFeet = number;

/** The three primitives a takeoff measures, whatever the scope. */
export type Primitive =
  | { kind: "linear"; feet: Feet }
  | { kind: "area"; squareFeet: SquareFeet }
  | { kind: "count"; count: number; item: string };

/** What a recipe is handed: the linear/area/count primitives, plus the two
 * structured measurements that were already built (a wall, a ceiling) which
 * keep their richer shape rather than being flattened into a bare length. */
export type RecipeInput =
  | Primitive
  | { kind: "wall"; wall: WallInput }
  | { kind: "ceiling"; ceiling: { lengthFt: Feet; widthFt: Feet } };

/** Recipe arguments. Every key is a shop-varying number; a value of
 * `undefined` means "not given, use the recipe's own default" — which keeps a
 * hidden default out of the form while still letting the recipe own its
 * baseline (waste 10%, two coats, 350 sq ft/gal, stud spacing 16" o.c.). */
export type RecipeArgs = Record<string, number | undefined>;

export type Recipe = {
  id: string;
  /** Which scope this recipe prices. A tag, not a schema field — adding a
   * scope is adding a recipe with its own trade label, no code branch. */
  trade: string;
  /** Human label for the form selector. */
  label: string;
  /** Pure: turns the recipe's inputs + args into material lines. */
  lines: (inputs: RecipeInput[], args: RecipeArgs) => TakeoffLine[];
};

/** Two decimals, so a quantity reads like a quantity rather than like a
 * float. Counts are integers and pass through untouched. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumArea(inputs: RecipeInput[]): SquareFeet {
  return inputs
    .filter((i): i is Extract<Primitive, { kind: "area" }> => i.kind === "area")
    .reduce((sum, i) => sum + i.squareFeet, 0);
}

function sumLinear(inputs: RecipeInput[]): Feet {
  return inputs
    .filter((i): i is Extract<Primitive, { kind: "linear" }> => i.kind === "linear")
    .reduce((sum, i) => sum + i.feet, 0);
}

/** The recipes, in the order they're offered in the form. The wall and
 * ceiling entries wrap the existing lib/takeoff.ts arithmetic, so a bid's
 * numbers are computed in exactly one place whether they were typed here or
 * through the old wall/ceiling form. */
export const RECIPES: Recipe[] = [
  {
    id: "wall",
    trade: "drywall",
    label: "Wall (drywall)",
    lines: (inputs, args) => {
      const wall = inputs.find((i): i is Extract<RecipeInput, { kind: "wall" }> => i.kind === "wall");
      if (!wall) return [];
      return takeoffWall(wall.wall, {
        wastePercent: args.wastePercent,
        spacingFt: args.spacingFt,
      });
    },
  },
  {
    id: "ceiling",
    trade: "drywall",
    label: "Ceiling (drywall)",
    lines: (inputs, args) => {
      const ceiling = inputs.find((i): i is Extract<RecipeInput, { kind: "ceiling" }> => i.kind === "ceiling");
      if (!ceiling) return [];
      return takeoffCeiling(ceiling.ceiling, { wastePercent: args.wastePercent });
    },
  },
  {
    id: "paint",
    trade: "paint",
    label: "Paint",
    lines: (inputs, args) => {
      const area = sumArea(inputs);
      const coats = args.coats ?? 2;
      const coverage = args.coverageSqFtPerGal ?? 350;
      if (area <= 0 || coverage <= 0) return [];
      // Gallons are rounded UP: a partial gallon is a full gallon bought.
      return [
        { label: "Paint", quantity: Math.ceil((area * coats) / coverage), unit: "gal" },
        { label: "Primer", quantity: Math.ceil(area / coverage), unit: "gal" },
      ];
    },
  },
  {
    id: "flooring",
    trade: "flooring",
    label: "Flooring",
    lines: (inputs, args) => {
      const area = sumArea(inputs);
      const perimeter = sumLinear(inputs);
      const waste = args.wastePercent ?? 10;
      if (area <= 0) return [];
      const lines: TakeoffLine[] = [
        { label: "Flooring", quantity: round2(area), unit: "sq ft" },
        { label: "Flooring + waste", quantity: round2(area * (1 + waste / 100)), unit: "sq ft" },
        { label: "Underlayment", quantity: round2(area), unit: "sq ft" },
      ];
      // Trim only when a perimeter was actually measured — inventing one
      // would be the same guess this file refuses everywhere else.
      if (perimeter > 0) lines.push({ label: "Trim / base", quantity: round2(perimeter), unit: "lin ft" });
      return lines;
    },
  },
  {
    id: "fixture-count",
    trade: "general",
    label: "Fixture count",
    lines: (inputs) =>
      inputs
        .filter((i): i is Extract<Primitive, { kind: "count" }> => i.kind === "count")
        .filter((i) => i.item.trim() !== "" && i.count > 0)
        .map((i) => ({ label: i.item.trim(), quantity: i.count, unit: "ea" })),
  },
];

export function findRecipe(id: string): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.id === id);
}

/** Runs one recipe. The single entry point both the client preview and the
 * Server Action call, so the number shown before saving and the number saved
 * cannot drift apart (a preview that disagrees with the row it creates is
 * worse than no preview — see estimate-labor-cost.ts for the same reasoning). */
export function recipeLines(recipeId: string, inputs: RecipeInput[], args: RecipeArgs): TakeoffLine[] {
  const recipe = findRecipe(recipeId);
  if (!recipe) return [];
  return recipe.lines(inputs, args);
}

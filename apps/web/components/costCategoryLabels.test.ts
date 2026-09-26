import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COST_CATEGORY_LABEL,
  COST_CATEGORY_ORDER,
  costCategoryLabel,
} from "./costCategoryLabels";

/**
 * The label table is exhaustive over the enum AS THE SCHEMA DECLARES IT.
 *
 * That is the whole point of this file, and the reason it opens a .prisma
 * file rather than importing a TypeScript union. `CostCategory` in
 * `costCategoryLabels.ts` is a hand-written union — checking the table
 * against it would be checking the table against itself, and would pass
 * happily on any pair of matching mistakes. The database is what decides
 * which values can ever arrive at `costCategoryLabel`, so the database's
 * own declaration is the source this asserts against.
 *
 * Why it matters at all: the four values were rendered RAW until
 * 2026-09-21 — a picker offering "LABOR" and "SUBCONTRACTOR" in capitals,
 * and "(SUBCONTRACTOR)" printed beside every logged cost on the Estimate
 * tab. A fifth value added to the schema without a label here would put
 * another one on screen, which is the failure this file makes loud.
 */

const schemaPath = fileURLToPath(
  new URL("../../../packages/db/prisma/schema/jobs.prisma", import.meta.url),
);

/**
 * The enum body as the schema file writes it.
 *
 * Deliberately anchored on `enum CostCategory {` and read to the closing
 * brace rather than pattern-matched across the file: a regex over a whole
 * schema is one formatting change away from matching nothing, and a parse
 * that returns an empty set makes every assertion below vacuously true —
 * the exact shape `scratch-cleanup-order.test.ts` was caught by. The
 * length check on the result is what turns that into a failure.
 */
function costCategoryValuesFromSchema(): string[] {
  const schema = readFileSync(schemaPath, "utf8");
  const start = schema.indexOf("enum CostCategory {");
  expect(start, `no "enum CostCategory {" in ${schemaPath}`).toBeGreaterThan(-1);
  const end = schema.indexOf("}", start);
  expect(end, "enum CostCategory has no closing brace").toBeGreaterThan(start);
  return schema
    .slice(start + "enum CostCategory {".length, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("///"));
}

describe("every cost category has a word a contractor would say", () => {
  it("parses the enum out of the schema at all", () => {
    // Anti-vacuity, and a FLOOR rather than an exact count on purpose. Its only
    // job is to prove the parse returned something real, because a parse
    // returning [] would make the two cases below pass on an empty table. The
    // census is the next case, which compares the parsed set against the label
    // table both ways — so an exact number here adds nothing and costs a red
    // build every time the enum legitimately grows. It was `toBe(4)` and
    // EQUIPMENT made it red on 2026-09-26 while the real census was fine.
    expect(costCategoryValuesFromSchema().length).toBeGreaterThanOrEqual(4);
  });

  it("labels exactly the values the schema declares — no more, no fewer", () => {
    const fromSchema = costCategoryValuesFromSchema().sort();
    expect(Object.keys(COST_CATEGORY_LABEL).sort()).toEqual(fromSchema);
    expect([...COST_CATEGORY_ORDER].sort()).toEqual(fromSchema);
  });

  it("never leaves a raw SCREAMING_SNAKE value on screen", () => {
    for (const value of costCategoryValuesFromSchema()) {
      const label = costCategoryLabel(value);
      expect(label).not.toBe(value);
      expect(label).not.toMatch(/^[A-Z_]+$/);
      expect(label).not.toContain("_");
    }
  });

  it("shows an unknown value rather than mis-filing it or losing it", () => {
    // Ugly exactly where somebody will see it and fix it. "Other" would
    // quietly mis-file a cost; "" would lose it.
    expect(costCategoryLabel("EQUIPMENT_RENTAL")).toBe("EQUIPMENT_RENTAL");
  });
});

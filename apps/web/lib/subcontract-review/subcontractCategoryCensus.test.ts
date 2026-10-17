import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUBCONTRACT_FINDING_CATEGORIES, SUBCONTRACT_SEVERITIES } from "@prova/integrations/src/subcontractCategories";
import { SOURCE_ROLES } from "./roles";
import { SUBCONTRACT_CATEGORY_LABEL } from "./findings";

/**
 * ONE LIST PER VOCABULARY, AND THE SCHEMA AGREES WITH IT.
 *
 * Both guards CLAUDE.md asks for after #526: that the canonical list is
 * complete against the database enum, and that NO SECOND LIST exists — a
 * completeness test cannot see a consumer that stopped reading the shared one.
 * The second guard looks for the signature of a hand-rolled copy: three or more
 * category names written as STRING LITERALS in one file. The legitimate
 * consumers use them as object KEYS (identifiers, not literals) or import them.
 */

const schemaDir = fileURLToPath(new URL("../../../../packages/db/prisma/schema/", import.meta.url));
const schema = readFileSync(join(schemaDir, "subcontract-review.prisma"), "utf8");

function enumMembers(name: string): string[] {
  const block = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`));
  expect(block, `enum ${name} is not in subcontract-review.prisma in the shape this census reads`).toBeTruthy();
  return block![1]!
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => /^[A-Z_]+$/.test(line));
}

describe("subcontract review vocabulary", () => {
  it("has one category list, equal to the Prisma enum", () => {
    const members = enumMembers("SubcontractFindingCategory");
    expect(members.length, "parsed no members at all").toBeGreaterThan(10);
    expect(members).toEqual([...SUBCONTRACT_FINDING_CATEGORIES]);
  });

  it("has severities and source roles equal to their Prisma enums", () => {
    expect(enumMembers("SubcontractFindingSeverity")).toEqual([...SUBCONTRACT_SEVERITIES]);
    expect(enumMembers("SubcontractReviewSourceRole")).toEqual([...SOURCE_ROLES]);
  });

  it("labels every category", () => {
    expect(Object.keys(SUBCONTRACT_CATEGORY_LABEL).sort()).toEqual([...SUBCONTRACT_FINDING_CATEGORIES].sort());
  });

  it("has no second hand-written category list anywhere in the app or the integrations package", () => {
    const roots = [
      fileURLToPath(new URL("../../", import.meta.url)),
      fileURLToPath(new URL("../../../../packages/integrations/src/", import.meta.url)),
    ];
    const allowed = new Set(["subcontractCategories.ts"]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path);
      }
    };
    roots.forEach(walk);
    expect(files.length, "walked no files").toBeGreaterThan(200);

    const distinctive = SUBCONTRACT_FINDING_CATEGORIES.filter((c) => c.includes("_"));
    const copies = files.filter((file) => {
      if (allowed.has(file.split("/").pop()!)) return false;
      const code = readFileSync(file, "utf8");
      return distinctive.filter((c) => code.includes(`"${c}"`)).length >= 3;
    });
    expect(copies, `a second category list: ${copies.join(", ")}`).toEqual([]);
  });
});

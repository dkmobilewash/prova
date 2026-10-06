import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A PIN THAT CANNOT BE FOUND FROM THE ITEM IS WRITE-ONLY.
 *
 * You can mark a punch item's exact spot on the contract drawing, and then
 * have no route back to it from the item — which is the half of a link people
 * build last and often not at all. `PunchListItem.area` is free text,
 * *"Level 3 corridor"*, and the pin is the same answer with a point on it; the
 * item has to show both while both exist.
 *
 * This is a presence census and says so. It cannot prove the link renders or
 * that the href resolves — only a browser does that. What it stops is the
 * query being trimmed back ("nothing reads `sheetPins`") and the row quietly
 * losing the one route that makes pinning worth doing.
 */

const WEB = join(__dirname, "..");

function code(rel: string): string {
  return readFileSync(join(WEB, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("a pinned punch item says where it is", () => {
  it("loads the pin with the item, at most one", () => {
    const page = code("app/(app)/punch-lists/page.tsx");
    expect(page, "the punch list no longer reads where its items are pinned").toMatch(/sheetPins:\s*\{/);
    // `take: 1` is not an optimisation, it is the unique index restated: an
    // item has ONE location. If that ever becomes many, this row has to decide
    // which to show, and silently showing the first would be wrong.
    expect(page, "the pin query no longer takes exactly one").toMatch(/sheetPins:\s*\{[\s\S]{0,80}take:\s*1/);
  });

  it("gives the row a link to the drawing", () => {
    const row = code("components/PunchListRow.tsx");
    expect(row, "the row no longer receives where the item is pinned").toMatch(/pinnedOn/);
    expect(
      row,
      "the row no longer links to the drawing — the pin becomes write-only, which is the whole " +
        "defect this file exists to prevent",
    ).toMatch(/href=\{`\/drawings\/\$\{item\.pinnedOn\.revisionId\}`\}/);
  });

  it("still renders the free-text area beside it", () => {
    // Both, while both exist: an item raised before pinning has only the text,
    // and one raised ON the drawing has only the pin. Dropping either leaves
    // somebody's location invisible.
    expect(code("components/PunchListRow.tsx"), "the free-text area stopped rendering").toMatch(/\{item\.area\}/);
  });
});

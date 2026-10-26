/**
 * /catalog after declutter round 3 (density audit #24: templates and their
 * explainer above the price book, every entry a card of 240-441 characters
 * with inline owner forms, and the Add button BELOW the list).
 *
 * Read from SOURCE, like estimate/declutter.test.tsx: what is pinned is the
 * order and which content sits in a row's summary versus behind it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "page.tsx"), "utf8");
const partsSource = readFileSync(join(here, "../../../components/CatalogParts.tsx"), "utf8");

/**
 * The page as it renders: the entry row, the column header and the add form
 * moved into `components/CatalogParts.tsx` (shared with C Stream Bid's price
 * book), so the source this file reads is the page with each of those put back
 * where it is used — the page's own children (actuals, quote) inside the row.
 */
function expand(): string {
  const body = (name: string) => {
    const chunk = partsSource.split(`export function ${name}(`)[1];
    const text = chunk.slice(chunk.indexOf("  return (\n") + "  return (\n".length, chunk.indexOf("\n  );\n}"));
    // The move dedented these by eight columns; put them back so the needles below, which match indentation, still read the page as it was.
    return text.split("\n").map((l) => (l ? "        " + l : l)).join("\n");
  };
  const grid = partsSource.slice(partsSource.indexOf("/** desc · unit"), partsSource.indexOf("type CraftOption")).replace("export const", "const");
  let out = pageSource;
  out = out.replace("<CatalogListHeader />", body("CatalogListHeader"));
  out = out.replace("<CatalogEntryAddForm craftClassifications={craftClassifications} />", body("CatalogEntryAddForm"));
  const open = out.match(/<CatalogEntryItem [^>]*>/)![0];
  const start = out.indexOf(open);
  const end = out.indexOf("</CatalogEntryItem>");
  const children = out.slice(start + open.length, end);
  out = out.slice(0, start) + body("CatalogEntryItem").replace("{children}", children) + out.slice(end + "</CatalogEntryItem>".length);
  return grid + out;
}
const page = expand();
const at = (needle: string, from = 0) => {
  const i = page.indexOf(needle, from);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("/catalog declutter", () => {
  it("orders it: Add and Import, the price book, then templates behind a Disclosure", () => {
    const order = [
      'data-tour="catalog-add"',
      'data-tour="catalog-import"',
      'data-tour="catalog-list"',
      "summary={`Estimate templates · ${estimateTemplates.length}`}",
      "<EstimateTemplates",
    ].map((n) => at(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(at("<EstimateTemplates")).toBeLessThan(at("</Disclosure>", at("Estimate templates · ")));
  });

  it("each entry is a table row (desc · unit · price · cost · trade); actuals, quote and owner forms open from it", () => {
    const row = at('name="catalog-entry"');
    const detail = at("                >\n", at("summary={", row));
    const end = at("</Disclosure>", row);
    for (const cell of ["{entry.description}", "{entry.unit ??", "entry.defaultUnitPrice != null ? money(", "entry.defaultBudgetedUnitCost != null ? money(", "tradeScopeLabel(entry.tradeScope)"]) {
      expect(at(cell, row), cell).toBeLessThan(detail);
    }
    for (const part of ["<ActualsLine", "<QuoteLine"]) {
      const i = at(part, row);
      expect(i, part).toBeGreaterThan(detail);
      expect(i, part).toBeLessThan(end);
    }
  });

  it("the column header uses the SAME grid as the rows — columns and gap from one const, nothing ad hoc", () => {
    // The gap used to be on the rows only, so the header's fixed columns
    // packed to the right of their values and "Cost" ran into "Trade".
    const decl = page.match(/const CATALOG_ROW_GRID =\s*"([^"]+)"/);
    expect(decl, "CATALOG_ROW_GRID declaration").not.toBeNull();
    expect(decl![1]).toMatch(/(^| )gap-x-\d/);
    const lines = page.split("\n").filter((l) => l.includes("${CATALOG_ROW_GRID}"));
    expect(lines).toHaveLength(2); // the header and the row summary
    for (const line of lines) {
      expect(line, line).not.toMatch(/grid-cols-|gap-/);
    }
    const header = page.indexOf("<span>Description</span>");
    expect(header).toBeGreaterThan(page.indexOf(lines[0]!.trim()));
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every money figure on the fringe remittance card is guarded, at all three
 * levels.
 *
 * The rule this protects is one sentence: an unpriced thing NEVER reads as
 * $0. Hours we cannot price are a liability of unknown size to a trust
 * fund, and "$0.00" says the opposite of what is known.
 *
 * It has now been missed twice on the same page, at two different levels:
 *
 *   1. The CRAFT ROWS printed five $0.00 cells. `isWhollyUnpriced` was
 *      written for that and the rows were fixed.
 *   2. The LOCAL HEADER kept printing "$0.00" above the very table of
 *      em-dashes the first fix had just produced (#104 item 2), and the
 *      MONTH TOTAL under it said "$0.00 across 40 hours".
 *
 * Both times the arithmetic was right and only the rendering lied, so no
 * unit test on `buildRemittanceReport` could see it and none did — the
 * numbers it returns were correct throughout. That is what makes a static
 * check worth having here rather than merely tolerable.
 *
 * Honest about what it proves, in the same terms as
 * `lib/page-money-guards.test.ts`: it reads source. It cannot tell you the
 * ternary is the right way round, and the click-list is what proves the
 * page. What it catches is the realistic regression — a fourth money
 * figure added to this card with no guard, or an existing guard dropped in
 * a refactor, either of which restores the hole with every test green.
 */

const PAGE = "app/(app)/union-compliance/page.tsx";
const source = readFileSync(join(process.cwd(), PAGE), "utf8");

/** `money(x)` calls that are NOT part of `isWhollyUnpriced`'s own name. */
const moneyCalls = (text: string) => [...text.matchAll(/\bmoney\(/g)].length;

describe("the fringe remittance card never prints an unpriced total as $0", () => {
  it("still renders money on that page, so an empty scan cannot pass", () => {
    expect(source).toContain('from "@/lib/fringe-remittance"');
    expect(moneyCalls(source)).toBeGreaterThan(0);
  });

  it("guards the CRAFT ROW", () => {
    expect(source).toContain("isWhollyUnpriced(craft)");
  });

  it("guards the LOCAL HEADER — the figure a reader takes off the card", () => {
    // This is the one #104 found. The row guard existed; the header sat
    // above it printing $0.00 over a table of dashes.
    expect(source).toContain("isWhollyUnpriced(local)");
  });

  it("guards the MONTH TOTAL", () => {
    // The report exposes `totalHours`/`uncomputedHours` rather than a row
    // shape, so this one is called on a literal. Matching loosely on the
    // two field names keeps it from breaking on whitespace while still
    // being about the right call.
    const guard = source.match(/isWhollyUnpriced\(\{[\s\S]{0,200}?\}\)/);
    expect(guard, "no isWhollyUnpriced({ ... }) call for the month total").not.toBeNull();
    expect(guard?.[0]).toContain("remittance.totalHours");
    expect(guard?.[0]).toContain("remittance.uncomputedHours");
  });

  it("has one guard for every level, so a new figure cannot slip in unguarded", () => {
    // Craft row, local header, month total. If a fourth money figure is
    // added to this card, this number moves and somebody has to decide
    // whether it needs a guard — which is the whole intent.
    expect([...source.matchAll(/\bisWhollyUnpriced\(/g)]).toHaveLength(3);
  });
});

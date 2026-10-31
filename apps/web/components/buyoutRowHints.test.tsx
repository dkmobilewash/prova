import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BuyoutFinding } from "@/lib/buyout-spec-check";
import type { BuyoutRow as Row } from "@/lib/purchase-orders";

vi.mock("@/lib/actions", () => ({}));
const { BuyoutRow, SpecFindingList } = await import("./BuyoutRow");

const finding: BuyoutFinding = {
  ordinal: 1, kind: "NAMED_PRODUCT", label: "Named board", requirement: "Use it", whyItCosts: "w", confidence: "HIGH",
  quote: "Gypsum board shall be USG Sheetrock Firecode X.", sourcePageLabel: "4", sectionNumber: "09 29 00",
};
const row = (notes: string | null): Row => ({
  line: { id: "l", description: "5/8 board", unit: "SF", quantity: 10, budgetedUnitCost: 1, costCategory: null, catalogEntryId: "c" },
  budget: 10, drafted: 0, committed: 0, quantityLeft: 10, offers: [], otherUnits: [],
  quoteTexts: [{ vendorName: "ABC", description: "Board", notes }],
});
const render = (notes: string | null) =>
  renderToStaticMarkup(<BuyoutRow jobId="j" row={row(notes)} vendors={[]} findings={[finding]} />).replace(/&#x27;/g, "'");

describe("the hint on a Buyout row", () => {
  it("shows a possible match on the closed row and in the list, with the text it hit", () => {
    const html = render("Excludes Firecode");
    expect(html).toContain("Spec says · 1 to compare before buying · 1 possible match");
    expect(html).toContain("Possible match: Firecode in ABC's quote.");
    expect(html).toContain("ABC · Board · Excludes Firecode");
  });

  it("shows no match found with where it looked", () => {
    const html = render(null);
    expect(html).toContain("· 1 no match found");
    expect(html).toContain("No match found for USG, Sheetrock and Firecode in the item and ABC's quote.");
  });

  it("gives a finding with no row no hint at all", () => {
    const html = renderToStaticMarkup(<SpecFindingList findings={[finding]} summary="s" />);
    expect(html).not.toMatch(/possible match|no match found/i);
  });
});

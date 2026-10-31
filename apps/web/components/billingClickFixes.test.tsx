import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { commitmentNote, type BuyoutRow as Row } from "@/lib/purchase-orders";

vi.mock("@/lib/actions", () => ({}));
const { BuyoutRow, PurchaseOrderActions } = await import("./BuyoutRow");

const doc = {} as Parameters<typeof PurchaseOrderActions>[0]["document"];
const offer = { quoteId: "q", vendorId: "v", vendorName: "Foundation", unitPrice: 0.75, quotedOn: "2026-10-01", extended: 0, overBudget: 0, cheapest: true };
const row = (quantityLeft: number) => ({
  line: { id: "l", description: "Board", unit: "SF", quantity: 10000, budgetedUnitCost: 0.8, costCategory: null, catalogEntryId: "c" },
  budget: 8000, drafted: 7500, committed: 0, quantityLeft, offers: [offer], otherUnits: [], quoteTexts: [],
}) as Row;
const page = readFileSync(join(__dirname, "../app/(app)/jobs/[id]/(tabs)/estimate/page.tsx"), "utf8");

describe("issuing and closing a PO", () => {
  it.each([
    ["ISSUED", "Date closed", "Close"],
    ["DRAFT", "Date issued", "Mark as issued"],
  ] as const)("on %s shows a labelled empty date box and holds the button until it is filled", (status, label, button) => {
    const html = renderToStaticMarkup(<PurchaseOrderActions id="p" status={status} document={doc} />);
    expect(html).toContain(label);
    expect(html).toMatch(/<input type="date"[^>]*value=""/);
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${button}</button>`));
  });

  it("offers no date on a closed PO", () => {
    expect(renderToStaticMarkup(<PurchaseOrderActions id="p" status="CLOSED" document={doc} />)).not.toContain('type="date"');
  });
});

describe("a line with nothing left to buy", () => {
  const render = (left: number) => renderToStaticMarkup(<BuyoutRow jobId="j" row={row(left)} vendors={[]} />);

  it("says so, and offers no $0.00 quote", () => {
    const html = render(0);
    expect(html).toContain("All 10000 is on a purchase order");
    expect(html).not.toContain("$0.00 ·");
    expect(html).not.toContain("lowest");
    expect(html).not.toContain("No current quote on file");
  });

  it("still offers quotes while any quantity is left", () => {
    expect(render(5)).toContain("Foundation");
  });
});

describe("the Estimate tab", () => {
  it("words a line's commitment, and says nothing when there is none", () => {
    expect(commitmentNote({ committed: 7500, drafted: 0, quantityBought: 1 })).toBe("Committed $7,500.00");
    expect(commitmentNote({ committed: 100, drafted: 18500, quantityBought: 1 })).toBe("Committed $100.00 · Drafted on a PO $18,500.00");
    expect(commitmentNote({ committed: 0, drafted: 0, quantityBought: 0 })).toBeNull();
    expect(commitmentNote(undefined)).toBeNull();
  });

  // Source only: no test here renders this page, so a person confirms it on screen.
  it("puts it in the row's summary, not its collapsed body, and loads rates at every stage", () => {
    const row = page.slice(page.indexOf('name="cost-line"'));
    expect(row.indexOf("commitmentNote(")).toBeGreaterThan(-1);
    expect(row.indexOf("commitmentNote(")).toBeLessThan(row.indexOf("summary={") + row.slice(row.indexOf("summary={")).indexOf("</span>\n                }"));
    expect(page).not.toMatch(/isEstimateStage \? prisma\.(jobBidRecap|companyBidDefaults)/);
  });
});

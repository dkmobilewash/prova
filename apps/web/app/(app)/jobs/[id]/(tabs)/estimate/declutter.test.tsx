/**
 * The Estimate tab after declutter round 2 (density audit #3 / #3b: 4.31 and
 * 4.44 screens, 61 live inputs on a bid — the AI draft box first, then every
 * line item as an open edit form; on a contracted job every line a WIP card
 * with two open forms).
 *
 * The page half is read from SOURCE, like crewTabDeclutter.test.ts: the page
 * is an async server component over Prisma and a dozen loaders, and what is
 * pinned here is its SHAPE — which form sits inside which row or behind which
 * button, and in what order. Disclosure/CollapsedForm behaviour has its own
 * tests. The BidRecapPanel half is a real render.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const at = (needle: string, from = 0) => {
  const i = page.indexOf(needle, from);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};
/** `needle` sits between `open` and the next `close` after it. */
const inside = (needle: string, open: string, close: string) => {
  const start = at(open);
  const i = at(needle, start);
  expect(i, `${needle} is not inside ${open}`).toBeLessThan(page.indexOf(close, start));
};

describe("Estimate tab — a bid", () => {
  it("opens each line's existing edit form from a summary row, one at a time", () => {
    inside("<ActionForm action={updateLineItemWithId(item.id)}", '<Disclosure\n                  key={item.id}\n                  variant="row"\n                  name="estimate-line"', "</Disclosure>");
    // The row actions stay in the row's detail, not its summary.
    inside("saveLineItemAsCatalogEntry.bind(null, item.id)", 'name="estimate-line"', "</Disclosure>");
    inside("action={deleteLineItemWithId(item.id)}", 'name="estimate-line"', "</Disclosure>");
  });

  it("puts the three add paths behind buttons, with one yellow primary", () => {
    inside("<ActionForm action={addLineItemWithId}", '<CollapsedForm label="Add line item">', "</CollapsedForm>");
    inside("<ActionForm action={addLineItemFromCatalogWithId}", '<CollapsedForm label="Add from catalog" tone="secondary">', "</CollapsedForm>");
    inside("<DraftLineItemsForm", '<CollapsedForm label="Draft line items from scope" tone="secondary">', "</CollapsedForm>");
    expect(page.match(/<CollapsedForm label="[^"]+">/g)).toEqual(['<CollapsedForm label="Add line item">']);
  });

  it("orders it: total, line table, add buttons, recap, lock-in, then the collapsed sections", () => {
    const order = [
      "Lines total",
      'name="estimate-line"',
      '<CollapsedForm label="Add line item">',
      "<DraftLineItemsForm",
      'data-tour="job-bid-recap"',
      'id="job-lock-in"',
      'data-tour="job-wall-schedule"',
      "Estimate versions</h2>",
      "<div className=\"mt-4\">{costingSection}</div>",
    ].map((n) => at(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("keeps Mark contracted on the page with no click, and the rates behind Edit rates", () => {
    // MarkContractedButton is not inside any Disclosure/CollapsedForm/details.
    const before = page.slice(0, at("<MarkContractedButton"));
    const opened = (tag: string) => (before.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
    const closed = (tag: string) => (before.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
    for (const tag of ["Disclosure", "CollapsedForm"]) expect(opened(tag), tag).toBe(closed(tag));
    inside("ratesCollapsed", "<BidRecapPanel", "/>");
  });

  it("collapses the wall schedule and the versions, every run and version still inside", () => {
    inside("<WallSchedule", 'data-tour="job-wall-schedule"', "</Disclosure>");
    inside("action={saveEstimateVersionWithId}", "Estimate versions</h2>", "</Disclosure>");
  });
});

describe("Estimate tab — contracted", () => {
  it("makes each line a row whose detail holds Log cost and Re-forecast, unchanged", () => {
    inside("<AddCostEntryForm", 'name="cost-line"', "</Disclosure>");
    inside("action={updateLineItemForecastWithId(item.id)}", 'name="cost-line"', "</Disclosure>");
    for (const head of ["Contract", "Actual", "% complete", "Earned"]) at(`>${head}</span>`);
  });

  it("keeps every job-level figure in the summary tile grid", () => {
    for (const label of ["Contract value", "Actual cost to date", "% complete", "Earned revenue", "Billed to date", "Over / under billed"]) {
      at(`>${label}</p>`);
    }
  });

  it("still renders the ChangeOrders section, which carries id=change-orders", () => {
    at("<ChangeOrders");
    const co = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../../../components/ChangeOrders.tsx"), "utf8");
    expect(co).toContain('<section id="change-orders"');
  });

  it("sends the burden link to the estimating settings tab", () => {
    expect(page).toContain('href="/settings?tab=estimating"');
    expect(page).not.toContain('href="/settings"');
  });
});

vi.mock("@/lib/actions", () => ({
  applyBidRecap: vi.fn(),
  saveBidRecap: vi.fn(),
  setLineBudgetedCost: vi.fn(),
  setLineCostCategory: vi.fn(),
}));
const { BidRecapPanel } = await import("@/components/BidRecapPanel");

describe("BidRecapPanel ratesCollapsed", () => {
  const props = { jobId: "job-1", lines: [], rates: {} as Parameters<typeof BidRecapPanel>[0]["rates"], applied: null };

  it("shows the rates form by default — the old behaviour", () => {
    const html = renderToStaticMarkup(<BidRecapPanel {...props} />);
    expect(html).toContain("Save rates");
    expect(html).not.toContain("Edit rates");
  });

  it("starts behind an Edit rates button when asked, with the recap table still shown", () => {
    const html = renderToStaticMarkup(<BidRecapPanel {...props} ratesCollapsed />);
    expect(html).toContain("Edit rates");
    expect(html).not.toContain("Save rates");
    expect(html).toContain("Bid total");
  });
});

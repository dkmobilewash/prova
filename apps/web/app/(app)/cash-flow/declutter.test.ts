/**
 * /cash-flow after declutter round 3 (density audit #23: the forecast the
 * page is named for sat at y=904, under a WIP-CSV explainer card; the AR
 * card printed one overdue figure three times — bucket, total, row).
 *
 * Read from SOURCE, like estimate/declutter.test.tsx: the page is an async
 * server component over Prisma, and what is pinned is its SHAPE. No figure
 * is computed here; every one is the same expression it was before.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const at = (needle: string, from = 0) => {
  const i = page.indexOf(needle, from);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("/cash-flow declutter", () => {
  it("leads with the forecast, then aging, then retainage, explainer last", () => {
    const order = [
      'data-tour="cash-flow-wip"',
      'data-tour="cash-flow-forecast"',
      'data-tour="cash-flow-aging"',
      'data-tour="cash-flow-retainage"',
      "What's in the WIP schedule (CSV)",
    ].map((n) => at(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("puts the CSV download in the header actions, not a card of its own", () => {
    const header = at("actions={", page.lastIndexOf('<PageHeader route="/cash-flow"'));
    const csv = at('href="/api/wip-schedule"', header);
    expect(csv).toBeLessThan(at("/>", csv));
    expect(page).not.toMatch(/<section[^>]*data-tour="cash-flow-wip"/);
  });

  it("states the AR total only when more than one bucket holds money, and keeps invoices one click away", () => {
    const guard = at(".filter((b) => agingSummary.byBucket[b] !== 0).length > 1 && (");
    expect(at("Total outstanding: {money(agingSummary.totalOutstanding)}", guard) - guard).toBeLessThan(200);
    const d = at("summary={`Outstanding invoices · ${sortedInvoices.length}`}");
    const rows = at("{sortedInvoices.map((row) => (", d);
    expect(rows).toBeLessThan(at("</Disclosure>", d));
  });
});

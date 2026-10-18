/**
 * /vendors/pricing after declutter round 3 (density audit #28: every item a
 * ~500px card, the same unit disclaimer repeated under each one).
 *
 * Read from SOURCE, like estimate/declutter.test.tsx: what is pinned is
 * which content sits in the row's summary and which behind it.
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

describe("/vendors/pricing declutter", () => {
  it("opens with one line; how current prices are worked out is in a Disclosure", () => {
    const lead = page.slice(at('data-vp="lead"'), at("</p>", at('data-vp="lead"')));
    const text = lead.replace(/<[^>]+>|\{" "\}|\s+/g, " ").replace(/\s+/g, " ");
    expect(text.length, text).toBeLessThanOrEqual(140);
    const disclosure = at('summary="How current prices are worked out"');
    const stored = at("Nothing here is stored as a");
    expect(stored).toBeGreaterThan(disclosure);
    expect(stored).toBeLessThan(at("</Disclosure>", disclosure));
    expect(at("</Disclosure>", disclosure)).toBeLessThan(at('data-tour="vp-record"'));
  });

  it("says the unit rule once, as a hint above the list, not under every item", () => {
    expect(page).not.toContain("Compared only within a unit.");
    expect(page.match(/<HintedText/g)).toHaveLength(1);
    expect(at('label="Prices are compared only within a unit"')).toBeLessThan(at('data-tour="vp-items"'));
  });

  it("each item is one row (item · cheapest · range · movement) and the detail opens from it", () => {
    const row = at('name="vendor-price-item"');
    const detail = at("              >\n", at("summary={", row));
    const end = at("</Disclosure>", row);
    // The summary carries the facts…
    for (const fact of ["{item.title}", "first.cheapest.unitPrice", "first.dearest.unitPrice", "movement.changePercent"]) {
      const i = at(fact, row);
      expect(i, fact).toBeLessThan(detail);
    }
    // …and the gap banner, live prices, movement and quotes are the detail.
    for (const part of ['data-tour="vp-catalog-gap"', 'data-tour="vp-live-prices"', 'data-tour="vp-movement"', "<VendorPriceQuoteRow"]) {
      const i = at(part, row);
      expect(i, part).toBeGreaterThan(detail);
      expect(i, part).toBeLessThan(end);
    }
  });
});

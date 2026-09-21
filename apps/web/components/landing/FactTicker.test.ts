/**
 * The fact ticker (FactTicker.tsx) is the one place on the landing page
 * that INVITES invented claims — "fun facts about why the software is
 * good" — so its list is held to rules stricter than the page's own, and
 * the mechanical half of them is enforced here rather than remembered.
 *
 * The page-wide invented-statistic guard in app/page.test.ts already runs
 * over this ticker's text (it is prose, not a `data-landing-panel`, so it
 * is not stripped). These tests are the stronger, ticker-specific half:
 * no numeral at all, no performance or comparison vocabulary, no count of
 * anything, and the accessibility shape — one real list, one hidden clone,
 * byte-identical, so a screen reader hears each fact once.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FACTS, FactTicker } from "./FactTicker";

const html = renderToStaticMarkup(createElement(FactTicker));

describe("FactTicker's list", () => {
  it("has between eight and fourteen facts, each short enough to read as it passes", () => {
    expect(FACTS.length).toBeGreaterThanOrEqual(8);
    expect(FACTS.length).toBeLessThanOrEqual(14);
    for (const fact of FACTS) {
      expect(fact.text.length, fact.text).toBeLessThanOrEqual(110);
      expect(fact.text.trim().length, "empty fact").toBeGreaterThan(20);
    }
  });

  it("names a source file for every fact — the receipt is not optional", () => {
    for (const fact of FACTS) {
      expect(fact.source, fact.text).toMatch(/\.(ts|tsx|prisma|md)\b/);
    }
  });

  it("contains no numeral anywhere — a fact that needs a digit is on its way to being a statistic", () => {
    for (const fact of FACTS) {
      // "WH-347" is a form NAME, not a quantity, and is the one allowed
      // digit sequence; everything else with a digit fails.
      expect(fact.text.replace(/WH-347/g, ""), fact.text).not.toMatch(/\d/);
    }
  });

  it("makes no performance, adoption or comparative claim", () => {
    const forbidden =
      /\b(faster|fastest|quicker|saves?|saving|percent|%|x\b|times (faster|more)|better than|unlike|competitors?|customers?|users?|trusted|hundreds|thousands|millions|will (soon|be able)|coming soon|roadmap)\b/i;
    for (const fact of FACTS) {
      expect(fact.text, fact.text).not.toMatch(forbidden);
    }
  });

  it("has no duplicate text", () => {
    expect(new Set(FACTS.map((f) => f.text)).size).toBe(FACTS.length);
  });
});

describe("FactTicker's markup", () => {
  it("renders every fact exactly twice — once for reading, once for the loop", () => {
    for (const fact of FACTS) {
      // renderToStaticMarkup escapes quotes and ampersands; the facts avoid
      // both, and this assertion is what says so if one is added.
      const count = html.split(fact.text).length - 1;
      expect(count, fact.text).toBe(2);
    }
  });

  it("hides exactly one of the two copies from assistive technology, and it is the clone", () => {
    const lists = html.match(/<ul[^>]*>/g) ?? [];
    expect(lists.length).toBe(2);
    const hidden = lists.filter((tag) => tag.includes('aria-hidden="true"'));
    expect(hidden.length).toBe(1);
    expect(hidden[0]).toContain("landing-ticker__clone");
    const real = lists.find((tag) => !tag.includes("aria-hidden"));
    expect(real).toBeDefined();
    expect(real).not.toContain("landing-ticker__clone");
  });

  it("is a labelled, focusable region so a keyboard user can pause it", () => {
    expect(html).toMatch(/<section[^>]*data-landing-ticker/);
    expect(html).toContain('aria-label="How C Stream is built"');
    expect(html).toMatch(/<section[^>]*tabindex="0"/);
  });

  it("parks nothing at opacity zero and inlines no style — the CSS owns every state", () => {
    expect(html).not.toMatch(/style=/);
    expect(html).not.toMatch(/opacity-0/);
  });
});

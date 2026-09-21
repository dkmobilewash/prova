/**
 * The two presentations of the six capabilities (components/CapabilitiesSection.tsx)
 * must stay in lockstep with each other and with the data — every count
 * below is DERIVED from CAPABILITIES.length rather than hardcoded, the
 * same discipline CLAUDE.md asks of scratch-cleanup-order.test.ts and
 * counterCensus.test.ts: a bare "6" in this file would rot the moment a
 * capability is added or removed, quietly passing a mismatched rail or
 * tab count.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { CapabilitiesSection, CAPABILITIES } = await import("./CapabilitiesSection");

const html = renderToStaticMarkup(createElement(CapabilitiesSection));

/** Matches how react-dom/server escapes text content, so a title or body
 * containing "&" or "'" can still be searched for verbatim. */
function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
}

describe("CapabilitiesSection", () => {
  it("the source data is non-empty — a guard with nothing to check is not a guard", () => {
    expect(CAPABILITIES.length).toBeGreaterThan(0);
  });

  it("the phone rail has exactly one card per capability", () => {
    const cardCount = (html.match(/<article /g) ?? []).length;
    expect(cardCount).toBe(CAPABILITIES.length);
  });

  it("the desktop switcher has exactly one <details> per capability, all in the same exclusive group", () => {
    const detailsCount = (html.match(/<details /g) ?? []).length;
    expect(detailsCount).toBe(CAPABILITIES.length);
    // Same `name` on every one is what makes the browser treat them as
    // mutually exclusive — a typo or a per-item name silently breaks that
    // with no error, so the count of the exact attribute must match too.
    const sameGroupCount = (html.match(/name="capability"/g) ?? []).length;
    expect(sameGroupCount).toBe(CAPABILITIES.length);
  });

  it("every capability's title and body appear in both the rail and the switcher", () => {
    for (const { title, body } of CAPABILITIES) {
      const titleOccurrences = html.split(escapeHtml(title)).length - 1;
      // At least once in the rail card, once in the tab label, once in the
      // tab's own content heading.
      expect(titleOccurrences).toBeGreaterThanOrEqual(3);
      expect(html).toContain(escapeHtml(body));
    }
  });

  it("exactly one tab starts open — a real first impression, not every panel collapsed", () => {
    const detailsOpenTags = html.match(/<details[^>]*>/g) ?? [];
    const openCount = detailsOpenTags.filter((tag) => tag.includes('open=""')).length;
    expect(openCount).toBe(1);
  });

  it("the rail is a real scroll container, reachable by keyboard, and names itself for a screen reader", () => {
    expect(html).toContain("landing-scroller");
    expect(html).toContain('tabindex="0"');
    expect(html).toMatch(/role="region"/);
    // The accessible name must CARRY THE REAL COUNT, derived. It was the
    // word "six" hardcoded in CapabilitiesRail.tsx, beside a list that
    // file cannot see; the list changed length and the label did not.
    // Asserting the derived number here is what makes that impossible to
    // repeat — a literal in this test would rot in exactly the same way.
    expect(html).toMatch(new RegExp(`aria-label="[^"]*${CAPABILITIES.length} capabilities[^"]*"`));
  });

  it("carries no fabricated claim — this is presentation, not new copy", () => {
    expect(html).not.toMatch(/trusted by|hundreds of|thousands of|testimonial/i);
  });
});

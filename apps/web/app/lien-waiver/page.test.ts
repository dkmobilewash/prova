/**
 * The lien waiver landing page (/lien-waiver). Rendered with NO Clerk mock
 * and no request scope, so a passing render is the proof it makes no auth
 * call — the same proof app/pilot/page.test.ts uses.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { priority: _priority, ...rest } = props;
    return createElement("img", rest);
  },
}));

const { default: Page } = await import("./page");
const html = renderToStaticMarkup(createElement(Page));
const text = html.replace(/<[^>]+>/g, " ");

describe("/lien-waiver", () => {
  it("renders signed out, with the headline and all four states", () => {
    expect(html).toContain("Filled in.");
    for (const state of ["Arizona", "California", "Nevada", "Texas"]) expect(html).toContain(state);
  });

  it("has one action, at nav, hero and close", () => {
    const buttons = html.match(/<a[^>]*bg-brand[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    const hrefs = new Set(buttons.map((b) => b.match(/href="([^"]+)"/)?.[1]));
    expect(hrefs.size).toBe(1);
  });

  it("invents no statistics", () => {
    expect(text.length).toBeGreaterThan(500);
    expect(text).not.toMatch(/\d+%|\d+\s*(minutes?|hours?|days?)\b/i);
  });
});

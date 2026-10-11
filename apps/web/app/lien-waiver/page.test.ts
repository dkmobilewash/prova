/**
 * The lien waiver landing page (/lien-waiver). Rendered with NO Clerk mock
 * and no request scope, so a passing render is the proof it makes no auth
 * call — the same proof app/pilot/page.test.ts uses.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const css = readFileSync(fileURLToPath(new URL("../../components/lienWaiverLanding.css", import.meta.url)), "utf8");

describe("/lien-waiver", () => {
  it("renders signed out, with the headline and all four waiver types", () => {
    expect(html).toContain("Make your lien waiver. Free.");
    for (const type of ["Conditional progress", "Unconditional progress", "Conditional final", "Unconditional final"]) {
      expect(html).toContain(type);
    }
  });

  it("names no state, so every sub reads it as theirs", () => {
    expect(text).not.toMatch(/\b(Arizona|California|Nevada|Texas)\b/);
  });

  it("has one action, repeated, and sign-in as a quiet link", () => {
    const buttons = html.match(/<a[^>]*bg-brand[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(new Set(buttons.map((b) => b.match(/href="([^"]+)"/)?.[1]))).toEqual(new Set(["/sign-up"]));
    expect(html).toContain('href="/sign-in"');
  });

  it("invents no statistics", () => {
    expect(text.length).toBeGreaterThan(1500);
    expect(text).not.toMatch(/\d+%|\d+\s*(minutes?|hours?|days?)\b/i);
  });

  it("animates only inside the reduced-motion gate, on transform and opacity, after Reveal says visible", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(at).toBeGreaterThan(-1);
    const outside = css.slice(0, at);
    const inside = css.slice(at);
    expect(outside).not.toMatch(/animation\s*:/);
    const rules = [...inside.matchAll(/([^{}]+)\{\s*animation\s*:/g)].map((m) => m[1].trim());
    expect(rules.length).toBe(4); // a regex matching nothing must not pass
    for (const selector of rules) expect(selector).toContain('[data-reveal="visible"]');
    const keyframes = [...inside.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n  \}/g)].map((m) => m[1]);
    expect(keyframes.length).toBe(4);
    for (const body of keyframes) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const prop of props) expect(["transform", "opacity"]).toContain(prop);
    }
  });

  it("never shows a dead tool link: unset means 'opening soon', no <a> to the tool", () => {
    expect(html).toContain('data-lien-waiver-tool="soon"');
    expect(html).not.toContain('data-lien-waiver-tool="live"');
    expect(html).not.toContain("/lien-waiver/start");
    expect(html).toContain("opening soon");
  });

  it("puts exactly one tool line under each sign-up row, never two in a row", () => {
    const rows = html.split(/data-lien-waiver-tool=/).length - 1;
    const signUps = (html.match(/<a[^>]*bg-brand[^>]*>/g) ?? []).length - 1; // minus the header button
    expect(rows).toBe(signUps);
    expect(html).not.toMatch(/data-lien-waiver-tool="soon"[\s\S]{0,400}data-lien-waiver-tool="soon"/);
  });

  it("links every tool line to LIEN_WAIVER_TOOL_URL when it is set, and keeps the yellow buttons on sign-up", () => {
    const url = "https://tool.example.test";
    process.env.LIEN_WAIVER_TOOL_URL = `  ${url}  `;
    try {
      const live = renderToStaticMarkup(createElement(Page));
      const toolLinks = live.match(/<a[^>]*href="https:\/\/tool\.example\.test"[^>]*>/g) ?? [];
      expect(toolLinks).toHaveLength(3);
      for (const link of toolLinks) expect(link).not.toContain("bg-brand");
      expect(live).not.toContain("opening soon");
      const yellow = live.match(/<a[^>]*bg-brand[^>]*>/g) ?? [];
      expect(new Set(yellow.map((b) => b.match(/href="([^"]+)"/)?.[1]))).toEqual(new Set(["/sign-up"]));
    } finally {
      delete process.env.LIEN_WAIVER_TOOL_URL;
    }
  });

  it("makes no legal assurances (the tool's own build bans the same wording)", () => {
    expect(text).not.toMatch(/\b(safe|guaranteed?|done right|risk-free|all set|ready to sign)\b/i);
  });
});

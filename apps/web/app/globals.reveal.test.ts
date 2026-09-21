/**
 * The landing page's reveal motion must be invisible to a reader who has
 * set prefers-reduced-motion: reduce — asserted here at the CSS layer,
 * independently of components/Reveal.test.ts's JS-layer proof, because
 * either one alone can regress without the other catching it: a future
 * edit could leave the JS check in place and still add an unguarded CSS
 * rule, or vice versa.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

/** Returns the contents of the first top-level `{ ... }` block starting at
 * `from` — brace-matched, not regex-guessed, so nested rules inside the
 * media query don't confuse it. */
function blockAt(source: string, from: number) {
  const start = source.indexOf("{", from);
  expect(start, "no opening brace found after the given index").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return { content: source.slice(start, i + 1), end: i };
    }
  }
  throw new Error("unterminated block");
}

describe("globals.css reveal motion is gated behind prefers-reduced-motion", () => {
  it("has exactly one prefers-reduced-motion: no-preference block", () => {
    const matches = css.match(/@media \(prefers-reduced-motion: no-preference\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("the pending/visible reveal rules live INSIDE that block, not at the top level", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    const { content, end } = blockAt(css, at);

    expect(content).toContain('[data-reveal="pending"]');
    expect(content).toContain('[data-reveal="visible"]');

    const outside = css.slice(0, at) + css.slice(end + 1);
    expect(outside).not.toContain('[data-reveal="pending"]');
    expect(outside).not.toContain('[data-reveal="visible"]');
  });

  it("the hidden state only ever sets opacity/transform — nothing that would reflow layout", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    const { content } = blockAt(css, at);
    const pendingRule = content.slice(content.indexOf('[data-reveal="pending"]'), content.indexOf('[data-reveal="visible"]'));
    expect(pendingRule).toMatch(/opacity:\s*0/);
    expect(pendingRule).toMatch(/transform:/);
    expect(pendingRule).not.toMatch(/\b(width|height|top|left|margin|display)\s*:/);
  });

  it("motion tokens are defined once, at :root, and the reveal transition is built from them rather than a hardcoded curve", () => {
    expect((css.match(/--ease-landing:/g) ?? []).length).toBe(1);
    expect((css.match(/--ease-landing-snap:/g) ?? []).length).toBe(1);
    expect((css.match(/--speed-slow:/g) ?? []).length).toBe(1);
    expect((css.match(/--speed-fast:/g) ?? []).length).toBe(1);
    // The reveal transition references the tokens rather than a literal
    // duration/curve — a hardcoded "0.7s" or a bare cubic-bezier(...) here
    // would be the ad-hoc-per-component curve this file exists to end.
    expect(css).toContain("var(--speed-slow) var(--ease-landing)");
    const revealBlock = css.slice(
      css.indexOf('[data-reveal="visible"]'),
      css.indexOf("}", css.indexOf('[data-reveal="visible"]')),
    );
    expect(revealBlock).not.toMatch(/cubic-bezier/);
    expect(revealBlock).not.toMatch(/\d+(\.\d+)?s\b/);
  });
});

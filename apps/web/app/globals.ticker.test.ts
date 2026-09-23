/**
 * The fact ticker's motion (components/landing/FactTicker.tsx) must be
 * invisible to a reader who set prefers-reduced-motion: reduce, and the
 * list must be complete and readable for them — not a frozen marquee with
 * items clipped off the right edge. Asserted at the CSS layer, the same way
 * globals.reveal.test.ts guards the reveal, and for the same reason: there
 * is no JS layer here at all, so this file is the only guard.
 *
 * Two properties, each of which could regress alone:
 *   1. every rule that MOVES or CLIPS lives inside the one
 *      `prefers-reduced-motion: no-preference` block;
 *   2. the rules OUTSIDE it draw a wrapped list with the clone hidden, and
 *      come BEFORE the block in source order — same specificity means the
 *      later rule wins, so a static `flex-wrap: wrap` written after the
 *      block would silently defeat the motion's `nowrap`. That is how the
 *      first draft of this CSS was wrong, and nothing but a browser would
 *      have said so.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

function blockAt(source: string, from: number) {
  const start = source.indexOf("{", from);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return { content: source.slice(start, i + 1), start, end: i };
    }
  }
  throw new Error("unterminated block");
}

const mediaAt = css.indexOf("@media (prefers-reduced-motion: no-preference)");
const media = blockAt(css, mediaAt);
const outside = css.slice(0, mediaAt) + css.slice(media.end + 1);
const before = css.slice(0, mediaAt);

describe("globals.css fact ticker motion is gated behind prefers-reduced-motion", () => {
  it("the animation, the clip, the mask and the pause all live INSIDE the no-preference block", () => {
    for (const needle of [
      "@keyframes landing-ticker",
      "animation: landing-ticker",
      "animation-play-state: paused",
      ".landing-ticker__viewport",
      "mask-image:",
    ]) {
      expect(media.content, needle).toContain(needle);
      expect(outside, `${needle} leaked outside the media block`).not.toContain(needle);
    }
    expect(outside).not.toMatch(/overflow:\s*hidden[^}]*landing-ticker|landing-ticker[^}]*overflow:\s*hidden/);
  });

  it("the keyframes move transform only, and by exactly half the track", () => {
    const kf = blockAt(media.content, media.content.indexOf("@keyframes landing-ticker"));
    expect(kf.content).toMatch(/transform:\s*translateX\(0\)/);
    expect(kf.content).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(kf.content).not.toMatch(/\b(width|height|top|left|right|margin|padding|opacity|display)\s*:/);
  });

  it("pauses on hover AND on keyboard focus", () => {
    expect(media.content).toMatch(/\.landing-ticker:hover \.landing-ticker__track,\s*\.landing-ticker:focus-within \.landing-ticker__track\s*\{\s*animation-play-state:\s*paused/);
  });

  it("at rest the list wraps and the clone is hidden — a complete, readable list with no media query at all", () => {
    const list = blockAt(outside, outside.indexOf(".landing-ticker__list {"));
    expect(list.content).toMatch(/flex-wrap:\s*wrap/);
    const clone = blockAt(outside, outside.indexOf(".landing-ticker__clone {"));
    expect(clone.content).toMatch(/display:\s*none/);
    expect(outside).not.toMatch(/landing-ticker[^{]*\{[^}]*animation/);
  });

  it("the static rules come BEFORE the media block, so the motion rules win the cascade", () => {
    expect(before).toContain(".landing-ticker__list {");
    expect(before).toContain(".landing-ticker__clone {");
    expect(before).toContain("--landing-ticker-gap:");
    expect(before).toContain("--landing-ticker-duration:");
  });

  it("the loop's trailing pad and the list's item gap are ONE custom property, not two literals", () => {
    expect((css.match(/--landing-ticker-gap:/g) ?? []).length).toBe(1);
    expect(media.content).toMatch(/padding-right:\s*var\(--landing-ticker-gap\)/);
    expect(before).toMatch(/column-gap:\s*var\(--landing-ticker-gap\)/);
  });
});

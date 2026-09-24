/**
 * The two animated landing-page figures (components/landing/SubmittalStamp.tsx
 * and components/landing/RetainageCountUp.tsx) must be invisible to a reader
 * who set prefers-reduced-motion: reduce, and what that reader sees must be
 * the FINISHED state — the stamp landed, the bar full — not a frozen first
 * frame. Asserted here at the CSS layer, exactly the way
 * globals.reveal.test.ts and globals.ticker.test.ts guard the other two, and
 * for the same reason those two files give: there are two independent gates
 * (the `useMotionCue` hook never says "playing" under reduced motion, and this
 * stylesheet only animates inside the no-preference block), and either one can
 * regress without the other noticing.
 *
 * Two properties, each of which could regress alone:
 *
 *   1. every rule that MOVES anything lives inside the one
 *      `prefers-reduced-motion: no-preference` block, keyed on
 *      `[data-motion-play="playing"]`;
 *   2. the rules OUTSIDE it — the stamp's resting angle, the fill's
 *      transform-origin, the durations — come BEFORE that block in source
 *      order, because they share its specificity and the later rule wins.
 *      That is the mistake globals.ticker.test.ts records, and nothing but a
 *      browser would say so.
 *
 * And one more, which is the height rule this page has paid for twice (#459,
 * #475): the keyframes may touch `transform` and `opacity` and NOTHING that
 * lays out. A `width` or `height` keyframe is the page moving.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

function blockAt(source: string, from: number) {
  const start = source.indexOf("{", from);
  expect(start, "no opening brace after the given index").toBeGreaterThan(-1);
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

describe("globals.css landing motion is gated behind prefers-reduced-motion", () => {
  it("found the one no-preference block to reason about", () => {
    // Anti-vacuity: every assertion below slices on this index, so a file with
    // no such block would pass them all while animating unconditionally.
    expect(mediaAt).toBeGreaterThan(-1);
    expect(media.content.length).toBeGreaterThan(500);
  });

  it("every animation of either figure lives INSIDE that block", () => {
    for (const needle of [
      "@keyframes landing-stamp",
      "@keyframes landing-settle",
      "@keyframes landing-countup",
      "animation: landing-stamp",
      "animation: landing-settle",
      "animation: landing-countup",
      '[data-motion-play="playing"]',
    ]) {
      expect(media.content, needle).toContain(needle);
      expect(outside, `${needle} leaked outside the media block`).not.toContain(needle);
    }
  });

  it("nothing animates unless the cue says it is being looked at", () => {
    // Every `animation:` the two figures declare is selected on the attribute
    // the hook writes — never on the figure itself, which would play once on
    // load, off screen, and never again.
    const rules = [...media.content.matchAll(/([^{}]*)\{[^{}]*animation:\s*landing-(stamp|settle|countup)[^{}]*\}/g)];
    expect(rules.length, "no landing-motion animation rules found at all").toBe(3);
    for (const [, selector] of rules) {
      expect(selector, `${selector.trim()} does not wait for the cue`).toContain(
        '[data-motion-play="playing"]',
      );
    }
  });

  it("the keyframes move transform and opacity only — nothing that lays out", () => {
    for (const name of ["landing-stamp", "landing-settle", "landing-countup"]) {
      const kf = blockAt(media.content, media.content.indexOf(`@keyframes ${name}`));
      expect(kf.content).toMatch(/transform:|opacity:/);
      expect(
        kf.content,
        `@keyframes ${name} animates a layout property — that is the page moving`,
      ).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding|display|flex-grow)\s*:/);
    }
  });

  it("the stamp lands at its angle and the bar fills from nothing", () => {
    const stamp = blockAt(media.content, media.content.indexOf("@keyframes landing-stamp"));
    // It arrives big, high and over-rotated, and settles on the SAME rotation
    // the at-rest rule gives it — so the last frame and the rest state agree.
    expect(stamp.content).toMatch(/scale\(/);
    expect(stamp.content).toMatch(/rotate\(-9deg\)/);
    expect(stamp.content).toMatch(/opacity:\s*0/);
    const fill = blockAt(media.content, media.content.indexOf("@keyframes landing-countup"));
    expect(fill.content).toMatch(/transform:\s*scaleX\(0\)/);
    expect(fill.content).toMatch(/transform:\s*scaleX\(1\)/);
  });

  it("the at-rest rules come BEFORE the block, so the motion wins the cascade", () => {
    expect(before).toContain(".landing-stamp__mark {");
    expect(before).toContain(".landing-countup__fill {");
    expect(before).toContain("--landing-stamp-duration:");
    expect(before).toContain("--landing-stamp-ease:");
    expect(before).toContain("--landing-countup-duration:");
    // The resting angle is defined once, outside the media query, so a reader
    // with reduced motion sees a stamp that is ON the sheet at an angle rather
    // than square to it.
    const rest = blockAt(before, before.indexOf(".landing-stamp__mark {"));
    expect(rest.content).toMatch(/transform:\s*translate\(-50%,\s*-50%\)\s*rotate\(-9deg\)/);
    expect((css.match(/rotate\(-9deg\)/g) ?? []).length).toBe(2); // rest + the keyframe's last frame
  });

  it("keeps the durations and the overshoot curve next to their own use, not at :root", () => {
    // The page has exactly two general curves at :root; the stamp's overshoot
    // is not a general curve and must not be reachable as one. Same reasoning
    // as the ticker's gap and duration living on `.landing-ticker`.
    for (const token of ["--landing-stamp-duration", "--landing-stamp-ease", "--landing-countup-duration"]) {
      expect((css.match(new RegExp(`${token}:`, "g")) ?? []).length).toBe(1);
    }
    const root = blockAt(css, css.indexOf(":root {"));
    expect(root.content).not.toContain("--landing-stamp");
    expect(root.content).not.toContain("--landing-countup");
    // And the bar reuses the page's own content curve rather than inventing one.
    expect(media.content).toMatch(/animation: landing-countup var\(--landing-countup-duration\) var\(--ease-landing\)/);
  });
});

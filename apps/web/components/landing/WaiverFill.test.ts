/**
 * The lien waiver hero, as markup and as a stylesheet. happy-dom does no
 * layout, so motion itself is not asserted — only that the finished document
 * is what renders at rest, and that every animation in waiverFill.css is
 * gated behind reduced-motion and moves only transform/opacity.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WaiverFill } from "./WaiverFill";

const html = renderToStaticMarkup(createElement(WaiverFill));
const css = readFileSync(new URL("./waiverFill.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** [start, end) of the brace-balanced block opening at `open`. */
function blockAt(src: string, open: number): [number, number] {
  let depth = 0;
  for (let i = src.indexOf("{", open); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return [open, i + 1];
  }
  throw new Error("unbalanced braces");
}

describe("WaiverFill at rest is the finished waiver", () => {
  it("renders every value and the mark", () => {
    for (const v of ["Ridgeline Drywall Inc.", "Apex Builders", "1200 Harbor Blvd", "$48,250.00"]) {
      expect(html).toContain(v);
    }
    expect(html).toContain("March 31");
    expect(html).toContain("PDF READY");
    // Banned wording: the tool never says a waiver is ready or safe to sign.
    expect(html).not.toMatch(/ready to sign/i);
  });

  it("is idle at rest", () => {
    expect(html).toContain('data-motion-play="idle"');
    expect(html).not.toContain('data-motion-play="playing"');
  });
});

describe("waiverFill.css motion is gated and transform/opacity only", () => {
  const mediaAt = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  const [mStart, mEnd] = blockAt(css, mediaAt);

  it("has exactly one no-preference block", () => {
    expect(mediaAt).toBeGreaterThan(-1);
    expect(css.split("prefers-reduced-motion").length - 1).toBe(1);
  });

  it("puts every animation declaration inside it, selected on playing", () => {
    const decls = [...css.matchAll(/(?<![-\w])animation\s*:/g)];
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      expect(d.index! > mStart && d.index! < mEnd, `animation at ${d.index} outside media block`).toBe(true);
      const brace = css.lastIndexOf("{", d.index!);
      const selector = css.slice(Math.max(css.lastIndexOf("}", brace), css.lastIndexOf("{", brace - 1)) + 1, brace);
      expect(selector).toContain('[data-motion-play="playing"]');
    }
  });

  it("animates only transform and opacity in every keyframe", () => {
    const frames = [...css.matchAll(/@keyframes\s+[\w-]+/g)];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const [s, e] = blockAt(css, f.index!);
      expect(s > mStart && e <= mEnd).toBe(true);
      const props = [...css.slice(s, e).matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      expect(props.length).toBeGreaterThan(0);
      for (const p of props) expect(["transform", "opacity"]).toContain(p);
    }
  });
});

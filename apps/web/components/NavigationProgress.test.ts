import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { barStyle, startsNavigation } from "@/lib/navProgress";
import Loading from "./RouteSkeleton";

const HERE = "https://app.cstream.ai/rfis?status=open";
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const link = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({
  href,
  target: "",
  download: false,
  ...extra,
});

describe("startsNavigation: only clicks the app router will render in place", () => {
  it("starts on a plain click to another in-app route, or the same route with new filters", () => {
    expect(startsNavigation(plain, link("/safety"), HERE)).toBe(true);
    expect(startsNavigation(plain, link("/rfis?status=closed"), HERE)).toBe(true);
  });

  it("does not start when nothing will render, so nothing would finish it", () => {
    expect(startsNavigation(plain, link("/rfis?status=open"), HERE)).toBe(false);
    expect(startsNavigation(plain, link("/rfis?status=open#row-3"), HERE)).toBe(false);
  });

  it("does not start for new tabs, downloads, other sites or modified clicks", () => {
    expect(startsNavigation(plain, link("/safety", { target: "_blank" }), HERE)).toBe(false);
    expect(startsNavigation(plain, link("/export.csv", { download: true }), HERE)).toBe(false);
    expect(startsNavigation(plain, link("https://example.com/"), HERE)).toBe(false);
    expect(startsNavigation(plain, link("mailto:a@b.c"), HERE)).toBe(false);
    for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(startsNavigation({ ...plain, [mod]: true }, link("/safety"), HERE)).toBe(false);
    }
    expect(startsNavigation({ ...plain, button: 1 }, link("/safety"), HERE)).toBe(false);
  });
});

describe("barStyle: transform only, and still under reduced motion", () => {
  it("moves by transform and nothing else", () => {
    for (const phase of ["start", "loading", "done"] as const) {
      const s = barStyle(phase, false);
      expect(s.transform).toMatch(/^scaleX\(/);
      expect(Object.keys(s).sort()).toEqual(["transform", "transitionDuration", "transitionTimingFunction"]);
    }
    expect(barStyle("loading", false).transitionDuration).toBe("8000ms");
  });

  it("never animates when the reader asked for reduced motion, but still shows", () => {
    for (const phase of ["start", "loading", "done"] as const) {
      expect(barStyle(phase, true).transitionDuration).toBe("0ms");
    }
    expect(barStyle("loading", true).transform).toBe("scaleX(0.85)");
  });

  it("CSS net: the transition property exists only under motion-safe:, never inline", () => {
    const src = readFileSync(new URL("./NavigationProgress.tsx", import.meta.url), "utf8");
    expect(src).toContain("motion-safe:transition-transform");
    expect(src).not.toMatch(/\btransition:\s*[`"]/);
    expect(src).not.toMatch(/(?<!motion-safe:)\btransition-(transform|all)\b/);
  });
});

describe("app/(app)/loading.tsx", () => {
  const html = renderToStaticMarkup(createElement(Loading));

  it("announces itself to assistive tech and pulses only under motion-safe", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading page");
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toMatch(/(?<!motion-safe:)animate-pulse/);
  });
});

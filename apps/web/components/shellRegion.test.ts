// @vitest-environment happy-dom

/**
 * One broken shell widget must not take down the page it frames.
 *
 * THE PROPERTY, stated as a test because it regresses the first time
 * somebody adds a widget to the rail: a component inside a `<ShellRegion>`
 * throws during render, and the sibling `<main>` — the page — is still in the
 * document. On 2026-09-21 there was no such region and one invoice's render
 * error blanked every authenticated screen for a testing contractor. The
 * page-level boundaries that landed the same day (#407) sit ABOVE the shell,
 * so they replace the whole viewport; this is the layer under them.
 *
 * FOUR HALVES, each with a control that shows the assertion can fail:
 *
 *   1. In a real DOM (happy-dom, react-dom/client), a throw inside a region
 *      leaves the page standing and renders the region's fallback. The
 *      CONTROL renders the same throw with no region and asserts the page is
 *      GONE — that is React's documented behaviour, and if it ever stopped
 *      being true this whole file would be asserting nothing.
 *   2. On the server (`renderToString`), the same throw does not escape. The
 *      CONTROL is a bare class boundary without the inner Suspense, which
 *      throws straight through — React's server renderer does not call
 *      `getDerivedStateFromError`. That control is why the Suspense in
 *      ShellRegion is load-bearing and not decoration.
 *   3. A healthy region adds no DOM: its markup is a direct child of the
 *      container. The shell is a flex row; a wrapper would be a flex item.
 *   4. The regions are actually USED, and used in the one place they can be.
 *      Neither file can be mounted here — `app/(app)/layout.tsx` is a server
 *      component with auth and four queries — so their source is read.
 *
 *      THIS ASSERTION CHANGED SHAPE 2026-09-25 AND MUST NOT BE READ AS
 *      WEAKENED. It used to read the layout alone and require every
 *      `@/components/` component rendered there to be inside a
 *      `<ShellRegion>`. The pairing moved to `components/AppChrome.tsx`
 *      because a `<Sidebar …/>` written in a SERVER layout arrives in the
 *      browser as a deferred lazy past 3,200 serialized bytes (see
 *      ShellRegion.tsx's own header), so the census now spans both files and
 *      asserts MORE than it did:
 *
 *        - AppChrome.tsx wraps every widget it imports in a `<ShellRegion>`
 *          — the same derived-set check as before, on the file that now does
 *          the wrapping, with the set pinned against the five names below;
 *        - the layout imports NOTHING from `@/components/` except those
 *          region components and the fallback, so it cannot render a widget
 *          bare — an allowlist, where before it was a search for a wrapper;
 *        - the layout renders every region component, self-closing, and no
 *          region takes a `children` prop at all — which is the stronger
 *          form of the old `{children}` rule: the page cannot be put inside
 *          a region even by accident. Page errors belong to
 *          app/(app)/error.tsx, which says "don't submit again" — a quiet
 *          fallback would swallow that;
 *        - the layout never writes `<ShellRegion>` itself. That is the new
 *          property, and it is the hydration fix.
 *
 * Mutation-tested 2026-09-21: ShellRegion made a passthrough → 1 red; the
 * Suspense removed → 2 red; MetricBar unwrapped in the layout → 4 red.
 * Re-proved 2026-09-25 against the new shape: MetricBar rendered in the
 * layout outside a region → 4b red, naming the import.
 *
 * Written with createElement rather than JSX only because the suite's
 * `include` matches .test.ts and not .test.tsx.
 */

import { readFileSync } from "node:fs";
// Node's URL by name: under happy-dom the global `URL` is the browser's, and
// `fileURLToPath` refuses it with "The URL must be of scheme file".
import { URL as NodeURL, fileURLToPath } from "node:url";
import { Component, act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellRegion, ShellRegionFallback } from "@/components/ShellRegion";
import { shellQueryFailed } from "@/lib/shell-region-failure";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** The widget that breaks. The message is what the console must carry. */
function Boom(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'aria-describedby')");
}

/** A healthy widget, with text that appears nowhere else in these trees. */
function Healthy() {
  return createElement("nav", { "aria-label": "Money pipeline" }, "RAIL-OK-7731");
}

/** The shape of the layout: a shell region beside the page. */
function shell(regionChild: ReactNode, wrap: boolean) {
  const region = wrap ? createElement(ShellRegion, { region: "metricbar" }, regionChild) : regionChild;
  return createElement("div", null, region, createElement("main", null, "PAGE-STILL-HERE-4402"));
}

let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  consoleError.mockRestore();
});

function shellLogLines(): string[] {
  return consoleError.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("[shell]"));
}

describe("1. a throw inside a region leaves the page standing", () => {
  it("renders the page and the region's fallback, and names the region in the console", () => {
    root = createRoot(container);
    act(() => root.render(shell(createElement(Boom), true)));

    expect(container.textContent).toContain("PAGE-STILL-HERE-4402");
    expect(container.textContent).toContain("Company figures couldn't load.");
    expect(container.querySelector("main")).not.toBeNull();

    const lines = shellLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("metricbar");
    expect(lines[0]).toContain("the page is unaffected");
    // The error itself travels with the line, so the console names the widget.
    const [, error] = consoleError.mock.calls.find((call) => String(call[0]).startsWith("[shell]"))!;
    expect(String((error as Error).message)).toContain("aria-describedby");
  });

  it("CONTROL: the same throw with no region removes the page", () => {
    const uncaught: unknown[] = [];
    root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error) });
    try {
      act(() => root.render(shell(createElement(Boom), false)));
    } catch {
      // React 19 reports through onUncaughtError; an older React rethrows.
      // Either way the assertion below is the one that matters.
    }
    expect(container.querySelector("main")).toBeNull();
    expect(container.textContent).not.toContain("PAGE-STILL-HERE-4402");
  });
});

describe("2. the same throw during server rendering does not escape", () => {
  it("renderToString succeeds and the page is in the HTML", () => {
    const html = renderToString(shell(createElement(Boom), true));
    expect(html).toContain("PAGE-STILL-HERE-4402");
    // React marks the region as handed to the client rather than rendering
    // the widget; the client retry is what the class boundary then catches.
    expect(html).toContain("<!--$!-->");
  });

  it("CONTROL: a class boundary WITHOUT the inner Suspense throws straight through", () => {
    class BareBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    const tree = createElement(
      "div",
      null,
      createElement(BareBoundary, null, createElement(Boom)),
      createElement("main", null, "PAGE-STILL-HERE-4402"),
    );
    expect(() => renderToString(tree)).toThrow("aria-describedby");
  });
});

describe("3. a healthy region is invisible", () => {
  it("adds no DOM of its own and logs nothing", () => {
    root = createRoot(container);
    act(() => root.render(createElement(ShellRegion, { region: "sidebar" }, createElement(Healthy))));

    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe("NAV");
    expect(container.textContent).toBe("RAIL-OK-7731");
    expect(container.textContent).not.toContain("couldn't load");
    expect(shellLogLines()).toHaveLength(0);
  });

  it("every fallback that shows anything offers Reload, and the helper fallback shows nothing", () => {
    for (const region of ["sidebar", "topbar", "metricbar"] as const) {
      const html = renderToString(createElement(ShellRegionFallback, { region }));
      expect(html).toContain("couldn&#x27;t load");
      expect(html).toContain("Reload");
    }
    expect(renderToString(createElement(ShellRegionFallback, { region: "helper" }))).toBe("");
  });
});

describe("the server-side half: a failed query settles to the region's empty value", () => {
  it("returns the fallback and logs in the same [shell] shape", async () => {
    const stages = await Promise.reject(new Error("Decimal overflow")).catch(shellQueryFailed("sidebar", []));
    expect(stages).toEqual([]);
    const lines = shellLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("sidebar query failed");
  });
});

/* ---------------------------------------------------------------------- */

/** Guards the guard: `readFileSync` throws on a moved file, but an empty or
 * truncated read would let every assertion below pass on nothing. */
function read(relative: string): string {
  const text = readFileSync(fileURLToPath(new NodeURL(relative, import.meta.url)), "utf8");
  expect(text.length).toBeGreaterThan(400);
  return text;
}

const layoutSource = read("../app/(app)/layout.tsx");
const chromeSource = read("./AppChrome.tsx");

/**
 * Source with comments removed. EVERY structural check below runs on this
 * rather than the raw file, and that is not tidiness: both files explain the
 * defect they exist to prevent, so both PRINT the wrong shape —
 * `<ShellRegion region="sidebar"><Sidebar …/></ShellRegion>` — inside a
 * comment. A census that matched prose would fail on the documentation and
 * pass on the code, which is the wrong way round. Found by exactly that,
 * 2026-09-25, before this function existed.
 */
function code(source: string): string {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  expect(stripped.length).toBeGreaterThan(300);
  return stripped;
}

const layoutCode = code(layoutSource);
const chromeCode = code(chromeSource);

/** The five this file exists for. The derived set must contain them all —
 * a renamed import or a moved component cannot quietly shrink the census. */
const KNOWN_SHELL_COMPONENTS = ["TimeZoneCookie", "FullTour", "Sidebar", "Topbar", "MetricBar"];

/** The region machinery itself, which is not a widget to be wrapped. */
const MACHINERY = ["ShellRegion", "ShellRegionFallback"];

/** Every component a file imports from `@/components/`. Derived from the
 * import lines — single-line and braced-multiline alike — so a new widget is
 * in the set the moment it is imported, wrapped or not. */
function importedComponents(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+"@\/components\/[^"]+";/g)) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "");
      if (name) names.push(name);
    }
  }
  return names;
}

/** [start, end) of every `<ShellRegion …>…</ShellRegion>` block. Regions do
 * not nest, and a test below fails if one ever does. */
function regionSpans(source: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const match of source.matchAll(/<ShellRegion region="[a-z]+">[\s\S]*?<\/ShellRegion>/g)) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/** [start, end) of every SELF-CLOSING `<XRegion …/>` element, which is how
 * the layout mounts the chrome. Used both to prove they are self-closing
 * (the count has to match every `<XRegion` in the file) and to place
 * `{children}` outside all of them. */
function selfClosingSpans(source: string, names: string[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const name of names) {
    for (const match of source.matchAll(new RegExp(`<${name}(\\s[^<>]*?)?/>`, "g"))) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  return spans;
}

function inSomeSpan(spans: [number, number][], index: number): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

function jsxIndexes(source: string, name: string): number[] {
  return Array.from(source.matchAll(new RegExp(`<${name}[\\s/>]`, "g"))).map((m) => m.index);
}

/** Every `export function XRegion` in AppChrome.tsx. */
function exportedRegions(): string[] {
  return Array.from(chromeCode.matchAll(/^export function (\w+Region)\(/gm)).map((m) => m[1]);
}

describe("4. components/AppChrome.tsx puts every shell widget inside a region", () => {
  const widgets = importedComponents(chromeCode).filter((name) => !MACHINERY.includes(name));

  it("the census sees the five components this file exists for", () => {
    expect(widgets.length).toBeGreaterThanOrEqual(KNOWN_SHELL_COMPONENTS.length);
    for (const name of KNOWN_SHELL_COMPONENTS) expect(widgets).toContain(name);
  });

  it("finds at least one region per known component, and no nested regions", () => {
    const spans = regionSpans(chromeCode);
    expect(spans.length).toBeGreaterThanOrEqual(KNOWN_SHELL_COMPONENTS.length);
    for (const span of spans) {
      const inner = chromeCode.slice(span[0] + 1, span[1]);
      expect(inner).not.toContain("<ShellRegion ");
    }
  });

  it.each(widgets.map((name) => [name]))("<%s> is rendered, and only inside a <ShellRegion>", (name) => {
    const spans = regionSpans(chromeCode);
    const indexes = jsxIndexes(chromeCode, name);
    // Imported and never rendered would be "written and never called".
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) expect(inSomeSpan(spans, index)).toBe(true);
  });

  it("no region takes children, so the page can never be put inside one", () => {
    expect(chromeCode).not.toMatch(/\bchildren\b/);
  });
});

describe("4b. app/(app)/layout.tsx mounts those regions and pairs none itself", () => {
  const regions = exportedRegions();

  it("AppChrome.tsx exports one region component per shell region", () => {
    expect(regions.length).toBeGreaterThanOrEqual(KNOWN_SHELL_COMPONENTS.length);
  });

  it("the layout imports nothing from @/components/ but those regions and the fallback", () => {
    const allowed = regions.concat("ShellRegionFallback");
    const imported = importedComponents(layoutCode);
    // Not vacuous: the layout does import the chrome.
    expect(imported.length).toBeGreaterThanOrEqual(regions.length);
    for (const name of imported) expect(allowed).toContain(name);
  });

  it.each(exportedRegions().map((name) => [name]))("<%s> is rendered by the layout, self-closing", (name) => {
    const indexes = jsxIndexes(layoutCode, name);
    expect(indexes.length).toBeGreaterThan(0);
    // Self-closing, so nothing — the page least of all — can be nested in one.
    expect(selfClosingSpans(layoutCode, [name])).toHaveLength(indexes.length);
  });

  /**
   * THE PROPERTY ADDED 2026-09-25, AND THE ONE THAT MAKES THE SHELL HYDRATE.
   *
   * `<ShellRegion>` is a client component. A `<Sidebar …/>` written between
   * its tags HERE — in a server layout — is an element that has to cross the
   * RSC boundary as that client component's `children`, and React's
   * PRODUCTION Flight serializer defers any element it reaches once the
   * current row has passed 3,200 bytes. The browser turns the deferral back
   * into a lazy, a lazy suspends, and `ShellRegion`'s own `<Suspense>` is
   * then streamed out of order — which is the React #418 element-level
   * mismatch the pilot journey's step 11 reported on a different set of
   * pages every run, at about one authenticated page load in three (PR #501,
   * and CLAUDE.md's #418 entry).
   *
   * Pairing a region with its widget inside AppChrome.tsx — a "use client"
   * module — means the element is created by whoever renders it and never
   * travels through Flight at all, so the boundary cannot suspend.
   */
  it("never writes <ShellRegion> itself — that pairing belongs in the client module", () => {
    expect(layoutCode).not.toMatch(/<ShellRegion[\s>]/);
  });

  it("{children} — the page — is rendered exactly once and OUTSIDE every region", () => {
    const spans = selfClosingSpans(layoutCode, regions);
    // Not vacuous: there are regions for it to be outside of.
    expect(spans.length).toBeGreaterThanOrEqual(KNOWN_SHELL_COMPONENTS.length);
    const indexes = Array.from(layoutCode.matchAll(/^\s*\{children\}\s*$/gm)).map((m) => m.index);
    expect(indexes).toHaveLength(1);
    expect(inSomeSpan(spans, indexes[0])).toBe(false);
  });

  it("the two money queries are settled with shellQueryFailed; the alert count is not", () => {
    expect(layoutSource).toMatch(/loadCompanyFinancials\(company\.id\)\s*\.catch\(shellQueryFailed\("metricbar", null\)\)/);
    expect(layoutSource).toMatch(/getMoneyRailStages\(company\.id\)\s*\.catch\(shellQueryFailed\("sidebar", \[\]\)\)/);
    // A wrong alert badge is a claim about the person's records, not
    // decoration — it is meant to fail the page rather than lie quietly.
    expect(layoutSource).not.toMatch(/countVisibleAlerts\([^)]*\)\s*\.catch/);
  });

  it("a failed metric-bar query renders the region's fallback rather than nothing", () => {
    expect(layoutCode).toContain('<ShellRegionFallback region="metricbar" />');
  });
});

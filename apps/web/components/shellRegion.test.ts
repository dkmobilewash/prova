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
 *   4. The layout actually USES the regions. `app/(app)/layout.tsx` is a
 *      server component with auth and four queries, so it cannot be mounted
 *      here; its source is read instead. Every component imported from
 *      `@/components/` and rendered there is inside a `<ShellRegion>` — the
 *      set is DERIVED from the import lines and its size pinned against the
 *      five names this file exists for, per CLAUDE.md's rule that a census
 *      must assert what it can see. `{children}` is asserted to be OUTSIDE
 *      every region: page errors belong to app/(app)/error.tsx, which says
 *      "don't submit again" — a quiet fallback would swallow that.
 *
 * Mutation-tested 2026-09-21: ShellRegion made a passthrough → 1 red; the
 * Suspense removed → 2 red; MetricBar unwrapped in the layout → 4 red.
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

const layoutSource = readFileSync(fileURLToPath(new NodeURL("../app/(app)/layout.tsx", import.meta.url)), "utf8");

/** The five this file exists for. The derived set must contain them all —
 * a renamed import or a moved component cannot quietly shrink the census. */
const KNOWN_SHELL_COMPONENTS = ["TimeZoneCookie", "FullTour", "Sidebar", "Topbar", "MetricBar"];

/** Every component the layout imports from `@/components/`, other than the
 * region machinery itself. Derived from the import lines so a new widget is
 * in the set the moment it is imported, wrapped or not. */
function importedShellComponents(): string[] {
  const names: string[] = [];
  for (const match of layoutSource.matchAll(/^import \{ ([^}]+) \} from "@\/components\/[^"]+";$/gm)) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim().replace(/^type /, "");
      if (name && name !== "ShellRegion" && name !== "ShellRegionFallback") names.push(name);
    }
  }
  return names;
}

/** [start, end) of every `<ShellRegion …>…</ShellRegion>` block. Regions do
 * not nest, and the test below fails if one ever does. */
function regionSpans(): [number, number][] {
  const spans: [number, number][] = [];
  for (const match of layoutSource.matchAll(/<ShellRegion region="[a-z]+">[\s\S]*?<\/ShellRegion>/g)) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

function inSomeRegion(index: number): boolean {
  return regionSpans().some(([start, end]) => index >= start && index < end);
}

function jsxIndexes(name: string): number[] {
  return Array.from(layoutSource.matchAll(new RegExp(`<${name}[\\s/>]`, "g"))).map((m) => m.index);
}

describe("4. app/(app)/layout.tsx puts every shell component inside a region", () => {
  const components = importedShellComponents();

  it("the census sees the five components this file exists for", () => {
    expect(components.length).toBeGreaterThanOrEqual(KNOWN_SHELL_COMPONENTS.length);
    for (const name of KNOWN_SHELL_COMPONENTS) expect(components).toContain(name);
  });

  it("finds at least one region per known component, and no nested regions", () => {
    const spans = regionSpans();
    expect(spans.length).toBeGreaterThanOrEqual(KNOWN_SHELL_COMPONENTS.length);
    for (const span of spans) {
      const inner = layoutSource.slice(span[0] + 1, span[1]);
      expect(inner).not.toContain("<ShellRegion ");
    }
  });

  it.each(components.map((name) => [name]))("<%s> is rendered, and only inside a <ShellRegion>", (name) => {
    const indexes = jsxIndexes(name);
    // Imported and never rendered would be "written and never called".
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) expect(inSomeRegion(index)).toBe(true);
  });

  it("{children} — the page — is rendered exactly once and OUTSIDE every region", () => {
    // A whole JSX line, so a prose mention of {children} in a comment does not count.
    const indexes = Array.from(layoutSource.matchAll(/^\s*\{children\}\s*$/gm)).map((m) => m.index);
    expect(indexes).toHaveLength(1);
    expect(inSomeRegion(indexes[0])).toBe(false);
  });

  it("the two money queries are settled with shellQueryFailed; the alert count is not", () => {
    expect(layoutSource).toMatch(/loadCompanyFinancials\(company\.id\)\s*\.catch\(shellQueryFailed\("metricbar", null\)\)/);
    expect(layoutSource).toMatch(/getMoneyRailStages\(company\.id\)\s*\.catch\(shellQueryFailed\("sidebar", \[\]\)\)/);
    // A wrong alert badge is a claim about the person's records, not
    // decoration — it is meant to fail the page rather than lie quietly.
    expect(layoutSource).not.toMatch(/countVisibleAlerts\([^)]*\)\s*\.catch/);
  });

  it("a failed metric-bar query renders the region's fallback rather than nothing", () => {
    expect(layoutSource).toContain('<ShellRegionFallback region="metricbar" />');
  });
});

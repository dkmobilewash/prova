// @vitest-environment happy-dom

/**
 * The desktop page list (components/shell/Sidebar.tsx), restored 2026-10-12.
 *
 * What it is for is that every page the viewer can open is one click away, so
 * the main assertion is a census: the owner's sidebar lists every href
 * `navGroupsFor` gives them plus the footer, each exactly once, under the six
 * area names in order. Sized (≥ 35 links) so a render that drew nothing
 * cannot pass by having nothing out of place.
 *
 * happy-dom does no layout; "hidden below lg" and the widths are classes here
 * and are checked by eye in a real browser (the click-list).
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { Sidebar, SIDEBAR_STORAGE_KEY } = await import("@/components/shell/Sidebar");
const { navGroupsFor, NAV_FOOTER, canOpen, NAV_ITEMS } = await import("@/components/navItems");
const { AREAS } = await import("@/lib/areas");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const owner = { role: "OWNER", jobFunction: null } as const;
const field = { role: "MEMBER", jobFunction: "FIELD" } as const;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  nav.pathname = "/dashboard";
  try {
    window.localStorage.clear();
  } catch {
    /* a test below makes storage throw */
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render(principal: { role: string; jobFunction: string | null } = owner, showsInternal = true) {
  act(() => root.render(<Sidebar principal={principal} showsInternal={showsInternal} />));
  return container.querySelector('nav[aria-label="Pages"]')!;
}

/** Open every closed group, so the census sees every link. */
function openAll() {
  for (const b of Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'))) act(() => b.click());
}

const hrefs = () => Array.from(container.querySelectorAll('nav[aria-label="Pages"] a')).map((a) => a.getAttribute("href")!);
const headings = () => Array.from(container.querySelectorAll("[data-nav-group]")).map((s) => s.getAttribute("data-nav-group"));

describe("the desktop page list", () => {
  it("is a landmark named Pages, shown from lg only", () => {
    const sidebar = render();
    expect(sidebar).not.toBeNull();
    expect(container.querySelectorAll('nav[aria-label="Main"]')).toHaveLength(0);
    expect(sidebar.className).toMatch(/\bhidden\b/);
    expect(sidebar.className).toMatch(/\blg:flex\b/);
  });

  it("lists every page an owner can reach, once each, under the six areas in order, then Internal, then Account", () => {
    render(owner, true);
    openAll();
    const listed = hrefs();
    // The jobs list is /jobs; its nav entry is /dashboard (home, the wordmark).
    const expected = navGroupsFor(owner, { showsInternal: true })
      .flatMap((g) => g.items.map((i) => i.href))
      .map((href) => (href === "/dashboard" ? "/jobs" : href))
      .concat(NAV_FOOTER.map((i) => i.href));
    expect(listed.length).toBeGreaterThanOrEqual(35);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...new Set(expected)].sort());
    // The search box, not a page you go to (NOT_IN_AN_AREA). It is in no
    // nav group today; if one ever files it, this asks somebody to decide.
    expect(listed).not.toContain("/ask");
    expect(headings()).toEqual([...AREAS.map((a) => a.name), "Internal", "Account"]);
    expect(listed.slice(-2).sort()).toEqual(["/settings", "/settings/integrations"]);
  });

  it("never lists a page a field user cannot open", () => {
    render(field, false);
    openAll();
    const listed = hrefs();
    expect(listed.length).toBeGreaterThan(5);
    for (const href of listed) expect(canOpen(field, href === "/jobs" ? "/dashboard" : href), href).toBe(true);
    // Not vacuous: the owner sees pages the field user does not.
    const refused = NAV_ITEMS.map((i) => i.href).filter((href) => !canOpen(field, href));
    expect(refused.length).toBeGreaterThan(0);
    for (const href of refused) expect(listed).not.toContain(href);
  });

  it("marks the current page, opens its group, and lights Jobs on a job page", () => {
    nav.pathname = "/vendors/pricing";
    render();
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe("/vendors/pricing");
    // Only that group is open by default.
    expect(container.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1);

    nav.pathname = "/jobs/abc/estimate";
    render();
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/jobs");
  });

  it("remembers a group opened or closed, in storage", () => {
    render();
    const money = container.querySelector('[data-nav-group="Money"] button')!;
    expect(money.getAttribute("aria-expanded")).toBe("false");
    act(() => (money as HTMLButtonElement).click());
    expect(money.getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)!).open.Money).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(container.querySelector('[data-nav-group="Money"] button')!.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses to icons and back, keeps each page's name for assistive tech, and remembers it", () => {
    nav.pathname = "/jobs";
    const sidebar = render();
    expect(sidebar.className).toMatch(/\bw-64\b/);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse to icons"]')!.click());
    expect(sidebar.className).toMatch(/\bw-16\b/);
    expect(sidebar.className).not.toMatch(/\bw-64\b/);
    const link = container.querySelector('a[href="/jobs"]')!;
    expect(link.getAttribute("title")).toBe("Jobs");
    expect(link.textContent).toContain("Jobs");
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)!).collapsed).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    expect(render().className).toMatch(/\bw-16\b/);
  });

  it("still renders and still collapses when storage throws", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is disabled");
      },
    });
    try {
      nav.pathname = "/jobs";
      const sidebar = render();
      expect(sidebar.querySelectorAll("a").length).toBeGreaterThan(0);
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse to icons"]')!.click());
      expect(sidebar.className).toMatch(/\bw-16\b/);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
  });
});

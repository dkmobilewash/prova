// @vitest-environment happy-dom

/**
 * The Concept G shell (2026-10-10): TopBar, its "All pages" panel, and the
 * phone's BottomTabs, mounted in a real DOM.
 *
 * Replaces Sidebar.test.ts and MobileNav.test.ts, which were deleted with the
 * files they mounted. What they guarded is re-asserted on the new shape:
 *
 *   - every group the rail listed, and every page in it, is reachable (now in
 *     "All pages", every group open, nothing behind a chevron);
 *   - the Money Rail's five figures render on their headings, and NONE render
 *     for a principal handed no stages (the FIELD case, #350);
 *   - the stage map is keyed on headings that exist, so a rename in
 *     navItems.tsx fails here instead of silently dropping a figure;
 *   - the phone's navigation is a landmark named "Main" that marks the page
 *     you are on (MobileNav.test.ts's reason, on the tabs);
 *   - a word or tab is never drawn for a page the person cannot open.
 *
 * happy-dom does no layout, so widths and "nothing hides behind the tabs" are
 * checked by screenshot, not pretended at here.
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyRailStage } from "@/lib/moneyRail";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));
const clerk = vi.hoisted(() => ({ signOut: vi.fn(), openUserProfile: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => clerk }));
// Both are covered by their own tests and pull in server actions; the top
// bar only has to mount them.
vi.mock("@/components/AskLauncher", () => ({ AskLauncher: () => <button data-ask-launcher="">Ask</button> }));
vi.mock("@/components/HelpButton", () => ({ HelpButton: () => <button>Help</button> }));

const { TopBar } = await import("@/components/shell/TopBar");
const { BottomTabs } = await import("@/components/shell/BottomTabs");
const { STAGE_KEY_FOR_HEADING } = await import("@/components/shell/AllPagesMenu");
const { navGroupsFor, navFooterFor } = await import("@/components/navItems");
const { activeTab, initialsFor, primaryTabs, MONEY_AREA_HREF } = await import("@/components/shell/primaryNav");
const { AREAS, areaHref } = await import("@/lib/areas");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const owner = { role: "OWNER", jobFunction: null } as const;
const field = { role: "MEMBER", jobFunction: "FIELD" } as const;

const stages: MoneyRailStage[] = [
  { key: "bidding", label: "Bidding", figure: { kind: "money", amount: 111_111 }, detail: "" },
  { key: "building", label: "Building", figure: { kind: "money", amount: 222_222 }, detail: "" },
  { key: "proving", label: "Proving", figure: { kind: "count", n: 33, noun: "waiting on the GC" }, detail: "" },
  { key: "staying-legal", label: "Staying legal", figure: { kind: "count", n: 44, noun: "documents at risk" }, detail: "" },
  { key: "getting-paid", label: "Getting paid", figure: { kind: "money", amount: 555_555 }, detail: "" },
];
const FIGURES = ["$111,111.00", "$222,222.00", "33", "44", "$555,555.00"];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  nav.pathname = "/dashboard";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function renderTopBar(principal: { role: string; jobFunction: string | null } = owner, withStages = stages, alertCount = 0) {
  act(() =>
    root.render(
      <TopBar
        companyName="Acme Drywall"
        userName="Maria Ruiz"
        userEmail="maria@example.com"
        alertCount={alertCount}
        principal={principal}
        helpChannel={{ kind: "none" } as never}
        stages={withStages}
      />,
    ),
  );
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error("nothing to click");
  act(() => (el as HTMLElement).click());
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
}

function openAllPages() {
  click(container.querySelector('button[aria-haspopup="true"]'));
  click(button("All pages"));
  const panel = container.querySelector('[role="dialog"][aria-label="All pages"]');
  expect(panel).not.toBeNull();
  return panel!;
}

describe("the desktop top bar", () => {
  it("draws Jobs · Money · Schedule as a landmark named Main, with no Home word", () => {
    renderTopBar();
    const main = container.querySelector('nav[aria-label="Main"]')!;
    expect(Array.from(main.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Jobs", "Money", "Schedule"]);
    expect(main.querySelector('a[aria-current="page"]')?.textContent).toBe("Jobs");
  });

  it("points Money at the Money area for an owner and drops it for a field user", () => {
    renderTopBar();
    expect(container.querySelector('nav[aria-label="Main"] a[href="/areas/money"]')).not.toBeNull();
    renderTopBar(field, []);
    const words = Array.from(container.querySelectorAll('nav[aria-label="Main"] a')).map((a) => a.textContent);
    expect(words).not.toContain("Money");
  });

  it("puts the alert count on the avatar and always lists Alerts in the menu", () => {
    renderTopBar(owner, stages, 3);
    expect(container.querySelector('button[aria-haspopup="true"]')?.textContent).toContain("3");
    click(container.querySelector('button[aria-haspopup="true"]'));
    expect(container.querySelector('a[href="/alerts"]')?.textContent).toContain("3 need you");
    renderTopBar(owner, stages, 0);
    expect(container.querySelector('a[href="/alerts"]')?.textContent).toContain("nothing needs you");
  });

  it("menu offers settings, the theme switch, account and sign out", () => {
    renderTopBar();
    click(container.querySelector('button[aria-haspopup="true"]'));
    expect(container.textContent).toContain("Maria Ruiz");
    expect(container.textContent).toContain("Acme Drywall");
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(container.querySelector('[role="group"][aria-label="Theme"]')).not.toBeNull();
    click(button("Sign out"));
    expect(clerk.signOut).toHaveBeenCalled();
  });

  it("closes the menu and the panel when the page changes", () => {
    renderTopBar();
    openAllPages();
    nav.pathname = "/schedule";
    renderTopBar();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("All pages", () => {
  it("lists every group and every page the rail offered an owner, none collapsed", () => {
    renderTopBar();
    const panel = openAllPages();
    for (const group of navGroupsFor(owner)) {
      expect(panel.querySelector(`[data-nav-group="${group.heading}"]`), group.heading).not.toBeNull();
      for (const item of group.items) {
        if (!item.disabled) expect(panel.querySelector(`a[href="${item.href}"]`), item.href).not.toBeNull();
      }
    }
    for (const item of navFooterFor(owner)) expect(panel.querySelector(`a[href="${item.href}"]`)).not.toBeNull();
    expect(panel.querySelector("[aria-expanded]")).toBeNull();
  });

  it("draws all five figures for an owner and none for a principal handed no stages", () => {
    renderTopBar();
    let text = openAllPages().textContent ?? "";
    for (const f of FIGURES) expect(text).toContain(f);
    renderTopBar(field, []);
    text = openAllPages().textContent ?? "";
    for (const f of ["$111,111.00", "$222,222.00", "$555,555.00"]) expect(text).not.toContain(f);
  });

  it("never lists a page the person cannot open", () => {
    renderTopBar(field, []);
    const panel = openAllPages();
    expect(panel.querySelector('a[href="/cash-flow"]')).toBeNull();
    expect(panel.querySelector('a[href="/wip"]')).toBeNull();
    // ...nor an area with nothing in it they can open.
    expect(panel.querySelector('a[href="/areas/money"]')).toBeNull();
    expect(panel.querySelector('a[href="/areas/crew-field"]')).not.toBeNull();
  });

  it("leads with the six areas, the same ones the home page boxes open", () => {
    renderTopBar();
    const areas = openAllPages().querySelector('nav[aria-label="Areas"]')!;
    expect(Array.from(areas.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(
      AREAS.map((area) => areaHref(area.slug)),
    );
  });

  it("Escape closes it", () => {
    renderTopBar();
    openAllPages();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keys the stage map on real headings and places all five stages", () => {
    const headings = navGroupsFor(owner).map((g) => g.heading);
    for (const heading of Object.keys(STAGE_KEY_FOR_HEADING)) expect(headings, heading).toContain(heading);
    expect(new Set(Object.values(STAGE_KEY_FOR_HEADING))).toEqual(new Set(stages.map((s) => s.key)));
  });
});

describe("the phone's bottom tabs", () => {
  it("are a landmark named Main with Home · Jobs · Money · Schedule, marking the current page", () => {
    nav.pathname = "/schedule";
    act(() => root.render(<BottomTabs principal={owner} />));
    const tabs = container.querySelector('nav[aria-label="Main"]')!;
    expect(Array.from(tabs.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Jobs", "Money", "Schedule"]);
    expect(tabs.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/schedule");
    expect(tabs.className).toContain("md:hidden");
    expect(tabs.className).toContain("safe-area-inset-bottom");
  });
});

describe("primaryNav", () => {
  it("opens the Money area for anyone who can open any money page, and only them", () => {
    expect(MONEY_AREA_HREF).toBe(areaHref("money"));
    // A billing person without company figures still gets the word: the area
    // page shows them backcharges and lien deadlines.
    const billing = [{ heading: "x", description: "", icon: null, items: [{ href: "/backcharges", label: "B", icon: null }] }];
    expect(primaryTabs(billing).map((t) => t.href)).toEqual(["/areas/money"]);
    const none = [{ heading: "x", description: "", icon: null, items: [{ href: "/rfis", label: "R", icon: null }] }];
    expect(primaryTabs(none)).toEqual([]);
  });

  it("knows which tab a page belongs to", () => {
    expect(activeTab("/dashboard", true)).toBe("home");
    expect(activeTab("/dashboard", false)).toBe("jobs");
    expect(activeTab("/jobs/abc/billing", true)).toBe("jobs");
    expect(activeTab("/wip", true)).toBe("money");
    expect(activeTab("/areas/money", false)).toBe("money");
    expect(activeTab("/areas/jobs-bids", false)).toBe("jobs");
    expect(activeTab("/areas/paperwork", false)).toBeNull();
    expect(activeTab("/schedule", false)).toBe("schedule");
    expect(activeTab("/rfis", false)).toBeNull();
  });

  it("makes avatar initials", () => {
    expect(initialsFor("Maria Ruiz", null)).toBe("MR");
    expect(initialsFor("Cher", null)).toBe("CH");
    expect(initialsFor(null, "dk@x.com")).toBe("DK");
    expect(initialsFor(null, null)).toBe("?");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activeTab } from "./pageTabsActive";

const nav = vi.hoisted(() => ({ pathname: "/union-compliance", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { PageTabs } = await import("./PageTabs");

const tabs = [
  { href: "/union-compliance", label: "This month" },
  { href: "/union-compliance?tab=apprenticeships", label: "Apprenticeships" },
  { href: "/union-compliance?tab=setup", label: "Setup" },
];

describe("activeTab", () => {
  it("the bare href is the default tab", () => {
    expect(activeTab(tabs, "/union-compliance", new URLSearchParams())?.label).toBe("This month");
  });
  it("a ?tab= visit lights the matching tab and NOT the default", () => {
    expect(activeTab(tabs, "/union-compliance", new URLSearchParams("tab=setup"))?.label).toBe("Setup");
  });
  it("an unknown ?tab= falls back to the default; another path matches nothing", () => {
    expect(activeTab(tabs, "/union-compliance", new URLSearchParams("tab=nope"))?.label).toBe("This month");
    expect(activeTab(tabs, "/settings", new URLSearchParams())).toBeUndefined();
  });
  it("other params on the page do not stop a match", () => {
    expect(activeTab(tabs, "/union-compliance", new URLSearchParams("month=2026-10&tab=setup"))?.label).toBe("Setup");
  });
  it("sub-route tabs match by pathname alone", () => {
    const sub = [
      { href: "/settings", label: "Company" },
      { href: "/settings/quickbooks", label: "QuickBooks" },
    ];
    expect(activeTab(sub, "/settings/quickbooks", new URLSearchParams())?.label).toBe("QuickBooks");
    expect(activeTab(sub, "/settings", new URLSearchParams())?.label).toBe("Company");
  });
});

describe("PageTabs", () => {
  const anchor = (html: string, href: string) => html.match(new RegExp(`<a[^>]*href="${href.replace("?", "\\?")}"[^>]*>`))?.[0] ?? "";

  it("is a nav with the given name and exactly one current tab", () => {
    nav.pathname = "/union-compliance";
    nav.search = "tab=setup";
    const html = renderToStaticMarkup(<PageTabs tabs={tabs} label="Union compliance sections" />);
    expect(html).toMatch(/^<nav aria-label="Union compliance sections"/);
    expect((html.match(/aria-current=/g) ?? []).length).toBe(1);
    expect(anchor(html, "/union-compliance?tab=setup")).toContain('aria-current="page"');
    expect(anchor(html, "/union-compliance")).not.toContain("aria-current");
  });

  it("draws every tab as a 44px target, 36 on a mouse", () => {
    nav.search = "";
    const html = renderToStaticMarkup(<PageTabs tabs={tabs} label="x" />);
    expect((html.match(/<a /g) ?? []).length).toBe(3);
    expect(anchor(html, "/union-compliance")).toContain('aria-current="page"');
    expect(anchor(html, "/union-compliance?tab=setup")).toContain("min-h-11");
    expect(anchor(html, "/union-compliance?tab=setup")).toContain("mouse:min-h-9");
  });
});

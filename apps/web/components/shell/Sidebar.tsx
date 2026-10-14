"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeItemHref, navFooterFor, navGroupsFor, type NavItem } from "@/components/navItems";
import { AreaIcon } from "@/components/areas/AreaParts";
import { AREAS, pagesByArea, toolRoute } from "@/lib/areas";
import type { BusinessScopeAnswers } from "@/lib/businessScope";
import type { Principal } from "@/lib/permissions";
import { accentFor } from "@/components/areaAccent";

/**
 * The desktop page list (≥ lg), back on 2026-10-12 — restore-brief.md item 1.
 * Concept G took the rail away and about half the app was then reachable only
 * through ⌘K or the avatar's "All pages"; this puts every page one click away
 * again without touching the top bar, the home boxes or the phone's tabs.
 *
 * NO SECOND LIST. Which pages appear is `navGroupsFor` (capability, business
 * scope, operator flag) and how they are filed and named is `pagesByArea`, the
 * same pair the "All pages" panel uses, so this cannot offer a door that panel
 * would not. Two adjustments only, both stated where they are made below.
 *
 * Remembers two things per browser — whether it is collapsed to icons, and
 * which groups were opened or closed — read in an effect so the server's HTML
 * and the first client render agree, and every storage touch is in a try/catch
 * because storage throws in a private window.
 */

export const SIDEBAR_STORAGE_KEY = "cstream:sidebar";

export type SidebarGroup = {
  heading: string;
  icon: ReactNode;
  description: string;
  items: NavItem[];
};

/** Where an area tool actually goes, keyed by the nav href it stands for:
 * the "Jobs" tool is the /jobs list, while its nav entry is /dashboard, which
 * is home (the wordmark). Without this "Jobs" here would open home. */
const TOOL_HREF = new Map(AREAS.flatMap((area) => area.tools.map((tool) => [toolRoute(tool), tool.href] as const)));
const AREA_ICON = new Map(AREAS.map((area) => [area.name, <AreaIcon key={area.slug} paths={area.icon} className="h-5 w-5" />]));

export function sidebarGroups(
  principal: Principal,
  options: { showsInternal?: boolean; businessScope?: BusinessScopeAnswers; routesWithData?: readonly string[] } = {},
): SidebarGroup[] {
  const footer = navFooterFor(principal);
  const groups = pagesByArea(navGroupsFor(principal, options))
    .map((group) => ({
      heading: group.heading,
      icon: AREA_ICON.get(group.heading) ?? group.icon,
      description: group.description,
      items: group.items
        // A disabled entry is not a page anyone can open. (/ask is in no
        // group — it is the search box, NOT_IN_AN_AREA in lib/areas.ts.)
        .filter((item) => !item.disabled)
        .map((item) => ({ ...item, href: TOOL_HREF.get(item.href) ?? item.href })),
    }))
    .filter((group) => group.items.length > 0);
  if (footer.length > 0) {
    groups.push({
      heading: "Account",
      icon: footer.find((item) => item.href === "/settings")?.icon ?? footer[0].icon,
      description: "Your company settings and connected apps.",
      items: footer,
    });
  }
  return groups;
}

type Saved = { collapsed: boolean; open: Record<string, boolean> };

function readSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return { collapsed: parsed.collapsed === true, open: parsed.open && typeof parsed.open === "object" ? parsed.open : {} };
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage refused (private window, quota): the choice lasts this page.
  }
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function Sidebar({
  principal,
  showsInternal = false,
  businessScope,
  routesWithData,
}: {
  principal: Principal;
  showsInternal?: boolean;
  businessScope?: BusinessScopeAnswers;
  routesWithData?: readonly string[];
}) {
  const pathname = usePathname();
  const groups = sidebarGroups(principal, { showsInternal, businessScope, routesWithData });
  const activeHref = activeItemHref(groups, pathname);
  const activeHeading = groups.find((g) => g.items.some((i) => i.href === activeHref))?.heading ?? null;

  const [saved, setSaved] = useState<Saved>({ collapsed: false, open: {} });
  useEffect(() => {
    const stored = readSaved();
    if (stored) setSaved(stored);
  }, []);
  const update = (next: Saved) => {
    setSaved(next);
    writeSaved(next);
  };

  const collapsed = saved.collapsed;
  // An explicit open/close wins; otherwise only the current page's group is open.
  const isOpen = (heading: string) => saved.open[heading] ?? heading === activeHeading;

  return (
    <nav
      aria-label="Pages"
      className={`print:hidden hidden shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-line-row bg-rail lg:flex ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className={`flex px-2 pt-2 ${collapsed ? "justify-center" : "justify-end"}`}>
        <button
          type="button"
          aria-label={collapsed ? "Show page names" : "Collapse to icons"}
          title={collapsed ? "Show page names" : "Collapse to icons"}
          aria-pressed={collapsed}
          onClick={() => update({ ...saved, collapsed: !collapsed })}
          className={`flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-rail-hover hover:text-ink mouse:h-9 mouse:w-9 ${focusRing}`}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <rect x="3" y="3.5" width="14" height="13" rx="2" />
            <path d="M8 3.5v13" />
            <path d={collapsed ? "m11 8 2 2-2 2" : "m13 8-2 2 2 2"} />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-2 px-2 pb-4">
        {groups.map((group, index) => {
          const open = isOpen(group.heading);
          const listId = `sidebar-group-${index}`;
          const accent = accentFor(group.heading);
          return (
            <section key={group.heading} data-nav-group={group.heading} className={group.heading === "Account" ? "mt-3 border-t border-line-row pt-3" : ""}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                title={collapsed ? group.heading : group.description}
                onClick={() => update({ ...saved, open: { ...saved.open, [group.heading]: !open } })}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg border border-line-card px-2.5 text-left text-[15px] font-semibold text-ink mouse:min-h-10 ${
                  open ? accent.tint : "bg-surface hover:bg-rail-hover"
                } ${collapsed ? "justify-center" : ""} ${focusRing}`}
              >
                <span className={`shrink-0 ${accent.icon}`} aria-hidden="true">
                  {group.icon}
                </span>
                <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{group.heading}</span>
                {!collapsed && (
                  <>
                    <span className="shrink-0 rounded-full bg-rail-hover px-1.5 text-xs font-medium text-ink-muted" aria-hidden="true">
                      {group.items.length}
                    </span>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line-card text-ink-muted" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}>
                        <path d="m6 8 4 4 4-4" />
                      </svg>
                    </span>
                  </>
                )}
              </button>
              {open && (
                <ul id={listId} className={`mt-1 flex flex-col gap-0.5 ${collapsed ? "" : `ml-4 border-l-2 pl-2 ${accent.rule}`}`}>
                  {group.items.map((item) => {
                    const active = item.href === activeHref;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          title={collapsed ? item.label : undefined}
                          className={`flex min-h-11 items-center gap-2.5 rounded-md px-2 text-[15px] mouse:min-h-9 ${collapsed ? "justify-center" : ""} ${
                            active ? `${accent.tint} font-semibold text-ink` : "font-normal text-ink-body hover:bg-rail-hover hover:text-ink"
                          } ${focusRing}`}
                        >
                          {collapsed ? (
                            <span className={`shrink-0 ${accent.icon}`} aria-hidden="true">
                              {item.icon}
                            </span>
                          ) : (
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? accent.dot : "bg-line-card"}`} aria-hidden="true" />
                          )}
                          <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

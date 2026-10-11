"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { navGroupsFor } from "@/components/navItems";
import { activeTab, primaryTabs, type PrimaryTabKey } from "@/components/shell/primaryNav";
import type { BusinessScopeAnswers } from "@/lib/businessScope";
import type { Principal } from "@/lib/permissions";

const ICON_PATHS: Record<PrimaryTabKey, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9v11h13V9" />,
  jobs: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ),
  money: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  schedule: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
};

/**
 * The phone's navigation: Home · Jobs · Money · Schedule, fixed to the bottom
 * of the screen below Tailwind's `md`. Everything else is under the avatar's
 * "All pages" and in search.
 *
 * `<nav aria-label="Main">`, the same name the desktop top bar's words carry —
 * the two are never in the accessibility tree at once (`md:hidden` against
 * `hidden md:flex`), so "the shell's main navigation" is one idea at every
 * width. e2e/lib/health.ts looks for exactly that landmark.
 *
 * 56px of tabs plus the home-indicator inset (`env(safe-area-inset-bottom)`,
 * which is 0 unless the page opts into `viewport-fit=cover` — then the tabs
 * clear the indicator instead of sitting under it). The layout pads the
 * scroll port by the same amount so nothing hides under it.
 */
export function BottomTabs({
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
  const tabs = primaryTabs(navGroupsFor(principal, { showsInternal, businessScope, routesWithData }));
  const active = activeTab(pathname, true);

  return (
    <nav
      aria-label="Main"
      className="print:hidden fixed inset-x-0 bottom-0 z-40 grid border-t border-line-card bg-rail px-2.5 pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 py-1.5 text-[13px] font-semibold ${
              on ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            <span className={`flex rounded-full px-5 py-0.5 ${on ? "bg-brand text-neutral-900" : ""}`}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden="true"
              >
                {ICON_PATHS[tab.key]}
              </svg>
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

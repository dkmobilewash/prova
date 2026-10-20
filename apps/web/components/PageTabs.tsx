"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { EDGE_FADE } from "@/components/job/JobStageNav";
import { activeTab, type PageTab } from "@/components/pageTabsActive";

export type { PageTab } from "@/components/pageTabsActive";

/**
 * A row of link-tabs for a page that holds several jobs — generalised from
 * the job's `JobSectionNav` (density audit, pattern 3: /settings' 15
 * sections, /union-compliance's 6). Each tab is a real `<Link>` to a real
 * URL: linkable, back/forward work, a refresh re-renders from the database.
 *
 * Two URL shapes, and a page picks one:
 *
 *   sub-routes   /settings · /settings/quickbooks — active = pathname match.
 *   ?tab=        /union-compliance · /union-compliance?tab=setup — active =
 *                pathname match AND every param in the href matches the
 *                page's. The bare href (no params) is the default tab: it is
 *                active only when no sibling with params matches, so a
 *                `?tab=setup` visit does not light up both.
 *
 * Exactly one tab is current when the page is one of them. Narrow screens
 * scroll the row sideways, faded at the right edge, rather than wrapping.
 */
export function PageTabs({ tabs, label, className = "" }: { tabs: readonly PageTab[]; label: string; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const active = activeTab(tabs, pathname, search ?? new URLSearchParams());
  return (
    <nav aria-label={label} className={`${EDGE_FADE} -mx-6 mb-5 overflow-x-auto px-6 sm:mx-0 sm:px-0 print:hidden ${className}`}>
      <ul className="flex min-w-max gap-1 border-b border-line-row">
        {tabs.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap rounded-t-md border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus mouse:min-h-9 ${
                  isActive
                    ? "border-brand text-ink"
                    : "border-transparent text-ink-muted hover:border-line-card hover:bg-rail-hover hover:text-ink-body"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

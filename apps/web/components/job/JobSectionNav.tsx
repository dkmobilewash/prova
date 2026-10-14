"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EDGE_FADE } from "@/components/job/JobStageNav";
import type { JobTab } from "@/components/job/jobTabs";

/**
 * The job's tab row, directly under the stage boxes (`JobStageNav`): the
 * boxes say where the job is, this row is how you get around it. Restored
 * from the pre-#748 `components/JobSectionNav.tsx` in Concept G's tokens.
 * Each tab is a real `<Link>` to a real URL — linkable, back/forward work,
 * a refresh re-renders from the database.
 *
 * `tabs` comes from `jobTabs()`, already filtered to this viewer and stage.
 * Narrow screens scroll the row sideways, faded at the right edge, rather
 * than wrapping it.
 */
export function JobSectionNav({ tabs }: { tabs: JobTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Job sections" className={`${EDGE_FADE} -mx-6 mb-5 overflow-x-auto px-6 sm:mx-0 sm:px-0 print:hidden`}>
      <ul className="flex min-w-max gap-1 border-b border-line-row">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
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

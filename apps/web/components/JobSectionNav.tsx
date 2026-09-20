"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type JobSectionTab = {
  href: string;
  label: string;
};

/**
 * The tab rail across a job's sections — the load-bearing piece of this
 * rebuild, per PR #370's own doc comment (`BidWizardSteps.tsx`): each tab
 * is a real `<Link>` to a real URL, never client-side accordion state. A
 * section is linkable, back/forward work, and a refresh re-renders from
 * the database instead of a lost `useState`.
 *
 * `#370`'s stepper numbers its steps 1/2/3 because bid CREATION is a
 * short, one-time, ordered path. Managing a job afterward is the opposite
 * shape — open-ended, dipped into in any order — so this is tabs, not a
 * stepper: no numbering, no "current step" chip, just which one is open.
 *
 * `tabs` is pre-filtered by the caller (the layout) to exactly the
 * sections this viewer's capabilities and this job's stage would have
 * shown as sections in the old monolith — hiding a tab here is cosmetic,
 * same as `canReach` says of the sidebar; the route behind it is the
 * actual guard.
 */
export function JobSectionNav({ tabs }: { tabs: JobSectionTab[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Job sections" className="mb-6 -mx-6 overflow-x-auto px-6 print:hidden">
      <ul className="flex min-w-max gap-1 border-b border-line-card">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "border-brand text-ink"
                    : "border-transparent text-ink-muted hover:border-line-card hover:text-ink-label"
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

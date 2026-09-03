"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroupsFor } from "@/components/navItems";
import type { Principal } from "@/lib/permissions";

/**
 * The nav rail: 64px of icons, expanding to 240px on hover.
 *
 * It expands as an OVERLAY, not a layout push. A rail that widens by
 * shifting the page reflows everything you were reading the instant your
 * cursor drifts left, which is worse than no expansion at all.
 *
 * It stays dark under the light theme, deliberately. A dark rail against a
 * light canvas is what makes the chrome recede and the work come forward;
 * making everything light would leave the nav competing with the numbers.
 *
 * Group headings only appear expanded — eighteen icons in five silent
 * clusters is already legible by spacing, and a heading you cannot read at
 * 64px is just noise.
 */
export function Sidebar({ companyName, principal }: { companyName: string; principal: Principal }) {
  // Filtered here rather than in the layout so the desktop rail and
  // the mobile drawer run the same function on the same input.
  const groups = navGroupsFor(principal);
  const pathname = usePathname();

  return (
    // The 64px spacer holds the layout; the inner element is what grows,
    // so expansion never moves the content column.
    <div className="print:hidden hidden w-16 shrink-0 md:block">
      <nav
        aria-label="Main"
        className="group/rail fixed inset-y-0 left-0 z-40 flex w-16 flex-col overflow-hidden bg-rail transition-[width] duration-150 ease-out hover:w-60"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-semibold text-white">
            P
          </span>
          {/* Whitespace-nowrap so the label never wraps mid-transition. */}
          <span className="truncate whitespace-nowrap text-sm font-semibold text-white opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
            {companyName}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden py-3">
          {groups.map((group) => (
            <div key={group.heading} className="flex flex-col gap-0.5">
              <p
                className="h-4 truncate whitespace-nowrap px-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500 opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100"
                aria-hidden="true"
              >
                {group.heading}
              </p>

              {group.items.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);

                // A disabled item is not a link and not focusable. Nothing
                // is disabled today; the branch exists so a genuinely
                // unbuilt feature can be added without inventing a route
                // for it or faking a destination.
                if (item.disabled) {
                  return (
                    <span
                      key={item.href}
                      title={`${item.label} — coming soon`}
                      aria-disabled="true"
                      className="flex h-10 cursor-not-allowed items-center gap-3 px-4 text-sm font-medium text-slate-600"
                    >
                      <span className="shrink-0 opacity-50">{item.icon}</span>
                      <span className="truncate whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
                        {item.label}
                      </span>
                    </span>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    title={item.label}
                    className={`flex h-10 items-center gap-3 px-4 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-rail-hover text-white"
                        : "text-slate-400 hover:bg-rail-hover hover:text-white"
                    }`}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="truncate whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}

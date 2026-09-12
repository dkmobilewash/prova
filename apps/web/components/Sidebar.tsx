"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroupsFor } from "@/components/navItems";
import { useNavAccordion } from "@/components/useNavAccordion";
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
 * Groups collapse (#240, 11 Sep 2026). Every group used to render open —
 * 27 labels to read to find anything. Now each group is a header that
 * toggles, only the group holding the current page is open, and the six
 * headers plus one open group fit a laptop screen without scrolling. At
 * 64px a header is its group's icon; expanded, it is the heading with a
 * chevron. The open-group rule lives in useNavAccordion, shared with the
 * mobile drawer.
 */
export function Sidebar({
  companyName,
  principal,
  showsSalesCrm = false,
}: {
  companyName: string;
  principal: Principal;
  /** Prova's own operating company only -- see Company.isProvaOperator. */
  showsSalesCrm?: boolean;
}) {
  // Filtered here rather than in the layout so the desktop rail and
  // the mobile drawer run the same function on the same input.
  const groups = navGroupsFor(principal, { showsSalesCrm });
  const pathname = usePathname();
  const { open, active, toggle } = useNavAccordion(groups, pathname);

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

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-3">
          {groups.map((group) => {
            const isOpen = open === group.heading;
            const holdsPage = active === group.heading;
            const panelId = `rail-${group.heading.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

            return (
              <div key={group.heading} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => toggle(group.heading)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  title={group.heading}
                  data-nav-group={group.heading}
                  className={`flex h-10 w-full items-center gap-3 px-4 text-left text-sm font-medium transition-colors ${
                    isOpen || holdsPage
                      ? "text-white"
                      : "text-slate-400 hover:bg-rail-hover hover:text-white"
                  }`}
                >
                  <span className="shrink-0">{group.icon}</span>
                  <span className="flex-1 truncate whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
                    {group.heading}
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 opacity-0 transition-[opacity,transform] duration-150 group-hover/rail:opacity-100 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  >
                    <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <div id={panelId} hidden={!isOpen} className="flex flex-col gap-0.5 pb-2">
                  {group.items.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                    // A disabled item is not a link and not focusable. As of
                    // 3 Sep 2026, /safety and /material-orders render this way
                    // deliberately (see navItems.tsx) despite being built and
                    // working — the branch exists for exactly that case too,
                    // not only for a genuinely unbuilt feature.
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
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

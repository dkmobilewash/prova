"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroupsFor } from "@/components/navItems";
import { useNavAccordion } from "@/components/useNavAccordion";
import type { Principal } from "@/lib/permissions";

/**
 * Navigation on a phone.
 *
 * The app assumed a desktop: a fixed 240px rail on a 360px screen leaves a
 * third of the width to actually work in. Half a subcontractor's people are
 * in the field, so that is not a cosmetic problem — it is most of the crew
 * unable to use the thing.
 *
 * The rail is now desktop-only and these are the same links in a drawer.
 * One shared NAV_ITEMS list, so the two can never disagree about what pages
 * exist — and since #240 one shared open-group rule (useNavAccordion), so
 * they cannot disagree about which group is open either.
 */
export function MobileNav({
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
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const accordion = useNavAccordion(groups, pathname);

  // Navigating closes it. Without this the drawer stays over the page you
  // just asked for, which reads as the tap not having worked.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-nav"
        // 44px, from 36px. This is the gateway to every field screen on a
        // phone, and it was the smallest control in the chrome. The icon still
        // draws at 20px; only the hit area grew, and `-ml-3` keeps its left
        // edge where it was against the topbar's px-4.
        className="-ml-3 rounded-md p-3 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-slate-950/70"
          />
          <div
            id="mobile-nav"
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-slate-800 bg-slate-900"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 px-5 py-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold tracking-tight text-slate-100">Prova</span>
                <span className="truncate text-xs text-slate-400">{companyName}</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="-mr-3 -mt-2 rounded-md p-3 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Still scrolls on its own so the close button stays in reach
                on a short screen, though with one group open at a time
                it rarely needs to. Grouped exactly like the desktop rail,
                with the same group open — one nav, two shapes. */}
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              {groups.map((group) => {
                const isOpen = accordion.open === group.heading;
                const holdsPage = accordion.active === group.heading;
                const panelId = `drawer-${group.heading.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

                return (
                  <div key={group.heading} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => accordion.toggle(group.heading)}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      data-nav-group={group.heading}
                      // 44px: a header is now a tap target, and it sits in
                      // the same stack a gloved thumb works down.
                      className={`flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider ${
                        isOpen || holdsPage ? "text-slate-100" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                      }`}
                    >
                      <span className="shrink-0">{group.icon}</span>
                      <span className="flex-1">{group.heading}</span>
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        aria-hidden="true"
                        className={`h-4 w-4 shrink-0 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                      >
                        <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>

                    <div id={panelId} hidden={!isOpen} className="flex flex-col gap-0.5 pb-1 pl-2">
                      {group.items.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                        // Same rule as the desktop rail (Sidebar.tsx) -- a disabled
                        // item is not a link. Without this branch a phone could
                        // reach a page the rail calls "coming soon", which is
                        // exactly the drift this shared list exists to prevent.
                        if (item.disabled) {
                          return (
                            <span
                              key={item.href}
                              title={`${item.label} — coming soon`}
                              aria-disabled="true"
                              className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-600"
                            >
                              <span className="opacity-50">{item.icon}</span>
                              {item.label}
                            </span>
                          );
                        }

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                            // py-3, not py-2.5: 44px instead of 40px. These sit
                            // directly on top of each other in a scrolling list, which
                            // is exactly where a gloved thumb lands on the wrong one.
                            className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors ${
                              isActive
                                ? "bg-blue-500/15 text-blue-300"
                                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                            }`}
                          >
                            {item.icon}
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>
        </>
      )}
    </div>
  );
}

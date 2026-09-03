"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroupsFor } from "@/components/navItems";
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
 * exist.
 */
export function MobileNav({ companyName, principal }: { companyName: string; principal: Principal }) {
  // Filtered here rather than in the layout so the desktop rail and
  // the mobile drawer run the same function on the same input.
  const groups = navGroupsFor(principal);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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

            {/* The list is longer than a phone screen, so it scrolls on its
                own rather than pushing the close button out of reach. */}
            {/* Grouped exactly like the desktop rail. It was a flat list
                in a different order, which is the same drift this file's
                shared NAV list exists to prevent — one nav, two shapes. */}
            <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
              {groups.flatMap((group) => [
                <p
                  key={group.heading}
                  // slate-400: slate-500 measures 3.83:1 on this ground, under
                  // the 4.5 floor, and at 10px it is the first thing sunlight
                  // takes away.
                  className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
                >
                  {group.heading}
                </p>,
                ...group.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                }),
              ])}
            </nav>
          </div>
        </>
      )}
    </div>
  );
}

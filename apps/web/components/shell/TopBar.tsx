"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { AskLauncher } from "@/components/AskLauncher";
import { HelpButton } from "@/components/HelpButton";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { navFooterFor, navGroupsFor } from "@/components/navItems";
import { AllPagesMenu } from "@/components/shell/AllPagesMenu";
import { areasFor } from "@/lib/areas";
import { SearchTrigger } from "@/components/shell/SearchTrigger";
import { AiCountBadge, AiSpark } from "@/components/ai/AiMark";
import { activeTab, initialsFor, primaryTabs } from "@/components/shell/primaryNav";
import type { BusinessScopeAnswers } from "@/lib/businessScope";
import type { HelpChannel } from "@/lib/help-request";
import type { MoneyRailStage } from "@/lib/moneyRail";
import type { Principal } from "@/lib/permissions";

/**
 * The Concept G top bar — the whole of the desktop navigation now that the
 * left rail is gone: the C Stream wordmark (home), the words (Jobs · Money
 * · Schedule · AI), search, and an avatar menu that holds everything else,
 * including "All pages", which is every destination the rail used to list.
 *
 * Below `md` it shrinks to wordmark, a search icon and the avatar; the
 * words move to BottomTabs.tsx at the bottom of the screen.
 *
 * Kept from the old Topbar, each for the reason written on it there:
 *  - Ask (AskLauncher): an empty state's "Ask" button clicks
 *    `[data-ask-launcher]`, so the launcher has to be mounted on every page;
 *  - Help (HelpButton): the only way to reach a person from inside the app;
 *  - the alert count: it moved from a bell onto the avatar. Zero draws no
 *    badge, but the menu always lists Alerts with its count, so the door is
 *    never hidden.
 *
 * A CLIENT COMPONENT mounted by components/AppChrome.tsx, for the Flight
 * deferral reason that file's header gives. Everything here is plain data.
 */
export function TopBar({
  companyName,
  userName,
  userEmail,
  alertCount,
  principal,
  showsInternal = false,
  businessScope,
  routesWithData,
  helpChannel,
  stages,
  aiFindingCount = 0,
}: {
  companyName: string;
  userName: string | null;
  userEmail: string | null;
  alertCount: number;
  principal: Principal;
  showsInternal?: boolean;
  businessScope?: BusinessScopeAnswers;
  routesWithData?: readonly string[];
  /** Resolved on the SERVER by `helpChannelFromEnv()` — lib/help-config.ts
   * reads process.env and cannot be in a browser bundle. */
  helpChannel: HelpChannel;
  /** The five Money Rail figures for the "All pages" headings — loaded by
   * the layout only behind VIEW_COMPANY_FINANCIALS, else empty. */
  stages: MoneyRailStage[];
  /** Open agent findings, for the badge on the AI word. Loaded by the
   * layout only behind MANAGE_ESTIMATING — the same capability that draws
   * the word — else 0, which draws no badge. */
  aiFindingCount?: number;
}) {
  const pathname = usePathname();
  const groups = navGroupsFor(principal, { showsInternal, businessScope, routesWithData });
  const footer = navFooterFor(principal);
  // Desktop has no Home word: the wordmark is the way home.
  const words = primaryTabs(groups).filter((tab) => tab.key !== "home");
  const active = activeTab(pathname, false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const avatar = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  // Esc or Close on "All pages" hands focus back to the avatar it was opened
  // from (the menu row that opened it is gone by then). A navigation closes
  // it too, but through the effect below, which leaves focus to the new page.
  const closeAll = useCallback(() => {
    setAllOpen(false);
    requestAnimationFrame(() => avatar.current?.focus());
  }, []);
  const menuHolder = useRef<HTMLDivElement>(null);
  const clerk = useClerk();

  // A navigation closes both: a menu left over the page you just asked for
  // reads as the click not having worked.
  useEffect(() => {
    setMenuOpen(false);
    setAllOpen(false);
  }, [pathname]);

  // The avatar menu is a disclosure, not an ARIA menu: focus moves to its
  // first row, Tab walks its rows, and Tab past either end (or a click
  // outside) closes it. Esc closes it and puts focus back on the avatar.
  useEffect(() => {
    if (!menuOpen) return;
    menuPanel.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      avatar.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (menuHolder.current && !menuHolder.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (menuHolder.current && !menuHolder.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [menuOpen]);

  const alertLabel = alertCount === 0 ? "nothing needs you" : `${alertCount > 99 ? "99+" : alertCount} need you`;
  const menuRow =
    "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] text-ink-body hover:bg-rail-hover hover:text-ink";

  return (
    <>
      <header className="print:hidden relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-line-row bg-canvas px-4 md:h-16 md:gap-10 md:px-6 lg:px-12">
        <Link
          href="/dashboard"
          aria-label={`C Stream — ${companyName} home`}
          className="flex shrink-0 items-center gap-2.5 rounded-md font-headline text-[22px] leading-none text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:text-2xl"
        >
          <Image src="/brand/cstream-mark.png" alt="" width={28} height={28} className="logo-on-theme h-7 w-7 object-contain" priority />
          C Stream
        </Link>

        <nav aria-label="Main" className="hidden h-full items-stretch gap-8 md:flex">
          {words.map((tab) => {
            const on = tab.key === active;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={on ? "page" : undefined}
                aria-label={tab.key === "ai" && aiFindingCount > 0 ? `AI, ${aiFindingCount} open findings` : undefined}
                className={`flex items-center gap-[7px] border-b-2 pt-0.5 text-base font-medium ${
                  on ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {tab.key === "ai" && <AiSpark className={`h-4 w-4 ${on ? "text-brand" : ""}`} />}
                {tab.label}
                {tab.key === "ai" && aiFindingCount > 0 && <AiCountBadge count={aiFindingCount} />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 md:gap-3">
          <div className="hidden md:block">
            <SearchTrigger size="sm" />
          </div>
          <button
            type="button"
            aria-label="Search or ask"
            onClick={() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } }))}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-body hover:bg-rail-hover hover:text-ink md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
          <AskLauncher />
          <HelpButton companyName={companyName} channel={helpChannel} />

          <div ref={menuHolder} className="relative md:ml-4">
            <button
              ref={avatar}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="avatar-menu"
              aria-label={`Your menu — ${userName ?? userEmail ?? "account"}${alertCount > 0 ? `, ${alertCount} alerts` : ""}`}
              onClick={() => setMenuOpen((v) => !v)}
              className="relative flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full border border-line-card bg-rail-hover text-[13px] font-semibold text-ink">
                {initialsFor(userName, userEmail)}
              </span>
              {alertCount > 0 && (
                <span className="absolute -right-0.5 top-0 min-w-[1.15rem] rounded-full bg-tag-rose px-1 text-center text-[0.65rem] font-semibold leading-[1.15rem] text-tag-rose-ink ring-1 ring-tag-rose-ink/40">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </button>

            {menuOpen && (
              <div
                ref={menuPanel}
                id="avatar-menu"
                className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-line-card bg-surface p-2 shadow-2xl">
                <div className="px-3 pb-2 pt-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{userName ?? userEmail ?? "Signed in"}</p>
                  <p className="truncate text-[13px] text-ink-muted">{companyName}</p>
                </div>
                <div className="border-t border-line-row pt-1">
                  <Link href="/alerts" className={menuRow}>
                    Alerts <span className="ml-auto text-[13px] text-ink-muted">{alertLabel}</span>
                  </Link>
                  {footer.map((item) => (
                    <Link key={item.href} href={item.href} className={menuRow}>
                      {item.label}
                    </Link>
                  ))}
                  <button
                    type="button"
                    className={menuRow}
                    onClick={() => {
                      setMenuOpen(false);
                      setAllOpen(true);
                    }}
                  >
                    All pages
                  </button>
                </div>
                <div className="border-t border-line-row px-1 py-2">
                  <ThemeSwitch />
                </div>
                <div className="border-t border-line-row pt-1">
                  <button type="button" className={menuRow} onClick={() => clerk.openUserProfile()}>
                    Your account
                  </button>
                  <button type="button" className={menuRow} onClick={() => clerk.signOut({ redirectUrl: "/" })}>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      <AllPagesMenu open={allOpen} onClose={closeAll} groups={groups} footer={footer} stages={stages} areas={areasFor(principal)} />
    </>
  );
}

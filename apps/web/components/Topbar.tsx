"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { MobileNav } from "@/components/MobileNav";
import { SearchLauncher } from "@/components/SearchLauncher";
import { AskLauncher } from "@/components/AskLauncher";
import { HelpButton } from "@/components/HelpButton";
import type { HelpChannel } from "@/lib/help-request";
import type { Principal } from "@/lib/permissions";
import type { BusinessScopeAnswers } from "@/lib/businessScope";

/** Dark chrome: the charcoal bar (#171717, same surface as the rail)
 * with the 2px brand-yellow rule under it, per the approved dark
 * mockups. Chrome and rail read as one continuous frame around the
 * #0f0f0f canvas — that seamlessness is the design, not a leftover.
 *
 * A CLIENT COMPONENT since 2026-09-25, and for the same reason MetricBar
 * beside it is one. Everything this bar renders is a client component
 * already (MobileNav, SearchLauncher, AskLauncher, HelpButton, Clerk's
 * UserButton); while this file was a SERVER component each of those was an
 * element created on the server and serialized through React's Flight
 * payload, which defers any element it reaches past 3,200 bytes and hands
 * the browser a lazy instead. Inside `<ShellRegion>`'s `<Suspense>` that
 * deferral is a hydration mismatch on one page load in three — see
 * components/AppChrome.tsx, which is what mounts this now.
 *
 * The one thing that had to move out is the help channel. It is read from
 * configuration (`helpChannelFromEnv()` in lib/help-config.ts, which reads
 * `process.env` and imports the `@prova/integrations` barrel), so it is
 * resolved in app/(app)/layout.tsx and passed down as plain data. */
export function Topbar({
  companyName,
  /** Alerts needing attention. Lives in the chrome rather than on the
   * dashboard because a warning that only appears on one page reaches
   * whoever happens to open that page — which is how "expiration alerts"
   * stayed Partial in FEATURE-AUDIT while being visibly implemented.
   * Zero renders the bell without a count rather than hiding it: a
   * control that disappears when it has nothing to say cannot be trusted
   * to appear when it does. */
  alertCount,
  principal,
  showsInternal = false,
  businessScope,
  helpChannel,
}: {
  companyName: string;
  alertCount: number;
  principal: Principal;
  /** Prova's own operating company only -- see Company.isProvaOperator. */
  showsInternal?: boolean;
  /** The three onboarding questions' answers, or undefined for "hide
   * nothing" — see navGroupsFor in navItems.tsx. */
  businessScope?: BusinessScopeAnswers;
  /** Resolved on the SERVER by `helpChannelFromEnv()` — see the note at the
   * top of this file. Plain data, so the panel can only offer what the
   * action will accept. */
  helpChannel: HelpChannel;
}) {
  return (
    <div className="print:hidden flex h-14 shrink-0 items-center justify-between gap-3 border-b-2 border-brand bg-rail px-4 sm:px-6">
      {/* Renders nothing above md — the desktop rail is always visible there. */}
      <MobileNav companyName={companyName} principal={principal} showsInternal={showsInternal} businessScope={businessScope} />
      <div className="ml-auto flex items-center gap-3">
        {/* Search, on every page, first — left of Ask, the bell and the
            avatar. It is the safety net that lets features come off the
            sidebar: if a small contractor's simplified nav hides
            certified payroll, typing its name here still finds it. That
            makes it the thing reached for before a question gets asked,
            which is why it moved ahead of Ask rather than beside it. */}
        <SearchLauncher />
        {/* Ask, on every page. It sits after Search — left of the bell and
            the avatar — because it is the next thing people are meant to
            reach for, and chrome reads left to right in order of intent. */}
        <AskLauncher />
        {/* Help sits AFTER Ask on purpose: the assistant answers most
            questions and is the cheaper thing to try, so it is reached
            first. Help is for when it could not. */}
        {/* The only way to reach a person from inside the app, and it is
            here rather than on a page because a help link that exists on
            one screen is not help — see HelpButton for the two shapes this
            rejected. The channel is resolved server-side so the panel can
            only offer what the action will accept. */}
        <HelpButton companyName={companyName} channel={helpChannel} />
        <Link
          href="/alerts"
          aria-label={
            alertCount === 0
              ? "Alerts — nothing needs attention"
              : `Alerts — ${alertCount} needing attention`
          }
          className="relative rounded-md p-2 text-ink-body hover:bg-rail-hover hover:text-ink"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
            <path
              d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5c0 3-1.5 4-1.5 4h12s-1.5-1-1.5-4A4.5 4.5 0 0 0 10 3.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M8.5 14.5a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[1.15rem] rounded-full bg-red-600 px-1 text-center text-[0.65rem] font-semibold leading-[1.15rem] text-white">
              {alertCount > 99 ? "99+" : alertCount}
            </span>
          )}
        </Link>
        <UserButton />
      </div>
    </div>
  );
}

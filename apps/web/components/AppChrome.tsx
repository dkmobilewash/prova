"use client";

import { FullTour } from "@/components/FullTour";
import { MetricBar } from "@/components/MetricBar";
import { ShellRegion } from "@/components/ShellRegion";
import { Sidebar } from "@/components/Sidebar";
import { TimeZoneCookie } from "@/components/TimeZoneCookie";
import { Topbar } from "@/components/Topbar";
import type { BusinessScopeAnswers } from "@/lib/businessScope";
import type { CompanyFinancials } from "@/lib/company-financials";
import type { HelpChannel } from "@/lib/help-request";
import type { MoneyRailStage } from "@/lib/moneyRail";
import type { Principal } from "@/lib/permissions";

/**
 * The five shell regions, each paired with its widget IN THE BROWSER'S OWN
 * MODULE. Every export here is `<ShellRegion region="…"><Widget …/></ShellRegion>`
 * and nothing else; `app/(app)/layout.tsx` renders these instead of pairing
 * the two itself.
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT TIDINESS. Until 2026-09-25 the layout —
 * a SERVER component — wrote the pairing out itself:
 *
 *     <ShellRegion region="sidebar"><Sidebar …/></ShellRegion>
 *
 * `ShellRegion` is a client component, so `<Sidebar …/>` was an element
 * created on the server and handed across the RSC boundary as that client
 * component's `children`. React's PRODUCTION Flight serializer defers any
 * element it reaches once the current serialized row has passed 3,200 bytes,
 * writing `$L<id>` in its place, and the browser turns that back into a LAZY
 * — the same threshold `components/Hint.tsx` documents at length, and the
 * reason none of this is reproducible in `next dev`, where it does not exist.
 *
 * A lazy SUSPENDS, and `ShellRegion` wraps its children in a `<Suspense>`
 * (which has to stay — see that file). A suspended shell boundary is streamed
 * out of order and hydration can then race the script that completes it,
 * which is a React #418 ELEMENT-level mismatch: the server's HTML has a
 * pending boundary where the browser's first render has the sidebar. What a
 * person saw was the rail and the top bar re-rendering a beat after the page
 * appeared, on about one signed-in page load in three. PR #501 measured the
 * rate; CLAUDE.md's #418 entry carries all of the evidence.
 *
 * ONE THING THIS DOES NOT DO, stated here because the marker it leaves behind
 * is the first thing anyone will look at. It does not stop the shell being
 * streamed out of order, and nothing in app code can: React ALSO outlines a
 * boundary that never suspended, purely for being bigger than
 * `progressiveChunkSize` (12,800 bytes), and the sidebar's markup measures
 * 13,442. Counted on a local production build before and after this change:
 * three pending boundaries either way, byte-identical. The `<template id="B:`
 * pairs are therefore not a measure of this fix, and were never a measure of
 * suspension. Step 11 of the pilot journey is the measure.
 *
 * An element created inside THIS module is created by whoever is rendering
 * it — Fizz on the server, React on the client — and never travels through
 * Flight, so it cannot be deferred, cannot be a lazy, and cannot suspend.
 * The props below are all plain data (strings, numbers, booleans, and objects
 * of those), which the serializer never defers.
 *
 * WHAT THIS DOES NOT CHANGE. Every region still has its own boundary, so a
 * widget that throws is still replaced by a quiet fallback of the same height
 * and the page it frames still survives — the 2026-09-21 property, and
 * `shellRegion.test.ts` still proves it with its own controls. The regions
 * take NO `children` prop, deliberately: the page must never end up inside
 * one, and a region that cannot be given children cannot be given the page.
 */

export function TimeZoneCookieRegion() {
  return (
    <ShellRegion region="helper">
      <TimeZoneCookie />
    </ShellRegion>
  );
}

export function FullTourRegion({ principal }: { principal: Principal }) {
  return (
    <ShellRegion region="helper">
      <FullTour principal={principal} />
    </ShellRegion>
  );
}

export function SidebarRegion({
  companyName,
  principal,
  showsInternal,
  businessScope,
  stages,
}: {
  companyName: string;
  principal: Principal;
  showsInternal: boolean;
  businessScope: BusinessScopeAnswers;
  stages: MoneyRailStage[];
}) {
  return (
    <ShellRegion region="sidebar">
      <Sidebar
        companyName={companyName}
        principal={principal}
        showsInternal={showsInternal}
        businessScope={businessScope}
        stages={stages}
      />
    </ShellRegion>
  );
}

export function TopbarRegion({
  companyName,
  alertCount,
  principal,
  showsInternal,
  businessScope,
  helpChannel,
}: {
  companyName: string;
  alertCount: number;
  principal: Principal;
  showsInternal: boolean;
  businessScope: BusinessScopeAnswers;
  /** Resolved on the SERVER by `helpChannelFromEnv()` and passed down as
   * plain data. It cannot be read here: `lib/help-config.ts` reads
   * `process.env` and pulls in the `@prova/integrations` barrel, neither of
   * which belongs in a browser bundle. */
  helpChannel: HelpChannel;
}) {
  return (
    <ShellRegion region="topbar">
      <Topbar
        companyName={companyName}
        alertCount={alertCount}
        principal={principal}
        showsInternal={showsInternal}
        businessScope={businessScope}
        helpChannel={helpChannel}
      />
    </ShellRegion>
  );
}

export function MetricBarRegion({ financials }: { financials: CompanyFinancials }) {
  return (
    <ShellRegion region="metricbar">
      <MetricBar financials={financials} />
    </ShellRegion>
  );
}

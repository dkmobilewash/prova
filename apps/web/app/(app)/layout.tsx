import { requireCompanyContext } from "@/lib/auth";
import { loadCompanyFinancials } from "@/lib/company-financials-query";
import { getMoneyRailStages } from "@/lib/moneyRail";
import { countVisibleAlerts } from "@/lib/alerts-query";
import { can, type Principal } from "@/lib/permissions";
import { viewerToday } from "@/lib/viewerToday";
import { helpChannelFromEnv } from "@/lib/help-config";
import {
  FullTourRegion,
  MetricBarRegion,
  SidebarRegion,
  TimeZoneCookieRegion,
  TopbarRegion,
} from "@/components/AppChrome";
import { ShellRegionFallback } from "@/components/ShellRegion";
import { shellQueryFailed } from "@/lib/shell-region-failure";
import type { BusinessScopeAnswers } from "@/lib/businessScope";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, ...currentUser } = await requireCompanyContext();
  const principal: Principal = {
    role: currentUser.role,
    jobFunction: currentUser.jobFunction,
  };
  // Prova's own pages, for exactly one company -- the sales pipeline and
  // the usage instrument (/internal/usage). See Company.isProvaOperator.
  // Not a lib/permissions.ts Capability: that map is about job function
  // within a company, and an OWNER always holds every capability in it
  // regardless, which cannot express "owner only."
  //
  // Renamed from showsSalesCrm 2026-09-13, when the Internal group stopped
  // being one page: a flag named after one of the two it gates is a
  // comment that disagrees with the code.
  const showsInternal = company.isProvaOperator && currentUser.role === "OWNER";

  // The three onboarding questions' answers, straight off the Company row —
  // see lib/businessScope.ts. Passed to both nav surfaces below so a route
  // hidden by them can never disagree between the desktop rail and the
  // mobile drawer, same reasoning as showsInternal just above.
  const businessScope: BusinessScopeAnswers = {
    contractingRelationship: company.contractingRelationship,
    doesPublicWork: company.doesPublicWork,
    filesMonthlyPayApps: company.filesMonthlyPayApps,
  };

  // The onboarding PROMPT used to be mounted here as a modal, shown over
  // whatever page happened to be on screen. That was the defect: it
  // painted a card over an already-visible sidebar, so the four seconds
  // this feature exists to own were already spent (Cyrus watched it appear
  // over /messages). It is a real page now — app/welcome/page.tsx, reached
  // by a redirect from app/(app)/dashboard/page.tsx ONLY — so this layout
  // has nothing to do with it any more. See lib/onboarding-gate.ts.

  // The reader's own calendar day, not the server's UTC one. At 18:00 in
  // Los Angeles the UTC date is already tomorrow, so this badge counted a
  // follow-up due today as OVERDUE every evening — issue #111 item 1. Read
  // before the two queries rather than inside the Promise.all, so it does
  // not serialise them: it is a cookie read, not a round trip.
  const today = await viewerToday();

  // The two money queries are settled, not awaited bare: a query that
  // chokes on one strange invoice must cost its own region, never the page.
  // See lib/shell-region-failure.ts for why the alert count is NOT settled.
  const [financials, alertCount, moneyRailStages] = await Promise.all([
    loadCompanyFinancials(company.id).catch(shellQueryFailed("metricbar", null)),
    // In the layout, so the count is on every screen. Derived on each
    // render like everything else here — there is no stored unread count
    // to go stale against the records it is counting. Scoped to this
    // person, and dated the same way /alerts is, so the badge and the list
    // cannot disagree about how many there are.
    countVisibleAlerts(company.id, currentUser.id, today, principal),
    // The Money Rail's five figures — loaded here, server-side, because
    // this is the component that already holds the company context. The
    // Sidebar renders them verbatim; every number is computed in
    // lib/moneyRail.ts and nowhere else.
    //
    // Gated like MetricBar below, and for the same written-down reason:
    // the Sidebar is a client component, so whatever is passed here is
    // serialized to the browser for EVERY principal — found by the
    // 2026-09-19 security audit painting company-wide bid, contract and
    // retainage dollars on a FIELD user's rail, the one job function
    // lib/permissions.ts deliberately strips of all money. No capability
    // means no figures: the rail renders its headings without them, and
    // the queries never run.
    can(principal, "VIEW_COMPANY_FINANCIALS")
      ? getMoneyRailStages(company.id).catch(shellQueryFailed("sidebar", []))
      : Promise.resolve([]),
  ]);
  return (
    // h-screen with the content column scrolling inside it, so the metric
    // bar sits at the bottom of the column and stays there — pinned to the
    // content, never over the rail.
    //
    // The two chrome heights are declared once here and read back as
    // --shell-port, so anything that must fit inside the scroll port (the
    // side panel) is bounded by the same numbers the bars are laid out
    // with, rather than repeating them and drifting.
    //
    // Every shell region below is ONE client component from
    // components/AppChrome.tsx, and that indirection is load-bearing rather
    // than tidy. Each of those components pairs the region's <ShellRegion>
    // boundary with its widget inside the BROWSER'S OWN module. Writing the
    // pairing out here instead — <ShellRegion region="sidebar"><Sidebar …/>
    // </ShellRegion> — means the <Sidebar> element is created by a SERVER
    // component and has to cross the RSC boundary as a client component's
    // children, where React's production Flight serializer defers it past
    // 3,200 bytes and the browser turns it into a LAZY. A lazy suspends the
    // region's Suspense, and that is the 2026-09-21 outage's own trap
    // (components/Hint.tsx) one door along. See AppChrome.tsx's header,
    // CLAUDE.md's #418 entry, and PR #501 — including the part of that entry
    // that says a `B:`/`S:` marker pair in the shell is NOT evidence of this:
    // React also streams a boundary late for being merely big.
    //
    // A region that throws is still replaced by a quiet fallback of the same
    // height and the page keeps working. The page itself ({children}) is
    // deliberately NOT inside a region — app/(app)/error.tsx owns that and
    // must stay loud, and the region components take no children at all, so
    // it cannot end up in one. See components/ShellRegion.tsx;
    // shellRegion.test.ts fails the build if a shell widget is paired here.
    <div className="flex h-screen bg-canvas [--shell-metricbar:52px] [--shell-topbar:56px]">
      {/* Renders nothing. Parks the browser's IANA zone in a cookie so
          the server can work out what day it is where the reader is. */}
      <TimeZoneCookieRegion />
      {/* "Take the full tour": renders nothing until someone starts it.
          Here rather than on a page because it moves between pages. */}
      <FullTourRegion principal={principal} />
      <SidebarRegion
        companyName={company.name}
        principal={principal}
        showsInternal={showsInternal}
        businessScope={businessScope}
        stages={moneyRailStages}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopbarRegion
          companyName={company.name}
          alertCount={alertCount}
          principal={principal}
          showsInternal={showsInternal}
          businessScope={businessScope}
          // Resolved HERE, on the server: lib/help-config.ts reads
          // process.env and imports the @prova/integrations barrel, neither
          // of which belongs in a browser bundle. The topbar is a client
          // component now, so it is handed the answer, not the question.
          helpChannel={helpChannelFromEnv()}
        />
        {/* No background of its own: each page brings its own ground, so a
            page still written against the dark theme keeps it and a
            converted one opts into the light canvas. */}
        <main className="min-h-0 flex-1 overflow-y-auto [--shell-port:calc(100dvh-var(--shell-topbar)-var(--shell-metricbar))]">
          {children}
        </main>
        {/* The metric bar is company-wide money on every screen — backlog,
            blended margin, cash collected. Withheld from anyone without
            VIEW_COMPANY_FINANCIALS, because a permission enforced on
            /cash-flow and then rendered along the bottom of every other
            page is not enforced at all. A null here means its query failed
            above and was logged; the region shows its fallback instead. */}
        {can(principal, "VIEW_COMPANY_FINANCIALS") &&
          (financials ? (
            <MetricBarRegion financials={financials} />
          ) : (
            <ShellRegionFallback region="metricbar" />
          ))}
      </div>
    </div>
  );
}

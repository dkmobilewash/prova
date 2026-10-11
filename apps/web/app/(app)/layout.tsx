import { requireCompanyContext } from "@/lib/auth";
import { getMoneyRailStages } from "@/lib/moneyRail";
import { countVisibleAlerts } from "@/lib/alerts-query";
import { can, type Principal } from "@/lib/permissions";
import { viewerToday } from "@/lib/viewerToday";
import { helpChannelFromEnv } from "@/lib/help-config";
import {
  BottomTabsRegion,
  CommandPaletteRegion,
  FullTourRegion,
  NavigationProgressRegion,
  TimeZoneCookieRegion,
  TopBarRegion,
} from "@/components/AppChrome";
import { shellQueryFailed } from "@/lib/shell-region-failure";
import { routesHiddenByAnswers, type BusinessScopeAnswers } from "@/lib/businessScope";
import { loadRoutesWithData } from "@/lib/businessScopeData";

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
  // hidden by them can never disagree between the desktop top bar and the
  // phone's bottom tabs, same reasoning as showsInternal just above.
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

  // WHICH ROUTES THE ANSWERS WOULD HIDE, AND WHICH OF THOSE THE COMPANY
  // ALREADY HAS ROWS BEHIND. The first half is pure (lib/businessScope.ts)
  // and free; the second is one query, and asking it only when the first
  // half found something is most of the cost saving. Every company that
  // skipped the onboarding prompt — which is every company that predates it
  // — hides nothing, so `candidates` is empty and no query runs at all.
  //
  // The rows win over the answers: a company that logged backcharges under
  // a GC and later answered "direct for owners" keeps the door to disputes
  // it is still inside of. See lib/businessScopeData.ts for why, and for
  // why one raw EXISTS statement rather than four findFirsts — this layout
  // renders CONCURRENTLY with the page beneath it and `DATABASE_URL`
  // carries connection_limit=5, so extra parallel probes are pool slots at
  // the tightest moment.
  const scopeCandidates = routesHiddenByAnswers(businessScope);

  // The money query is settled, not awaited bare: a query that chokes on
  // one strange invoice must cost its own region, never the page. See
  // lib/shell-region-failure.ts for why the alert count is NOT settled.
  //
  // The company figures (estimated revenue, margin, cash, retainage) USED to
  // load here for the bottom metric bar. Concept G has no bottom strip — it
  // sat over the foot of every page and covered "Review & send" on a job's
  // Billing stage — so they load on /areas/money instead, behind the same
  // VIEW_COMPANY_FINANCIALS gate (app/(app)/areas/[slug]/page.tsx).
  const [alertCount, moneyRailStages, routesWithData] = await Promise.all([
    // In the layout, so the count is on every screen. Derived on each
    // render like everything else here — there is no stored unread count
    // to go stale against the records it is counting. Scoped to this
    // person, and dated the same way /alerts is, so the badge and the list
    // cannot disagree about how many there are.
    countVisibleAlerts(company.id, currentUser.id, today, principal),
    // The Money Rail's five figures — loaded here, server-side, because
    // this is the component that already holds the company context. Since
    // Concept G removed the rail they sit on the group headings of the top
    // bar's "All pages" panel, rendered verbatim; every number is computed
    // in lib/moneyRail.ts and nowhere else.
    //
    // Gated, and for a written-down reason:
    // the top bar is a client component, so whatever is passed here is
    // serialized to the browser for EVERY principal — found by the
    // 2026-09-19 security audit painting company-wide bid, contract and
    // retainage dollars on a FIELD user's rail, the one job function
    // lib/permissions.ts deliberately strips of all money. No capability
    // means no figures: the rail renders its headings without them, and
    // the queries never run.
    can(principal, "VIEW_COMPANY_FINANCIALS")
      ? getMoneyRailStages(company.id).catch(shellQueryFailed("topbar", []))
      : Promise.resolve([]),
    // In the same Promise.all as the three above so it costs no extra
    // wall-clock latency, and skipped entirely when nothing would be
    // hidden. NOT settled with shellQueryFailed: this is not a region's
    // figures, it is an input to which links the rail draws, and
    // `loadRoutesWithData` already fails OPEN on its own — a probe that
    // throws reports every route as having data, so the rail shows
    // everything rather than hiding a door it could not check. See its own
    // comment for why that is the safe direction.
    scopeCandidates.length > 0 ? loadRoutesWithData(company.id) : Promise.resolve<string[]>([]),
  ]);
  return (
    // Concept G (2026-10-10): no left rail and no bottom strip. A column of
    // top bar and the page, with the phone's bottom tabs fixed over the foot
    // of the screen. h-dvh rather than h-screen so the column is the
    // VISIBLE viewport on a phone, whose browser bars make 100vh too tall.
    //
    // The chrome heights are declared once here and read back as
    // --shell-port, so anything that must fit inside the scroll port (the
    // side panel) is bounded by the same numbers the bars are laid out
    // with, rather than repeating them and drifting. Below md the tabs are
    // fixed over the bottom and the page pads by their height; at md and up
    // they are gone and nothing is fixed at the bottom at all.
    //
    // Every shell region below is ONE client component from
    // components/AppChrome.tsx, and that indirection is load-bearing rather
    // than tidy: a widget element created HERE, in a server component, would
    // cross the RSC boundary as a client component's children, and React's
    // production Flight serializer defers it past 3,200 bytes into a LAZY
    // that suspends the region's Suspense — the 2026-09-21 outage's trap
    // (components/Hint.tsx). See AppChrome.tsx's header, CLAUDE.md's #418
    // entry and PR #501.
    //
    // A region that throws is still replaced by a quiet fallback and the page
    // keeps working. The page itself ({children}) is deliberately NOT inside a
    // region — app/(app)/error.tsx owns that and must stay loud, and the
    // region components take no children at all. See components/ShellRegion.tsx;
    // shellRegion.test.ts fails the build if a shell widget is paired here.
    <div className="flex h-dvh flex-col bg-canvas [--shell-tabs:calc(65px+env(safe-area-inset-bottom))] [--shell-topbar:56px] md:[--shell-tabs:0px] md:[--shell-topbar:64px]">
      {/* Renders nothing. Parks the browser's IANA zone in a cookie so
          the server can work out what day it is where the reader is. */}
      <TimeZoneCookieRegion />
      <NavigationProgressRegion />
      {/* "Take the full tour": renders nothing until someone starts it.
          Here rather than on a page because it moves between pages. */}
      <FullTourRegion principal={principal} />
      {/* The ⌘K palette: renders nothing until opened, from the top bar's
          search box or anything that dispatches cstream:open-search. */}
      <CommandPaletteRegion />
      {/* The first Tab stop on every signed-in page: past the wordmark, three
          words, search, Ask, Help and the avatar in one key. Invisible until
          focused. */}
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-brand font-semibold text-neutral-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:inline-flex focus:min-h-11 focus:items-center focus:px-4"
      >
        Skip to content
      </a>
      <TopBarRegion
        companyName={company.name}
        userName={currentUser.name}
        userEmail={currentUser.email}
        alertCount={alertCount}
        principal={principal}
        showsInternal={showsInternal}
        businessScope={businessScope}
        routesWithData={routesWithData}
        // Resolved HERE, on the server: lib/help-config.ts reads
        // process.env and imports the @prova/integrations barrel, neither
        // of which belongs in a browser bundle.
        helpChannel={helpChannelFromEnv()}
        stages={moneyRailStages}
      />
      {/* No background of its own: each page brings its own ground. Full
          width now there is no rail; the centred column is each page's own
          <PageShell> (packages/ui — `working` is max-w-7xl plus px-6, within
          a few px of the G mockup's 1344px-with-48px-gutters), and
          pageWidthCensus.test.ts forbids a second cap here. The bottom
          padding clears the phone's fixed tabs; the matching SCROLL padding
          makes scrollIntoView and keyboard focus stop above them too —
          without it a focused "Review & send" scrolled in behind the tabs
          (measured at 390x844, 2026-10-10). */}
      <main className="min-h-0 flex-1 overflow-y-auto pb-[var(--shell-tabs)] scroll-pb-[var(--shell-tabs)] [--shell-port:calc(100dvh-var(--shell-topbar)-var(--shell-tabs))] focus:outline-none" id="main" tabIndex={-1}>
        {children}
      </main>
      <BottomTabsRegion
        principal={principal}
        showsInternal={showsInternal}
        businessScope={businessScope}
        routesWithData={routesWithData}
      />
    </div>
  );
}

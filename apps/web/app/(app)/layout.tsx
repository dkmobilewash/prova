import { requireCompanyContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { MetricBar } from "@/components/MetricBar";
import { loadCompanyFinancials } from "@/lib/company-financials-query";
import { getMoneyRailStages } from "@/lib/moneyRail";
import { countVisibleAlerts } from "@/lib/alerts-query";
import { can, type Principal } from "@/lib/permissions";
import { viewerToday } from "@/lib/viewerToday";
import { TimeZoneCookie } from "@/components/TimeZoneCookie";
import { FullTour } from "@/components/FullTour";
import { CompanySetupPrompt } from "@/components/CompanySetupPrompt";
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
  // Shown once, and only to the person who can actually answer it: a
  // non-owner has no capability to change what the answers below already
  // decided (saveBusinessScope refuses them), so showing them a prompt
  // they cannot act on would be a door that does not open. Null means
  // "never asked" — true of a brand-new company on its very first page
  // load, and also true of every company that existed before this shipped,
  // which is why an existing company sees this ONCE rather than never: the
  // absence of an answer and the absence of the "have you been asked yet"
  // stamp are deliberately the same column, not two.
  const showsCompanySetupPrompt = currentUser.role === "OWNER" && company.businessScopeAskedAt === null;

  // The reader's own calendar day, not the server's UTC one. At 18:00 in
  // Los Angeles the UTC date is already tomorrow, so this badge counted a
  // follow-up due today as OVERDUE every evening — issue #111 item 1. Read
  // before the two queries rather than inside the Promise.all, so it does
  // not serialise them: it is a cookie read, not a round trip.
  const today = await viewerToday();

  const [financials, alertCount, moneyRailStages] = await Promise.all([
    loadCompanyFinancials(company.id),
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
    can(principal, "VIEW_COMPANY_FINANCIALS") ? getMoneyRailStages(company.id) : Promise.resolve([]),
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
    <div className="flex h-screen bg-canvas [--shell-metricbar:52px] [--shell-topbar:56px]">
      {/* Renders nothing. Parks the browser's IANA zone in a cookie so
          the server can work out what day it is where the reader is. */}
      <TimeZoneCookie />
      {/* "Take the full tour": renders nothing until someone starts it.
          Here rather than on a page because it moves between pages. */}
      <FullTour principal={principal} />
      {/* The three onboarding questions. Renders nothing once answered,
          skipped, or for anyone but the owner — see showsCompanySetupPrompt
          above. */}
      <CompanySetupPrompt show={showsCompanySetupPrompt} />
      <Sidebar
        companyName={company.name}
        principal={principal}
        showsInternal={showsInternal}
        businessScope={businessScope}
        stages={moneyRailStages}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          companyName={company.name}
          alertCount={alertCount}
          principal={principal}
          showsInternal={showsInternal}
          businessScope={businessScope}
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
            page is not enforced at all. */}
        {can(principal, "VIEW_COMPANY_FINANCIALS") && <MetricBar financials={financials} />}
      </div>
    </div>
  );
}

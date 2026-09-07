import { requireCompanyContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { MetricBar } from "@/components/MetricBar";
import { loadCompanyFinancials } from "@/lib/company-financials-query";
import { countVisibleAlerts } from "@/lib/alerts-query";
import { can, type Principal } from "@/lib/permissions";
import { viewerToday } from "@/lib/viewerToday";
import { TimeZoneCookie } from "@/components/TimeZoneCookie";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, ...currentUser } = await requireCompanyContext();
  const principal: Principal = {
    role: currentUser.role,
    jobFunction: currentUser.jobFunction,
  };
  // Prova's own sales pipeline, for exactly one company -- see
  // Company.isProvaOperator. Not a lib/permissions.ts Capability: that map
  // is about job function within a company, and an OWNER always holds
  // every capability in it regardless, which cannot express "owner only."
  const showsSalesCrm = company.isProvaOperator && currentUser.role === "OWNER";

  // The reader's own calendar day, not the server's UTC one. At 18:00 in
  // Los Angeles the UTC date is already tomorrow, so this badge counted a
  // follow-up due today as OVERDUE every evening — issue #111 item 1. Read
  // before the two queries rather than inside the Promise.all, so it does
  // not serialise them: it is a cookie read, not a round trip.
  const today = await viewerToday();

  const [financials, alertCount] = await Promise.all([
    loadCompanyFinancials(company.id),
    // In the layout, so the count is on every screen. Derived on each
    // render like everything else here — there is no stored unread count
    // to go stale against the records it is counting. Scoped to this
    // person, and dated the same way /alerts is, so the badge and the list
    // cannot disagree about how many there are.
    countVisibleAlerts(company.id, currentUser.id, today, principal),
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
    <div className="flex h-screen bg-slate-950 [--shell-metricbar:52px] [--shell-topbar:56px]">
      {/* Renders nothing. Parks the browser's IANA zone in a cookie so
          the server can work out what day it is where the reader is. */}
      <TimeZoneCookie />
      <Sidebar companyName={company.name} principal={principal} showsSalesCrm={showsSalesCrm} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          companyName={company.name}
          alertCount={alertCount}
          principal={principal}
          showsSalesCrm={showsSalesCrm}
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

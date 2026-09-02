import { requireCompanyContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { MetricBar } from "@/components/MetricBar";
import { loadCompanyFinancials } from "@/lib/company-financials-query";
import { countVisibleAlerts } from "@/lib/alerts-query";
import { can, type Principal } from "@/lib/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, ...currentUser } = await requireCompanyContext();
  const principal: Principal = {
    role: currentUser.role,
    jobFunction: currentUser.jobFunction,
  };

  const [financials, alertCount] = await Promise.all([
    loadCompanyFinancials(company.id),
    // In the layout, so the count is on every screen. Derived on each
    // render like everything else here — there is no stored unread count
    // to go stale against the records it is counting. Scoped to this
    // person, so the badge counts exactly what their /alerts list holds.
    countVisibleAlerts(
      company.id,
      currentUser.id,
      new Date().toISOString().slice(0, 10),
      principal,
    ),
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
      <Sidebar companyName={company.name} principal={principal} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar companyName={company.name} alertCount={alertCount} principal={principal} />
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

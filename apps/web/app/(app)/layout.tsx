import { requireCompanyContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { MetricBar } from "@/components/MetricBar";
import { loadCompanyFinancials } from "@/lib/company-financials-query";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company } = await requireCompanyContext();
  const financials = await loadCompanyFinancials(company.id);

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
      <Sidebar companyName={company.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar companyName={company.name} />
        {/* No background of its own: each page brings its own ground, so a
            page still written against the dark theme keeps it and a
            converted one opts into the light canvas. */}
        <main className="min-h-0 flex-1 overflow-y-auto [--shell-port:calc(100dvh-var(--shell-topbar)-var(--shell-metricbar))]">
          {children}
        </main>
        <MetricBar financials={financials} />
      </div>
    </div>
  );
}

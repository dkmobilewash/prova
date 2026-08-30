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
    <div className="flex h-screen bg-canvas">
      <Sidebar companyName={company.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar companyName={company.name} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        <MetricBar financials={financials} />
      </div>
    </div>
  );
}

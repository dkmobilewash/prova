import { requireCompanyContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company } = await requireCompanyContext();

  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar companyName={company.name} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

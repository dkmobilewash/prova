import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCompanyContext } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
import { AREAS, areaViews, areasFor, toolRoute } from "@/lib/areas";
import { loadAreaWaiting, loadToolStatuses } from "@/lib/areas-data";
import { ToolCard, WaitingTable } from "@/components/areas/AreaParts";
import { MetricBar } from "@/components/MetricBar";
import { Breadcrumb } from "@/components/PageHeader";
import { can } from "@/lib/permissions";
import { loadCompanyFinancials } from "@/lib/company-financials-query";

/**
 * One area (Concept H): every tool that area holds as a card — its real
 * count, one line of status and one action — and below them a single list
 * of what in this area is waiting on somebody. The home page's six boxes
 * open onto these.
 *
 * What a viewer sees is `areasFor` (lib/areas.ts): tools narrowed to the
 * pages they can open, and an area with none of them is a 404 rather than
 * an empty page. Each card's page still runs its own requireCapability.
 */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: AREAS.find((area) => area.slug === slug)?.name ?? "Not found" };
}

export default async function AreaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, ...currentUser } = await requireCompanyContext();
  const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };
  const area = areasFor(principal).find((a) => a.slug === slug);
  if (!area) notFound();

  const todayIso = await viewerToday();
  const { list, known } = await loadAreaWaiting(area.slug, company.id, principal, todayIso);
  const statuses = await loadToolStatuses(
    company.id,
    principal,
    todayIso,
    known,
    area.tools.map(toolRoute),
  );
  const view = areaViews([area], statuses)[0]!;

  // The four company figures that used to sit in the bottom metric bar on
  // every page (Concept G removed it — it covered buttons). Same gate the bar
  // had: company-wide money is VIEW_COMPANY_FINANCIALS, and without it the
  // query never runs. A failed query costs these four tiles a quiet line,
  // never the page — the list below still works.
  const showsFigures = area.slug === "money" && can(principal, "VIEW_COMPANY_FINANCIALS");
  const financials = showsFigures
    ? await loadCompanyFinancials(company.id).catch((error: unknown) => {
        console.error("[money] company figures failed to load; the page is unaffected.", error);
        return null;
      })
    : null;

  return (
    <PageShell width="working">
      <Breadcrumb trail={[{ href: "/dashboard", label: "Home" }]} current={view.name} />
      <h1 className="mt-1 font-headline text-[32px] font-semibold leading-tight text-ink">{view.name}</h1>
      <p className="text-ink-muted">{view.description}</p>

      {showsFigures &&
        (financials ? (
          <MetricBar financials={financials} />
        ) : (
          <p className="mt-6 text-sm text-ink-muted">Company figures couldn&apos;t load. Reload to try again.</p>
        ))}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        {view.tools.map((tool) => (
          <ToolCard key={tool.href} tool={tool} />
        ))}
      </div>

      <WaitingTable list={list} />
    </PageShell>
  );
}

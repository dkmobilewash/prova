import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCompanyContext } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
import { AREAS, areaViews, areasFor, toolRoute } from "@/lib/areas";
import { loadAreaWaiting, loadToolStatuses } from "@/lib/areas-data";
import { ToolCard, WaitingTable } from "@/components/areas/AreaParts";

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

  return (
    <PageShell width="working">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/dashboard" className="hover:text-ink">
          Home
        </Link>
        <span aria-hidden className="mx-2">
          /
        </span>
        <span aria-current="page" className="font-medium text-ink">
          {view.name}
        </span>
      </nav>
      <h1 className="mt-1.5 font-headline text-[40px] font-semibold leading-tight text-ink">{view.name}</h1>
      <p className="text-ink-muted">{view.description}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        {view.tools.map((tool, i) => (
          <ToolCard key={tool.href} tool={tool} primary={i === 0} />
        ))}
      </div>

      <WaitingTable list={list} />
    </PageShell>
  );
}

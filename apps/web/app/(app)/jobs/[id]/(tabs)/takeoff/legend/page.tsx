import Link from "next/link";
import { prisma } from "@prova/db";
import { NoAccess } from "@/components/NoAccess";
import { WallLegendReview } from "@/components/WallLegendReview";
import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import { can } from "@/lib/permissions";
import { loadLegendProposals } from "@/lib/plan-ingest/legendProposalsQuery";
import { surfaceHrefs, type Surface } from "@/lib/bid/surfaceHrefs";

/**
 * ── THE WALL LEGEND, READ OFF THE SET, FOR REVIEW ──
 *
 * One page per job rather than a card under the found walls: each legend
 * type with its crop of the drawing beside the merged reading, every flag in
 * red, the fields editable, and an Add button per type that creates the
 * `WallType` and its quantity components — never a price. A type already in
 * the library says so instead of offering the button, and that is derived
 * from the library at render time, never stored.
 *
 * Reachable under VIEW_JOB_COSTS, as the takeoff tab is; adding writes the
 * COMPANY library, which is MANAGE_ESTIMATING, so the button is withheld from
 * anyone who could not press it rather than refusing them after the click.
 */
export default async function WallLegendReviewPage({
  params,
  surface = "crm",
}: {
  params: Promise<{ id: string }>;
  /** Which product renders this page; C Stream Bid passes "bid" (`lib/bid/surfaceHrefs.ts`). */
  surface?: Surface;
}) {
  const { id } = await params;
  const hrefs = surfaceHrefs(surface, id);
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" homeHref={hrefs.home} homeLabel={hrefs.homeLabel} />;
  const { company, job } = await requireJobGivenContext(id, context);
  const plans = await prisma.takeoffPlan.findMany({
    where: { jobId: job.id, companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, revisionLabel: true },
  });
  const proposals = (await Promise.all(plans.map((plan) => loadLegendProposals(plan.id)))).flat();
  const library = await prisma.wallType.findMany({ where: { companyId: company.id }, select: { code: true } });

  return (
    <section className="flex flex-col gap-4" data-legend="review">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">Wall types read off the drawings</h2>
          <p className="mt-1 max-w-prose text-sm text-ink-body">
            Each wall type the set&rsquo;s partition legend defines, with the crop of the drawing it was read from. Check the
            fields against the crop, change what&rsquo;s wrong, and add the ones you want to your library. Nothing here is a
            price &mdash; you put parts, prices and crews on them under Wall types afterwards.
          </p>
        </div>
        <Link href={hrefs.takeoff} className="text-sm text-link underline-offset-2 hover:underline">
          &larr; Back to the takeoff
        </Link>
      </div>
      {proposals.length === 0 ? (
        <div className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
          No wall legend has been read off this job&rsquo;s drawings yet. On the takeoff tab, under the plan reading
          panel, choose <span className="font-medium text-ink">Read the wall legend</span>.
        </div>
      ) : (
        <WallLegendReview
          jobId={job.id}
          proposals={proposals}
          plans={plans.map((plan) => ({ id: plan.id, label: plan.revisionLabel ?? plan.fileName ?? "this set" }))}
          libraryCodes={library.map((type) => type.code)}
          canAdd={can(context, "MANAGE_ESTIMATING")}
        />
      )}
    </section>
  );
}

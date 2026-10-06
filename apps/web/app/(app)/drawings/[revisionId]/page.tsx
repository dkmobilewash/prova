import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { SheetPinSurface } from "@/components/SheetPinSurface";
import { PageShell } from "@prova/ui";

/** How many photos and punch items the pickers offer.
 *
 * A cap rather than everything: this page re-renders in full after every pin,
 * and a job with six hundred photos would make that worse than it already is.
 * Newest first means the cap bites on the oldest, which is the right end to
 * lose. */
const PICKER_LIMIT = 60;

export const dynamic = "force-dynamic";

/** One drawing revision, its sheets, and what is pinned on them. */
export default async function RevisionPage({ params }: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await params;
  const { context, allowed } = await requireCapability("MANAGE_JOBS");
  if (!allowed) return <NoAccess capability="MANAGE_JOBS" />;

  const revision = await prisma.drawingRevision.findFirst({
    where: { id: revisionId, set: { companyId: context.company.id } },
    select: {
      id: true,
      label: true,
      fileUrl: true,
      fileName: true,
      set: { select: { id: true, name: true, job: { select: { id: true, name: true } } } },
      sheetPages: {
        orderBy: { pageNumber: "asc" },
        select: {
          id: true,
          pageNumber: true,
          widthPt: true,
          heightPt: true,
          imageUrl: true,
          pins: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              x: true,
              y: true,
              kind: true,
              note: true,
              mediaId: true,
              punchItemId: true,
              punchItem: { select: { description: true } },
            },
          },
        },
      },
    },
  });
  if (!revision) notFound();

  // WHAT THE PICKERS NEED, AND NO MORE.
  //
  // Both are capped and ordered, because a drawing set belongs to a job that
  // may carry hundreds of photos and a long punch list, and this page already
  // re-renders in full after every pin. Newest first on photos is what a
  // person is actually looking for: the one they took an hour ago.
  //
  // Only OPEN punch items are offered. Pinning a verified item is pinning
  // history — the useful act is "this is still wrong, and it is HERE".
  const jobId = revision.set.job?.id ?? null;
  const [photos, punchItems] = jobId
    ? await Promise.all([
        prisma.jobMedia.findMany({
          where: { jobId, companyId: context.company.id },
          orderBy: { capturedAt: "desc" },
          take: PICKER_LIMIT,
          select: { id: true, blobUrl: true, caption: true, capturedAt: true },
        }),
        prisma.punchListItem.findMany({
          where: { jobId, companyId: context.company.id, status: "OPEN" },
          orderBy: { createdAt: "desc" },
          take: PICKER_LIMIT,
          select: { id: true, description: true, area: true, dueOn: true },
        }),
      ])
    : [[], []];

  return (
    <PageShell width="working">
      <div className="space-y-6">
      <nav className="text-sm text-slate-400">
        <Link href="/drawings" className="hover:text-slate-200">
          Drawings
        </Link>
        <span className="px-2">/</span>
        <span className="text-slate-200">
          {revision.set.name} — {revision.label}
        </span>
      </nav>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-100">{revision.set.name}</h1>
        <p className="text-sm text-slate-400">
          Revision {revision.label}
          {revision.set.job ? ` · ${revision.set.job.name}` : ""}
        </p>
      </header>

        <SheetPinSurface
          revisionId={revision.id}
          fileUrl={revision.fileUrl}
          pages={revision.sheetPages}
          photos={photos}
          punchItems={punchItems.map((item) => ({
            id: item.id,
            description: item.description,
            area: item.area,
            dueOn: item.dueOn ? item.dueOn.toISOString().slice(0, 10) : null,
          }))}
        />
      </div>
    </PageShell>
  );
}

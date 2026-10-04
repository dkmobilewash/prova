import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { SheetPinSurface } from "@/components/SheetPinSurface";
import { PageShell } from "@prova/ui";

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

      {!revision.fileUrl ? (
        <p className="rounded-md border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
          This revision has no drawing attached, so there is nothing to pin on. Add the file on the{" "}
          <Link href="/drawings" className="text-sky-300 underline">
            Drawings page
          </Link>
          .
        </p>
      ) : (
        <SheetPinSurface
          revisionId={revision.id}
          fileUrl={revision.fileUrl}
          pages={revision.sheetPages}
        />
      )}
      </div>
    </PageShell>
  );
}

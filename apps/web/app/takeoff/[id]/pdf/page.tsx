import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/authz";
import { requireJobGivenContext } from "@/lib/jobs/job-access";
import { NoAccess } from "@/components/NoAccess";
import { loadTakeoffWorkspace } from "@/lib/takeoff/workspaceLoad";
import { PdfPrintButton } from "./PdfPrintButton";

/**
 * ── THE DRAWING AS ISSUED, IN A TAB NAMED FOR WHAT IT IS ──
 *
 * The workspace's PDF button opened `/api/takeoff/plan/<id>` itself, and a
 * browser names a PDF's tab from the file's own Title — "ESC1" on Baker, which
 * says nothing about the job (Chrome's click test). So the button opens this
 * page instead: the same file, at the same sheet, full window, in a tab titled
 * "<job> – <sheet>". The bytes still come from the plan route, with its own
 * checks; this page adds a name and nothing else.
 *
 * ── AND THE VIEWER'S OWN HEADER, WHICH SAID "ESC1" TOO ──
 * Chrome's PDF viewer prints the file's Title in its toolbar, and the tab
 * title cannot reach that. Rewriting the Title means re-encoding the whole
 * set on every open, so its toolbar is switched off (`#toolbar=0`) and this
 * page draws the header instead: the name, Download (saved under the name)
 * and Print. Zoom stays on the keyboard and Ctrl+wheel, inside the viewer.
 */
async function load(params: Promise<{ id: string }>, searchParams: Promise<{ page?: string }>) {
  const { id } = await params;
  const { page } = await searchParams;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return { allowed: false as const };
  const { company, job } = await requireJobGivenContext(id, context);
  const data = await loadTakeoffWorkspace(company, job);
  if (data === null) notFound();
  const pageNumber = Math.max(1, Number.parseInt(page ?? "", 10) || 1);
  const sheet = data.sheetLabelByPage[pageNumber] ?? `Sheet ${pageNumber}`;
  const file = `/api/takeoff/plan/${data.plan.id}`;
  return { allowed: true as const, title: `${job.name} – ${sheet}`, file, src: `${file}#page=${pageNumber}&toolbar=0&navpanes=0` };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const loaded = await load(params, searchParams);
  // Absolute: the tab reads exactly "<job> – <sheet>", without the app's suffix.
  return { title: { absolute: loaded.allowed ? loaded.title : "C Stream" } };
}

export default async function TakeoffPdfPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const loaded = await load(params, searchParams);
  if (!loaded.allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  return (
    <div className="fixed inset-0 flex flex-col bg-canvas">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line-card bg-surface px-4" data-takeoff="pdf-header">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{loaded.title}</h1>
        <a
          href={loaded.file}
          download={`${loaded.title.replace(/[\\/:*?"<>|]+/g, " ")}.pdf`}
          className="rounded-md border border-line-card px-3 py-1.5 text-xs font-medium text-ink-body hover:bg-rail-hover"
        >
          Download
        </a>
        <PdfPrintButton />
      </header>
      <iframe src={loaded.src} title={loaded.title} className="min-h-0 w-full flex-1 border-0" data-takeoff="pdf-frame" />
    </div>
  );
}

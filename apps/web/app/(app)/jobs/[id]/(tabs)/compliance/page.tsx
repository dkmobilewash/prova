import { prisma } from "@prova/db";
import { RowActions, ConfirmDelete } from "@/components/RowActions";
import { PrevailingWageDeterminationForm } from "@/components/PrevailingWageDeterminationForm";
import { requireJob } from "@/lib/jobs/job-access";
import { deletePrevailingWageDetermination } from "@/lib/actions";

const rowDeleteClass = "text-xs text-red-400 hover:underline";
const rowCancelClass =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-ink-label hover:border-slate-500";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10";

/**
 * Compliance — the government wage determination for this job's
 * jurisdiction. Ungated as a route, matching the monolith exactly: this
 * section carried no capability check there either, so adding one here
 * would be a NEW restriction, not a preserved one.
 */
export default async function JobCompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { job: jobRef } = await requireJob(id);

  const determinations = await prisma.prevailingWageDetermination.findMany({
    where: { jobId: jobRef.id },
    orderBy: { createdAt: "desc" },
  });

  const deletePrevailingWageDeterminationWithId = (determinationId: string) =>
    deletePrevailingWageDetermination.bind(null, jobRef.id, determinationId);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-ink">Prevailing wage determination</h2>
      <p className="mb-3 text-sm text-ink-muted">
        The government wage determination for this job&rsquo;s jurisdiction (federal or state) — attach a copy or a
        link to it. This app doesn&rsquo;t look one up automatically; there&rsquo;s no licensed prevailing-wage
        dataset built in.
      </p>

      {determinations.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {determinations.map((determination) => (
            <li
              key={determination.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-card bg-surface p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-ink">{determination.jurisdiction}</span>
                {determination.fileUrl && (
                  <a href={determination.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-link hover:underline">
                    {determination.fileName ?? "View document"}
                  </a>
                )}
                {determination.sourceUrl && (
                  <a href={determination.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-link hover:underline">
                    Source link
                  </a>
                )}
                {determination.note && <span className="text-xs text-ink-muted">— {determination.note}</span>}
              </div>
              <RowActions
                className="flex shrink-0 flex-col items-end gap-1"
                destructive={
                  <ConfirmDelete
                    pinned="end"
                    action={deletePrevailingWageDeterminationWithId(determination.id)}
                    describe="Removes the wage determination from this job. Certified payroll for weeks already filed is unchanged; future weeks lose the rates it supplied."
                    label="Remove"
                    confirmLabel="Confirm remove"
                    armedClassName="flex flex-wrap items-center justify-end gap-2"
                    deleteClassName={rowDeleteClass}
                    cancelClassName={rowCancelClass}
                    confirmClassName={rowConfirmClass}
                    hint={
                      <span className="max-w-[16rem] text-right text-ink-muted">
                        The wage determination this job&rsquo;s certified payroll is checked against.
                      </span>
                    }
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}

      <PrevailingWageDeterminationForm jobId={jobRef.id} />
    </section>
  );
}

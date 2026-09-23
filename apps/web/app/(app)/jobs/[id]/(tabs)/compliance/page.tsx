import { prisma } from "@prova/db";
import { PageColumn } from "@prova/ui";
import { RowActions, ConfirmDelete } from "@/components/RowActions";
import { PrevailingWageDeterminationForm } from "@/components/PrevailingWageDeterminationForm";
import { JobComplianceFactsForm } from "@/components/JobComplianceFactsForm";
import { DeterminationFactsEditor } from "@/components/DeterminationFactsEditor";
import { DeterminationStandingLine } from "@/components/DeterminationStandingLine";
import { requireJob } from "@/lib/jobs/job-access";
import { deletePrevailingWageDetermination } from "@/lib/actions";
import { determinationStanding, determinationStandingLine, type DeterminationMarker } from "@/lib/determination-standing";
import { viewerToday } from "@/lib/viewerToday";

const rowDeleteClass = "text-xs text-red-400 hover:underline";
const rowCancelClass =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-ink-label hover:border-slate-500";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10";

const isoDay = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/**
 * Compliance — the government wage determination for this job's
 * jurisdiction. Ungated as a route, matching the monolith exactly: this
 * section carried no capability check there either, so adding one here
 * would be a NEW restriction, not a preserved one.
 *
 * TWO THINGS THIS TAB SAYS NOW THAT IT COULD NOT BEFORE. The four
 * public-works facts on the job (county, public works, first advertised
 * for bid, awarding body) are entered here rather than on the Overview
 * form, and each determination carries a STANDING line — in force on the
 * advertisement date, the wrong issue for it, a predetermined increase now
 * due, or unchecked because a date was never entered. The line is derived
 * on every read by lib/determination-standing.ts from what a person typed;
 * nothing stores it, and nothing here looks a determination up.
 */
export default async function JobCompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { job: jobRef } = await requireJob(id);

  const [job, determinations, today] = await Promise.all([
    prisma.job.findUniqueOrThrow({
      where: { id: jobRef.id },
      select: { siteCounty: true, publicWorks: true, bidAdvertisedOn: true, awardingBody: true },
    }),
    prisma.prevailingWageDetermination.findMany({
      where: { jobId: jobRef.id },
      orderBy: { createdAt: "desc" },
    }),
    viewerToday(),
  ]);

  const deletePrevailingWageDeterminationWithId = (determinationId: string) =>
    deletePrevailingWageDetermination.bind(null, jobRef.id, determinationId);

  // A form and a short list of attached documents: reading width. The
  // layout above is `working`; see PageColumn.
  return (
      <PageColumn width="reading">
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold text-ink">Public-works facts</h2>
          <p className="mb-3 text-sm text-ink-muted">
            What the call for bids says about this job. The date it was first advertised for bid is what
            picks which prevailing-wage determination governs the whole job, so the standing of every
            determination below is judged against it.
          </p>
          <JobComplianceFactsForm
            jobId={jobRef.id}
            facts={{
              siteCounty: job.siteCounty,
              publicWorks: job.publicWorks,
              bidAdvertisedOn: isoDay(job.bidAdvertisedOn),
              awardingBody: job.awardingBody,
            }}
          />
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold text-ink">Prevailing wage determination</h2>
          <p className="mb-3 text-sm text-ink-muted">
            The government wage determination for this job&rsquo;s jurisdiction (federal or state) — attach a copy or a
            link to it. This app doesn&rsquo;t look one up automatically; there&rsquo;s no licensed prevailing-wage
            dataset built in. Enter the dates printed on it and the line under each one says whether it is
            still the determination in force for this job.
          </p>

        {determinations.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2">
            {determinations.map((determination) => {
              const standing = determinationStanding(
                {
                  issuedOn: determination.issuedOn,
                  expiresOn: determination.expiresOn,
                  expirationMarker: determination.expirationMarker as DeterminationMarker | null,
                },
                { bidAdvertisedOn: job.bidAdvertisedOn },
                today,
              );
              return (
                <li
                  key={determination.id}
                  className="flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                  </div>
                  {/* Derived on every read from what a person entered — the
                      job's bid-advertisement date and the dates printed on
                      this document. Stored nowhere. */}
                  <DeterminationStandingLine line={determinationStandingLine(standing)} />
                  <DeterminationFactsEditor
                    jobId={jobRef.id}
                    determinationId={determination.id}
                    facts={{
                      determinationRef: determination.determinationRef,
                      issuedOn: isoDay(determination.issuedOn),
                      expiresOn: isoDay(determination.expiresOn),
                      expirationMarker: determination.expirationMarker as DeterminationMarker | null,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <PrevailingWageDeterminationForm jobId={jobRef.id} />
      </section>
    </PageColumn>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { NotLegalAdvice } from "@/components/NotLegalAdvice";
import { SubcontractReviewPanel } from "@/components/SubcontractReviewPanel";
import { SubcontractFindingCard } from "@/components/SubcontractFindingCard";
import { citationLabel, groupByCategory, SEVERITY_WORD, severityCounts } from "@/lib/subcontract-review/findings";
import { describePageRuns } from "@/lib/subcontract-review/pageText";
import { loadReviewPage } from "@/lib/subcontract-review/query";

/**
 * AI SUBCONTRACT REVIEW — what a GC's subcontract commits the sub to, read
 * before they sign. Outside the job's tabs, like /proposal, so the tab strip is
 * untouched; reached from each version row in the Overview tab's "Subcontract
 * agreement" section.
 *
 * Everything on this page is a proposal. A finding is shown only if its quote
 * was found word for word on the page code located, and nothing here changes
 * the job, the contract or anything a GC sees. Design:
 * docs/ai/SUBCONTRACT-REVIEW.md.
 */

// One chunk per request; the page drives the loop (SubcontractReviewPanel).
export const maxDuration = 60;

export default async function SubcontractReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const { version } = await searchParams;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;

  const data = await loadReviewPage(id, context.company.id, version);
  if (!data) notFound();
  const { job, versions, selected, review, previous } = data;

  const changeByKey = new Map<string, "NEW" | "CHANGED" | "UNCHANGED">();
  if (previous) {
    for (const entry of previous.diff) if ("current" in entry) changeByKey.set(entry.current.key, entry.change as "NEW" | "CHANGED" | "UNCHANGED");
  }
  const removed = previous?.diff.flatMap((entry) => (entry.change === "REMOVED" ? [entry.previous] : [])) ?? [];
  const changedCount = previous?.diff.filter((entry) => entry.change === "CHANGED").length ?? 0;
  const newCount = previous?.diff.filter((entry) => entry.change === "NEW").length ?? 0;

  const groups = review ? groupByCategory(review.findings) : [];
  const counts = review ? severityCounts(review.findings) : null;
  const unread = review?.sources.filter((source) => source.unreadPages.length > 0) ?? [];

  return (
    <PageShell width="reading" className="print:p-0">
      <p className="mb-2 text-sm print:hidden">
        <Link href={`/jobs/${job.id}`} className="text-link hover:underline">
          ← {job.name}
        </Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-ink">Subcontract review</h1>
      <p className="mb-4 text-sm text-ink-body">
        What this subcontract commits you to, clause by clause, with the contract&apos;s own words and the page to
        check them on. Accept, dismiss or mark each one as something to negotiate — nothing is saved to the job or
        sent to anyone.
      </p>
      <NotLegalAdvice className="mb-6" />

      {!selected ? (
        <p className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body" data-subcontract-review="no-contract">
          There is no subcontract on this job yet. Upload the GC&apos;s agreement in the{" "}
          <Link href={`/jobs/${job.id}#contract-signature`} className="text-link hover:underline">
            Subcontract agreement
          </Link>{" "}
          section of the job, then come back here to review it.
        </p>
      ) : (
        <>
          {versions.length > 1 && (
            <nav aria-label="Contract version" className="mb-4 flex flex-wrap gap-2 print:hidden">
              {versions.map((option) => (
                <Link
                  key={option.id}
                  href={`/jobs/${job.id}/subcontract-review?version=${option.id}`}
                  aria-current={option.id === selected.id ? "page" : undefined}
                  className={`min-h-12 rounded-md border px-3 py-2 text-sm ${
                    option.id === selected.id
                      ? "border-link text-ink"
                      : "border-line-card text-ink-label hover:bg-rail-hover"
                  }`}
                >
                  v{option.versionNumber}
                  {option.executed ? " · executed" : ""}
                </Link>
              ))}
            </nav>
          )}

          <p className="mb-3 text-sm text-ink-body">
            Version {selected.versionNumber}: <span className="text-ink">{selected.fileName}</span>
          </p>

          <SubcontractReviewPanel
            jobId={job.id}
            contractDocumentId={selected.id}
            versionNumber={selected.versionNumber}
            review={
              review
                ? {
                    id: review.id,
                    state: review.state,
                    failureReason: review.failureReason,
                    chunksDone: review.chunksDone,
                    chunksTotal: review.chunksTotal,
                  }
                : null
            }
          />

          {review && (
            <>
              <section className="mb-6 flex flex-col gap-2 text-sm text-ink-body" data-subcontract-review="summary-line">
                {counts && (
                  <p>
                    <span className="font-medium text-ink">{counts.HIGH}</span> {SEVERITY_WORD.HIGH.toLowerCase()},{" "}
                    <span className="font-medium text-ink">{counts.MEDIUM}</span> {SEVERITY_WORD.MEDIUM.toLowerCase()},{" "}
                    <span className="font-medium text-ink">{counts.LOW}</span> {SEVERITY_WORD.LOW.toLowerCase()} — not
                    counting anything you dismissed.
                    {review.state === "RUNNING" && " Still reading."}
                  </p>
                )}
                <p className="text-ink-muted">
                  Read: {review.sources.map((source) => `${source.roleLabel} (${source.fileName}, ${source.pageCount} pp.)`).join("; ")}.
                  {review.pagesCharged > 0 && ` ${review.pagesCharged} pages charged.`}
                </p>
                {unread.length > 0 && (
                  <p className="text-warn" data-subcontract-review="unread">
                    Not read — no text on the page, so nothing on them could be quoted or checked:{" "}
                    {unread.map((source) => `${source.roleLabel}, pages ${describePageRuns(source.unreadPages)}`).join("; ")}.
                    Read those pages yourself, or ask the GC for a text PDF.
                  </p>
                )}
                {review.findingsDropped > 0 && (
                  <p className="text-ink-muted" data-subcontract-review="dropped">
                    {review.findingsDropped} {review.findingsDropped === 1 ? "finding was" : "findings were"} thrown away
                    because the words quoted could not be found on the page. They are not shown.
                  </p>
                )}
                {previous && (
                  <p data-subcontract-review="changes">
                    Compared with version {previous.versionNumber}: {newCount} new, {changedCount} changed, {removed.length}{" "}
                    no longer in the contract. Your decisions carry over wherever a clause&apos;s wording is unchanged.
                  </p>
                )}
              </section>

              {review.findings.length === 0 && review.state === "COMPLETE" && (
                <p className="mb-6 rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
                  The review found nothing in the readable pages that shifts money, risk or a deadline onto you. That is
                  not a clean bill of health — read the contract, and have an attorney look at anything that worries you.
                </p>
              )}

              {groups.map((group) => (
                <section key={group.category} className="mb-6" data-subcontract-category={group.category}>
                  <h2 className="mb-2 text-lg font-semibold text-ink">{group.label}</h2>
                  <div className="rounded-lg border border-line-card bg-surface">
                    {group.findings.map((finding) => (
                      <SubcontractFindingCard
                        key={finding.id}
                        jobId={job.id}
                        finding={finding}
                        change={previous ? (changeByKey.get(finding.key) ?? null) : null}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {removed.length > 0 && (
                <section className="mb-6" data-subcontract-review="removed">
                  <h2 className="mb-2 text-lg font-semibold text-ink">No longer in this version</h2>
                  <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                    {removed.map((finding) => (
                      <li key={finding.id} className="p-4 text-sm text-ink-body">
                        <p className="font-medium text-ink">{finding.title}</p>
                        <p className="italic">“{finding.quote}”</p>
                        <p className="text-xs text-ink-muted">
                          Version {previous?.versionNumber} · {finding.sourceLabel} · {citationLabel(finding)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

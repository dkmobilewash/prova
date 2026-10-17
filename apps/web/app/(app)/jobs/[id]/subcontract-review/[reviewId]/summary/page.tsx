import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { NotLegalAdvice } from "@/components/NotLegalAdvice";
import { PrintButton } from "@/components/PrintButton";
import { formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { loadReviewPage } from "@/lib/subcontract-review/query";
import type { SummaryLine } from "@/lib/subcontract-review/summary";

/**
 * SECTION C — the one-page summary of a subcontract review, to print or save
 * as PDF. Print-styled HTML and the browser's own Save as PDF, the proposal
 * page's approach and for its reason: this monorepo has no PDF library for
 * documents and this does not add one.
 *
 * Everything on it is built by code (`lib/subcontract-review/summary.ts`) from
 * the findings, the person's decisions and the scope check — no model call is
 * made for it. Dismissed findings are left out. It reflects the decisions as
 * they stand when it is opened.
 */
export default async function SubcontractReviewSummaryPage({
  params,
}: {
  params: Promise<{ id: string; reviewId: string }>;
}) {
  const { id, reviewId } = await params;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;

  const owner = await prisma.subcontractReview.findFirst({
    where: { id: reviewId, jobId: id, job: { companyId: context.company.id } },
    select: { contractDocumentId: true },
  });
  if (!owner) notFound();
  const data = await loadReviewPage(id, context.company.id, owner.contractDocumentId, reviewId);
  if (!data?.review || !data.summary || !data.selected) notFound();
  const { job, selected, review, summary } = data;
  const timeZone = await viewerTimeZone();

  const sections: { title: string; lines: SummaryLine[]; empty: string; marker: string }[] = [
    { title: "Top risks", lines: summary.topRisks, empty: "No high or medium risks open.", marker: "top-risks" },
    { title: "Money terms", lines: summary.moneyTerms, empty: "No money terms found.", marker: "money" },
    { title: "Deadlines and notice windows", lines: summary.deadlines, empty: "No notice windows or deadlines found.", marker: "deadlines" },
    { title: "Insurance asks", lines: summary.insurance, empty: "No insurance requirements found.", marker: "insurance" },
    { title: "Scope gaps", lines: summary.scopeGaps, empty: "No scope gaps found against your bid.", marker: "scope" },
    { title: "Questions to raise with the GC", lines: summary.questions, empty: "No open questions.", marker: "questions" },
  ];

  return (
    <PageShell width="reading" className="print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/jobs/${job.id}/subcontract-review?version=${selected.id}`} className="text-sm text-link hover:underline">
          ← Back to the review
        </Link>
        <PrintButton />
      </div>

      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-ink">Subcontract review — {job.name}</h1>
        <p className="text-sm text-ink-body">
          Version {selected.versionNumber} ({selected.fileName}) · reviewed{" "}
          {formatInstant(review.completedAt ?? review.startedAt, timeZone, "numeric")}
          {review.state !== "COMPLETE" && " · NOT FINISHED — the review stopped before reading every page"}
        </p>
      </header>
      <NotLegalAdvice className="mb-6" />

      {sections.map((section) => (
        <section key={section.marker} className="mb-5 break-inside-avoid" data-subcontract-summary={section.marker}>
          <h2 className="mb-1 text-base font-semibold text-ink">{section.title}</h2>
          {section.lines.length === 0 ? (
            <p className="text-sm text-ink-muted">{section.empty}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-body">
              {section.lines.map((line, index) => (
                <li key={`${section.marker}-${index}`}>
                  {line.text}
                  {line.cite && <span className="ml-1 text-xs text-ink-muted">({line.cite})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {summary.unread && (
        <p className="mb-4 text-sm text-warn" data-subcontract-summary="unread">
          Not read (no text on the page): {summary.unread}. Read those pages yourself.
        </p>
      )}
      <p className="text-xs text-ink-muted">
        Every item above cites the contract&apos;s own words on the review screen. Findings you dismissed are not shown.
      </p>
    </PageShell>
  );
}

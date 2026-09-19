import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { LienDeadlinesBoard } from "@/components/LienDeadlinesBoard";
import { toJobOption } from "@/components/jobLabels";
import { loadLienDeadlines } from "@/lib/lien-deadlines-query";
import { DUE_SOON_DAYS, summarizeLienDeadlines } from "@/lib/lien-deadlines";
import { viewerToday } from "@/lib/viewerToday";

/**
 * Lien-rights deadlines — preliminary notices, mechanic's liens, stop
 * payment notices, bond claims — across every job.
 *
 * MANAGE_BILLING: a lien is how a sub gets paid when a GC stops paying,
 * and the people who chase money hold this capability.
 *
 * THE APP NEVER COMPUTES A LEGAL DEADLINE. Every date here was entered by
 * a person. The page only sorts, counts and shouts.
 *
 * "Today" is the VIEWER's calendar day (viewerToday), not the server's UTC
 * one: this is a page where the exact day decides whether something reads
 * as OVERDUE, which is the case serverToday.ts's own comment says it is not
 * good enough for.
 */
export default async function LienDeadlinesPage() {
  const { context, allowed } = await requireCapability("MANAGE_BILLING");
  if (!allowed) return <NoAccess capability="MANAGE_BILLING" />;
  const companyId = context.company.id;
  const today = await viewerToday();

  const [rows, jobs] = await Promise.all([
    loadLienDeadlines(companyId, today),
    prisma.job.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, contact: { select: { name: true } } },
    }),
  ]);
  const summary = summarizeLienDeadlines(rows, today);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Lien deadlines</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-body">
        Preliminary notices, mechanic&apos;s liens, stop payment notices and bond claims — the dates
        that keep your right to get paid. Miss one and you can lose lien rights. This app does
        not work out any of these dates: they depend on the state, on public or private work and on
        your tier, so every date here is one you entered from your attorney or the statute. It keeps
        them sorted here, and puts any within 14 days or overdue on the alerts list, until they are
        served.
      </p>

      {/* One column on a phone: three tiles across 375px left ~60px
          per tile for labels like "Due in the next 14 days". */}
      <dl className="mb-8 grid gap-3 sm:grid-cols-3" data-tour="lien-totals">
        <div
          className={`rounded-lg border p-4 ${
            summary.overdueUnserved > 0 ? "border-bar-rose bg-tag-rose" : "border-line-card bg-surface"
          }`}
        >
          <dt className="text-xs text-ink-label">Overdue, not served</dt>
          <dd
            className={`mt-1 text-2xl font-semibold ${
              summary.overdueUnserved > 0 ? "text-tag-rose-ink" : "text-ink"
            }`}
          >
            {summary.overdueUnserved}
          </dd>
        </div>
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <dt className="text-xs text-ink-label">Due in the next {DUE_SOON_DAYS} days</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink">{summary.dueWithin14Days}</dd>
        </div>
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <dt className="text-xs text-ink-label">Served</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink">{summary.served}</dd>
        </div>
      </dl>

      <LienDeadlinesBoard
        rows={rows}
        jobs={jobs.map(toJobOption)}
        // Removing a deadline, or taking a served date back off, is the
        // owner's call; the actions refuse anyone else in a sentence.
        canRemove={context.role === "OWNER"}
      />
    </div>
  );
}

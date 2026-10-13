import Link from "next/link";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
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
  const billedJobs = jobs.filter((job) => job.status !== "ESTIMATE");

  return (
    <PageShell width="working">
      <PageHeader
        route="/lien-deadlines"
        subtitle={
          <>
            Preliminary notices, mechanic&apos;s liens, stop payment notices and bond claims — the
            dates that keep your right to get paid.
          </>
        }
      />
      <p className="mb-6 max-w-2xl text-sm text-ink-body">
        Miss one and you can lose lien rights. This app does
        not work out any of these dates: they depend on the state, on public or private work and on
        your tier, so every date here is one you entered from your attorney or the statute. It keeps
        them sorted here, and puts any within 14 days or overdue on the alerts list, until they are
        served.
      </p>

      {/* One column on a phone: three tiles across 375px left ~60px
          per tile for labels like "Due in the next 14 days". */}
      <dl className="mb-8 grid gap-3 sm:grid-cols-3" data-tour="lien-totals">
        <div
          className={`rounded-xl border p-4 ${
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
        <div className="rounded-xl border border-line-card bg-surface p-4">
          <dt className="text-xs text-ink-label">Due in the next {DUE_SOON_DAYS} days</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink">{summary.dueWithin14Days}</dd>
        </div>
        <div className="rounded-xl border border-line-card bg-surface p-4">
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

      {/* There is no company-wide waiver list: each job's waivers live at the
          foot of its Billing tab. This is the door to them from the Money
          area, one link per job that HAS a Billing tab (not an estimate). */}
      <section id="lien-waivers" className="mt-10 scroll-mt-6">
        <h2 className="text-sm font-semibold text-ink-label">Lien waivers</h2>
        <p className="mt-1 text-sm text-ink-body">Each job&apos;s waivers are kept on its Billing tab. Pick the job.</p>
        {billedJobs.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No contracted jobs yet. Waivers start once a job is contracted.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-row border-y border-line-row">
            {billedJobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}/billing#lien-waivers`}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-base text-ink hover:text-link mouse:min-h-9 sm:text-sm"
                >
                  <span className="min-w-0 truncate">{job.name}</span>
                  {job.contact?.name && <span className="shrink-0 text-sm text-ink-muted">{job.contact.name}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

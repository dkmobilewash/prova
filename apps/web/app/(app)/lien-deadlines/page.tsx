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
import { Disclosure } from "@/components/Disclosure";
import { StatusLine } from "@/components/StatusLine";
import { lienDeadlinesStatus } from "@/lib/status-sentences";

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
      {/* The one explainer — LienDeadlinesBoard's empty state printed the
          same paragraph again (density audit #26). */}
      <Disclosure variant="plain" summary="How these dates work · the app never computes one" className="mb-4 max-w-2xl">
        <p className="text-sm text-ink-body">
          Miss one and you can lose lien rights. This app does
          not work out any of these dates: they depend on the state, on public or private work and on
          your tier, so every date here is one you entered from your attorney or the statute. It keeps
          them sorted here, and puts any within 14 days or overdue on the alerts list, until they are
          served.
        </p>
      </Disclosure>

      {/* One sentence instead of three tiles that mostly read 0; red or
          amber only when a deadline is at risk. */}
      <div data-tour="lien-totals">
        <StatusLine
          report={lienDeadlinesStatus({
            overdueUnserved: summary.overdueUnserved,
            dueSoon: summary.dueWithin14Days,
            dueSoonDays: DUE_SOON_DAYS,
            served: summary.served,
          })}
        />
      </div>

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
      <p id="lien-waivers" className="mt-10 scroll-mt-6 text-sm text-ink-body">
        <span className="font-semibold text-ink-label">Lien waivers</span> are kept on each job&apos;s Billing tab
        {billedJobs.length === 0 ? (
          <span className="text-ink-muted"> — no contracted jobs yet. Waivers start once a job is contracted.</span>
        ) : (
          <>
            :{" "}
            {billedJobs.map((job, i) => (
              <span key={job.id}>
                {i > 0 && " · "}
                <Link
                  href={`/jobs/${job.id}/billing#lien-waivers`}
                  title={job.contact?.name ?? undefined}
                  className="inline-flex min-h-11 items-center text-link hover:text-link-hover hover:underline mouse:min-h-7"
                >
                  {job.name}
                </Link>
              </span>
            ))}
          </>
        )}
      </p>
    </PageShell>
  );
}

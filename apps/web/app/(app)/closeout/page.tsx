import Link from "next/link";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { CloseoutJobCard } from "@/components/CloseoutJobCard";
import { CloseoutPackagePanel } from "@/components/CloseoutPackagePanel";
import { blockerLabel, plural, stageLabel } from "@/components/closeoutPackageLabels";
import {
  isOpen,
  outstandingRequired,
  warrantyState,
} from "@/components/closeoutLabels";
import { needsAttention } from "@/lib/closeout-readiness";
import { loadCloseoutJobs } from "@/lib/closeout-query";
import { money } from "@/lib/money";
import { can } from "@/lib/permissions";
import { StatusLine } from "@/components/StatusLine";
import { closeoutStatus } from "@/lib/status-sentences";
import { viewerToday } from "@/lib/viewerToday";
import { Disclosure } from "@/components/Disclosure";
import { seeAllWindow } from "@/components/SeeAll";

export const metadata = { title: "Closeout & warranty" };

export default async function CloseoutPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string | string[] }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_JOBS");
  if (!allowed) return <NoAccess capability="MANAGE_JOBS" />;
  const { company, ...currentUser } = context;
  const today = await viewerToday();

  const withReadiness = await loadCloseoutJobs(company.id, today);
  const rows = withReadiness;

  // Retainage is the company's money, not everyone's business. A foreman
  // needs to know the package is stuck; what it is holding up in dollars
  // is a margin conversation. Without this the job-function work would
  // have a hole straight through it on a page a field tier can reach.
  const showsMoney = can(
    { role: currentUser.role, jobFunction: currentUser.jobFunction },
    "VIEW_COMPANY_FINANCIALS",
  );

  // A job not yet In progress (an estimate, a contract not started) has
  // nothing to close out — every one of them reads "no closeout checklist
  // yet", which is true and useless. It is under way once it reaches In
  // progress OR anything closeout-shaped exists on it, so a job somebody
  // started a checklist or a warranty on is never hidden by its status.
  // Declutter, 2026-10-13: Lakeshore, still an estimate, was a full card.
  const underWay = (job: (typeof rows)[number]) =>
    job.status === "IN_PROGRESS" ||
    job.status === "COMPLETE" ||
    job.items.length > 0 ||
    job.submissions.length > 0 ||
    job.requests.length > 0 ||
    job.warranty !== null ||
    job.retainageBalance > 0;
  // The counter and the list's top are still ONE set (see below): what needs
  // attention among the jobs under way.
  const attention = needsAttention(withReadiness.filter(underWay));
  const readyToSubmit = withReadiness.filter((j) => j.readiness.stage === "READY_TO_SUBMIT");
  const retainageBehindCloseout = attention.reduce((sum, j) => sum + j.readiness.retainageAtStake, 0);

  // All three counted across every job, and all three derived — there is no
  // stored "closed out" or "in warranty" flag anywhere in this feature.
  //
  // This counter has now been wrong twice, the same way both times. First it
  // was `r.items.length > 0 && !isCloseoutComplete(r.items)` -- checklist
  // only -- and read 0 while the list showed fifteen not-ready jobs. Then it
  // became `blockers.length > 0`, which browser testing caught reading 15
  // against a list of 16: a job whose checklist is ticked and which NOBODY
  // HAS SENT has no blockers, so it vanished from the number while staying
  // in the list. That job is exactly the one somebody needs chasing.
  //
  // Both versions were the same mistake -- a SECOND computation of what the
  // list already decides -- and the first fix only swapped one duplicate for
  // another. There is one derivation now, and the counter and the list are
  // the same set by construction rather than by agreement.
  const outstandingJobs = attention.length;
  const inWarranty = rows.filter((r) => warrantyState(r.warranty, today) === "ACTIVE").length;
  const openCallbacks = rows.reduce((n, r) => n + r.requests.filter(isOpen).length, 0);
  const totalOutstandingItems = rows.reduce((n, r) => n + outstandingRequired(r.items).length, 0);
  const status = closeoutStatus({
    outstandingJobs,
    outstandingItems: totalOutstandingItems,
    readyToSubmit: readyToSubmit.length,
    inWarranty,
    openCallbacks,
    retainage: showsMoney && retainageBehindCloseout > 0 ? money(retainageBehindCloseout) : null,
  });

  // Most money first, then the rest; jobs not under way wait behind "Show
  // all jobs" (`?all=1`).
  const { showingAll } = seeAllWindow((await searchParams).all);
  const attentionIds = new Set(attention.map((j) => j.id));
  const ordered = [...attention, ...rows.filter((r) => !attentionIds.has(r.id))];
  const notStarted = rows.filter((r) => !underWay(r)).length;
  const shown = showingAll ? ordered : ordered.filter(underWay);

  return (
    <PageShell width="working">
      <PageHeader
        route="/closeout"
        subtitle="What is still owed before final payment, and what you are still on the hook for after it."
      />
      <StatusLine report={status} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line-card bg-surface p-6" data-tour="closeout-empty">
          <p className="text-ink-label">
            No jobs yet. Closeout and warranty both hang off a job.
          </p>
          <p className="mt-2 max-w-2xl text-sm text-ink-body">
            Each job gets a checklist of what the GC wants before final payment — lien waivers, as-built
            drawings, O&amp;M manuals, warranty letters — and this page ranks the jobs by what is holding
            the most retainage. After the package is accepted the warranty clock starts here too, so a
            callback that arrives eleven months later can be checked against it instead of guessed at.
          </p>
          <Link
            href="/jobs/new"
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-medium text-neutral-900 hover:bg-brand-hover"
          >
            Create a job
          </Link>
        </div>
      ) : (
        // "What to do next" IS the list (declutter, 2026-10-13): one row per
        // job — stage · what is holding it up · retainage held — and a click
        // opens the job's full card under it, one at a time. The blockers are
        // said here and only here; the card and the package panel used to
        // say them twice more.
        <section className="mb-6 rounded-xl border border-line-card bg-surface p-4" data-tour="closeout-next">
          <h2 className="mb-1 text-sm font-semibold text-ink-label">What to do next</h2>
          <p className="mb-2 text-xs text-ink-muted">
            Most money first. A job leaves the top once the GC has accepted its package.
          </p>
          {shown.length === 0 && (
            <p className="py-2 text-sm text-ink-body">No job has reached In progress yet, so there is nothing to close out.</p>
          )}
          <ul data-tour="closeout-jobs">
            {shown.map((job) => (
              <li key={job.id} data-closeout-job={job.id}>
                <Disclosure
                  variant="row"
                  name="closeout-job"
                  summary={
                    <span className="min-w-0">
                      <span className="text-ink">{job.name}</span>
                      <span className="text-ink-muted"> · {stageLabel(job.readiness.stage).toLowerCase()}</span>
                      {job.readiness.blockers.length > 0 && (
                        <span className="text-ink-body" data-closeout-blockers>
                          {" "}
                          · {job.readiness.blockers.map(blockerLabel).join(", ")}
                        </span>
                      )}
                      {showsMoney && job.readiness.retainageAtStake > 0 && (
                        <span className="font-mono text-ink-body"> · {money(job.readiness.retainageAtStake)} held</span>
                      )}
                      {job.readiness.stage === "AWAITING_GC" && job.readiness.daysWithGc !== null && (
                        <span className="text-ink-muted"> · {plural(job.readiness.daysWithGc, "day", "days")} with them</span>
                      )}
                    </span>
                  }
                >
                  <CloseoutJobCard
                    job={job}
                    today={today}
                    packageSlot={
                      <CloseoutPackagePanel
                        jobId={job.id}
                        readiness={showsMoney ? job.readiness : { ...job.readiness, retainageAtStake: 0 }}
                        submissions={job.submissions}
                        canDelete={currentUser.role === "OWNER"}
                      />
                    }
                    canDelete={currentUser.role === "OWNER"}
                  />
                </Disclosure>
              </li>
            ))}
          </ul>
          {notStarted > 0 && (
            <Link
              href={showingAll ? "/closeout" : "/closeout?all=1"}
              className="mt-2 inline-flex min-h-11 items-center text-sm text-link hover:text-link-hover hover:underline mouse:min-h-7"
            >
              {showingAll
                ? "Show only jobs under way"
                : `Show all jobs (${plural(notStarted, "more is", "more are")} not under way yet)`}
            </Link>
          )}
        </section>
      )}

      <Disclosure summary="Why closeout is money" className="mt-6">
        <p className="text-sm text-ink-body">
          Retainage is usually released against a closeout package, so a missing lien waiver is
          money sitting with the GC — and a callback logged after the warranty ran out is the
          difference between a favour and work you should be paid for. &ldquo;The checklist is
          ticked&rdquo; and &ldquo;they took it&rdquo; are different claims, and only the second
          one releases retainage.
        </p>
      </Disclosure>
    </PageShell>
  );
}

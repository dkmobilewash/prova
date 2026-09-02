import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { CloseoutJobCard } from "@/components/CloseoutJobCard";
import { CloseoutPackagePanel } from "@/components/CloseoutPackagePanel";
import { blockerLabel, stageLabel } from "@/components/closeoutPackageLabels";
import {
  isCloseoutComplete,
  isOpen,
  outstandingRequired,
  requiredItems,
  warrantyState,
} from "@/components/closeoutLabels";
import { closeoutReadiness, needsAttention } from "@/lib/closeout-readiness";
import { calculateRetainageSummary } from "@/lib/retainage";
import { money } from "@/lib/money";
import { can } from "@/lib/permissions";

/** Stored at UTC midnight, rendered in UTC — same rule as every other
 * dated record in this app. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function CloseoutPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  const today = new Date().toISOString().slice(0, 10);

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      closeoutItems: { orderBy: [{ isRequired: "desc" }, { name: "asc" }] },
      warrantyPeriod: true,
      warrantyServiceRequests: { orderBy: { reportedOn: "desc" } },

      // Read, never written, by this page. Punch items belong to
      // /punch-lists and retainage to the billing lane; readiness only
      // needs to know they exist, and an open punch item holds closeout
      // open whether or not anyone ticked "punch list sign-off".
      punchListItems: { where: { isDone: false }, select: { id: true } },
      invoices: { select: { retainageWithheld: true } },
      retainageReleases: { select: { amount: true } },
      substantialCompletionDate: true,

      closeoutSubmissions: {
        orderBy: { attempt: "desc" },
        include: { submittedByUser: { select: { name: true } } },
      },
    },
  });

  const rows = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    items: job.closeoutItems.map((i) => ({
      id: i.id,
      name: i.name,
      isRequired: i.isRequired,
      completedOn: isoDate(i.completedOn),
      note: i.note,
      documentUrl: i.documentUrl,
      documentName: i.documentName,
    })),
    warranty: job.warrantyPeriod
      ? {
          startsOn: isoDate(job.warrantyPeriod.startsOn) as string,
          months: job.warrantyPeriod.months,
          note: job.warrantyPeriod.note,
        }
      : null,
    requests: job.warrantyServiceRequests.map((r) => ({
      id: r.id,
      reportedOn: isoDate(r.reportedOn) as string,
      description: r.description,
      reportedBy: r.reportedBy,
      responsibility: r.responsibility,
      resolvedOn: isoDate(r.resolvedOn),
      resolutionNote: r.resolutionNote,
    })),
    submissions: job.closeoutSubmissions.map((s) => ({
      id: s.id,
      attempt: s.attempt,
      submittedOn: isoDate(s.submittedOn) as string,
      method: s.method,
      status: s.status as string,
      respondedOn: isoDate(s.respondedOn),
      gcResponse: s.gcResponse,
      note: s.note,
      submittedByName: s.submittedByUser?.name ?? null,
    })),
    openPunchItems: job.punchListItems.length,
    // Withheld minus released, through the one implementation of that sum
    // — recomputing it here would be a second copy free to disagree with
    // /cash-flow and the metric bar.
    retainageBalance: calculateRetainageSummary({
      invoiceRetainageWithheld: job.invoices.map((i) =>
        i.retainageWithheld != null ? Number(i.retainageWithheld) : null,
      ),
      releaseAmounts: job.retainageReleases.map((r) => Number(r.amount)),
      substantialCompletionDate: job.substantialCompletionDate,
    }).balance,
  }));

  // Whose move it is on each job, derived — there is no stored "ready" or
  // "submitted" flag anywhere in this feature, same rule as closeout
  // completeness and warranty expiry above.
  const withReadiness = rows.map((job) => ({
    ...job,
    readiness: closeoutReadiness(
      {
        requiredItemsTotal: requiredItems(job.items).length,
        requiredItemsOutstanding: outstandingRequired(job.items).length,
        openPunchItems: job.openPunchItems,
        openCallbacks: job.requests.filter(isOpen).length,
        retainageBalance: job.retainageBalance,
        latestSubmission: job.submissions[0]
          ? {
              status: job.submissions[0].status,
              submittedOn: job.submissions[0].submittedOn,
              respondedOn: job.submissions[0].respondedOn,
            }
          : null,
      },
      today,
    ),
  }));

  // Retainage is the company's money, not everyone's business. A foreman
  // needs to know the package is stuck; what it is holding up in dollars
  // is a margin conversation. Without this the job-function work would
  // have a hole straight through it on a page a field tier can reach.
  const showsMoney = can(
    { role: currentUser.role, jobFunction: currentUser.jobFunction },
    "VIEW_COMPANY_FINANCIALS",
  );

  const attention = needsAttention(withReadiness);
  const readyToSubmit = withReadiness.filter((j) => j.readiness.stage === "READY_TO_SUBMIT");
  const retainageBehindCloseout = attention.reduce((sum, j) => sum + j.readiness.retainageAtStake, 0);

  // All three counted across every job, and all three derived — there is no
  // stored "closed out" or "in warranty" flag anywhere in this feature.
  const outstandingJobs = rows.filter((r) => r.items.length > 0 && !isCloseoutComplete(r.items)).length;
  const inWarranty = rows.filter((r) => warrantyState(r.warranty, today) === "ACTIVE").length;
  const openCallbacks = rows.reduce((n, r) => n + r.requests.filter(isOpen).length, 0);
  const totalOutstandingItems = rows.reduce((n, r) => n + outstandingRequired(r.items).length, 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Closeout &amp; warranty</h1>
      <p className="mb-6 text-sm text-slate-400">
        What&apos;s still owed before final payment, and what you&apos;re still on the hook for after
        it. Retainage is usually released against a closeout package, so a missing lien waiver is
        money sitting with the GC — and a callback logged after the warranty ran out is the
        difference between a favour and work you should be paid for.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${outstandingJobs > 0 ? "text-amber-300" : "text-slate-100"}`}>
            {outstandingJobs}
          </p>
          <p className="text-xs text-slate-500">
            Jobs with closeout outstanding
            {totalOutstandingItems > 0 && ` · ${totalOutstandingItems} items`}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-blue-300">{inWarranty}</p>
          <p className="text-xs text-slate-500">Jobs still in warranty</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${openCallbacks > 0 ? "text-red-300" : "text-slate-100"}`}>
            {openCallbacks}
          </p>
          <p className="text-xs text-slate-500">Open callbacks</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="font-mono text-xl font-semibold text-slate-100">
            {showsMoney ? money(retainageBehindCloseout) : `${attention.length} jobs`}
          </p>
          <p className="text-xs text-slate-500">
            {showsMoney ? "Retainage behind an unfinished closeout" : "Waiting on something"}
            {readyToSubmit.length > 0 && (
              <span className="text-amber-300"> · {readyToSubmit.length} ready to send today</span>
            )}
          </p>
        </div>
      </div>

      {attention.length > 0 && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-300">What to do next</h2>
          <p className="mb-3 text-xs text-slate-500">
            Most money first. A job is only off this list once the GC has accepted its package —
            &ldquo;the checklist is ticked&rdquo; and &ldquo;they took it&rdquo; are different
            claims, and only the second one releases retainage.
          </p>
          <ul className="flex flex-col gap-2">
            {attention.map((job) => (
              <li key={job.id} className="text-sm text-slate-300">
                <span className="text-slate-100">{job.name}</span>
                <span className="text-slate-500"> — {stageLabel(job.readiness.stage).toLowerCase()}</span>
                {job.readiness.blockers.length > 0 && (
                  <span className="text-slate-400">
                    : {job.readiness.blockers.map(blockerLabel).join(", ")}
                  </span>
                )}
                {showsMoney && job.readiness.retainageAtStake > 0 && (
                  <span className="font-mono text-slate-400">
                    {" "}
                    · {money(job.readiness.retainageAtStake)} held
                  </span>
                )}
                {job.readiness.stage === "AWAITING_GC" && job.readiness.daysWithGc !== null && (
                  <span className="text-slate-500"> · {job.readiness.daysWithGc} days with them</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="text-slate-400">
          No jobs yet. Closeout and warranty both hang off a job — create one and it will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {withReadiness.map((job) => (
            <CloseoutJobCard
              key={job.id}
              job={job}
              today={today}
              packageSlot={
                <CloseoutPackagePanel
                  jobId={job.id}
                  readiness={
                    showsMoney
                      ? job.readiness
                      : { ...job.readiness, retainageAtStake: 0 }
                  }
                  submissions={job.submissions}
                  canDelete={currentUser.role === "OWNER"}
                />
              }
              canDelete={currentUser.role === "OWNER"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

import { requireCompanyContext } from "@/lib/auth";
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

export default async function CloseoutPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  const today = new Date().toISOString().slice(0, 10);

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

  const attention = needsAttention(withReadiness);
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
            {totalOutstandingItems > 0 && ` · ${plural(totalOutstandingItems, "item", "items")}`}
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
            {showsMoney
              ? money(retainageBehindCloseout)
              : plural(attention.length, "job", "jobs")}
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
                  <span className="text-slate-500">
                    {" "}
                    · {plural(job.readiness.daysWithGc, "day", "days")} with them
                  </span>
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
              packageStage={job.readiness.stage}
              // The SAME array the panel below the chip renders. Passed
              // rather than recomputed in the card: two readings of one
              // checklist is what put an amber "0 still outstanding"
              // directly above a panel saying no checklist exists.
              packageBlockers={job.readiness.blockers}
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

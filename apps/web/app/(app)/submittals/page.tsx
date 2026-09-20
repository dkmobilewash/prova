import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { SubmittalForm } from "@/components/SubmittalForm";
import { EmptyState } from "@/components/EmptyState";
import { SubmittalRow } from "@/components/SubmittalRow";
import { daysBetween, isOverdue, latestRevision, submittalState } from "@/components/submittalLabels";
import { StatusLine } from "@/components/StatusLine";
import { submittalsStatus } from "@/lib/status-sentences";
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";
import { viewerToday } from "@/lib/viewerToday";
import { ProcoreFeedSection, loadProcoreFeed } from "@/components/ProcoreFeedSection";
import { ACCFeedSection, loadAccFeed } from "@/components/ACCFeedSection";

/** Stored at UTC midnight, rendered in UTC — same rule as RFIs, the
 * safety log and daily field reports. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function SubmittalsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_JOBS");
  if (!allowed) return <NoAccess capability="MANAGE_JOBS" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter, show } = await searchParams;
  const showApproved = show === "all";

  // The READER'S calendar day, not the server's UTC one — see /rfis for the
  // full argument. `dueBack` is the date we asked the GC for, and measuring
  // it against UTC told a Pacific viewer after 5pm that the GC had blown a
  // deadline that had not passed yet. The zone arrives as request data from
  // the timezone cookie (lib/viewerToday.ts), so nothing is computed in the
  // browser during render and hydration is untouched.
  const today = await viewerToday();

  // status + contact, not just the name: issue #65 — fifteen jobs, seven of
  // them called "Smith kitchen remodel", and this picker showed seven
  // identical rows. See components/jobLabels.ts.
  const jobs = (
    await prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, contact: { select: { name: true } } },
    })
  ).map(toJobOption);
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const submittals = await prisma.submittal.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
    },
    orderBy: [{ jobId: "asc" }, { number: "desc" }],
    include: {
      job: { select: { name: true } },
      submittedBy: { select: { name: true } },
      revisions: { orderBy: { revisionNumber: "asc" } },
    },
  });

  const allRows = submittals.map((submittal) => ({
    id: submittal.id,
    number: submittal.number,
    jobName: submittal.job.name,
    title: submittal.title,
    description: submittal.description,
    specSection: submittal.specSection,
    drawingReference: submittal.drawingReference,
    submittedByName: submittal.submittedBy?.name ?? null,
    revisions: submittal.revisions.map((rev) => ({
      revisionNumber: rev.revisionNumber,
      sentOn: isoDate(rev.sentOn) as string,
      dueBack: isoDate(rev.dueBack),
      returnedOn: isoDate(rev.returnedOn),
      outcome: rev.outcome,
      responseNotes: rev.responseNotes,
    })),
  }));

  // Approval is the normal end state, so approved packages leave the
  // default view — but they stay one click away, because "which revision
  // was approved" is exactly what someone checks before building.
  // Whether this company has EVER logged one, not whether the current
  // filter shows any — the teaching empty state is for the first, and a
  // filter that happens to match nothing keeps its plain line.
  const everLogged = activeJob ? await prisma.submittal.count({ where: { companyId: company.id } }) : allRows.length;

  const rows = showApproved
    ? allRows
    : allRows.filter((row) => submittalState(row.revisions) !== "APPROVED");

  const withGcCount = allRows.filter((r) => submittalState(r.revisions) === "WITH_GC").length;
  const revise = allRows
    .filter((r) => submittalState(r.revisions) === "REVISE")
    .map((r) => ({ number: r.number, jobName: r.jobName }));
  const overdueWithGc = allRows.flatMap((r) => {
    if (!isOverdue(r.revisions, today)) return [];
    const dueBack = latestRevision(r.revisions)?.dueBack as string;
    return [{ number: r.number, jobName: r.jobName, daysOverdue: daysBetween(dueBack, today) }];
  });
  // Counted from all rows for this filter, not the visible ones — the
  // default view hides exactly this set, and a tile that falls to zero
  // because the things it counts are hidden is the bug the RFI impact
  // tile had.
  const approvedCount = allRows.filter((r) => submittalState(r.revisions) === "APPROVED").length;
  const status = submittalsStatus({ revise, overdueWithGc, withGc: withGcCount, approved: approvedCount, total: allRows.length });

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showApproved ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/submittals?${qs}` : "/submittals";
  };

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  // The GC's records from Procore, if this company links any (see
  // components/ProcoreFeedSection.tsx).
  const procoreFeed = await loadProcoreFeed(company.id, "SUBMITTAL", activeJob);
  // Same, from Autodesk Construction Cloud (see components/ACCFeedSection.tsx).
  const accFeed = await loadAccFeed(company.id, "SUBMITTAL", activeJob);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Submittals</h1>
      <p className="mb-6 text-sm text-ink-body">
        Shop drawings and product data sent for approval, and what came back. The one question this
        page answers is &ldquo;which revision is it legal to build from?&rdquo; — work built from a
        superseded or unapproved drawing is rework, and &ldquo;the GC sat on it for five weeks&rdquo;
        is worth nothing in a delay claim without the dates.
      </p>

      <section className="mb-8" data-tour="submittals-log">
        <SubmittalForm jobs={jobs} defaultJobId={activeJob ?? undefined} />
      </section>

      <StatusLine report={status} />

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-tour="submittals-job-filter">
          <Link href={filterHref({ job: null })} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobs.map((j) => (
            <Link key={j.id} href={filterHref({ job: j.id })} className={chip(activeJob === j.id)}>
              {jobPickerLabel(j)}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-label">
          {rows.length} {showApproved ? "total" : "in play"}
        </h2>
        <Link
          href={filterHref({ show: showApproved ? null : "all" })}
          data-tour="submittals-show-approved"
          className="text-sm text-link"
        >
          {showApproved ? "Hide approved" : "Show approved"}
        </Link>
      </div>

      {rows.length === 0 && everLogged === 0 ? (
        <EmptyState
          data-tour="submittals-empty"
          title="No submittals yet"
          purpose={
            <p>
              What you sent for sign-off before you build — cabinet shop drawings, window and
              fixture spec sheets, finish samples — and what came back: approved, or revise and
              resend. It answers &ldquo;did they approve this one, and when?&rdquo; before the crew
              installs it.
            </p>
          }
          actions={
            jobs.length === 0
              ? [{ label: "Create a job", href: "/jobs/new" }]
              : [{ label: "Log a submittal", opens: "submittals-log" }]
          }
          example={{
            rows: [
              { title: "#4 Kitchen cabinets — shop drawings", tag: "With client", detail: "Smith kitchen remodel · sent Sep 6", meta: "due back Sep 13" },
              { title: "#3 Windows — product data", tag: "Revise and resend", detail: "Oak Ave addition · rev 1 returned Sep 2", meta: "rev 2 next" },
              { title: "#2 Tile and grout samples", tag: "Approved", detail: "Smith kitchen remodel · 5 days to approve", meta: "Aug 30" },
            ],
          }}
        />
      ) : rows.length === 0 ? (
        <p className="text-ink-body">
          {showApproved
            ? `No submittals${activeJob ? " on this job" : ""}.`
            : `Nothing in play${activeJob ? " on this job" : ""}. Approved ones are under “Show approved”.`}
        </p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="submittals-list">
          {rows.map((submittal) => (
            <SubmittalRow
              key={submittal.id}
              submittal={submittal}
              today={today}
              showJob={!activeJob}
              canDelete={currentUser.role === "OWNER"}
            />
          ))}
        </ul>
      )}

      {/* The GC's records from Procore: a separate section, never merged
          into this company's own log above. */}
      <ProcoreFeedSection feed={procoreFeed} />
      {/* Same, from Autodesk Construction Cloud. */}
      <ACCFeedSection feed={accFeed} />
    </div>
  );
}

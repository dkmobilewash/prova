import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { AskDraftNotice } from "@/components/AskDraftNotice";
import { loadRfiDraft } from "@/lib/ask/drafts";
import { RfiForm } from "@/components/RfiForm";
import { EmptyState } from "@/components/EmptyState";
import { RfiRow } from "@/components/RfiRow";
import { daysBetween, isOpen, isOverdue } from "@/components/rfiLabels";
import { StatusLine } from "@/components/StatusLine";
import { rfisStatus } from "@/lib/status-sentences";
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";
import { viewerToday } from "@/lib/viewerToday";
import { ProcoreFeedSection, loadProcoreFeed } from "@/components/ProcoreFeedSection";
import { ACCFeedSection, loadAccFeed } from "@/components/ACCFeedSection";

/** Stored at UTC midnight, rendered in UTC — same rule as the safety log
 * and daily field reports. Local rendering shows the previous day to
 * anyone west of UTC, which only shows up in production. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function RfisPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string; draft?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_JOBS");
  if (!allowed) return <NoAccess capability="MANAGE_JOBS" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter, show, draft } = await searchParams;
  const showClosed = show === "all";

  // A card from the Ask box (lib/ask/drafts.ts): the form opens prefilled
  // from the server-held row, and its own Save is the write.
  const askDraft = await loadRfiDraft(context, draft);
  const rfiDraft = askDraft.kind === "draft" ? askDraft.draft : undefined;

  // The READER'S calendar day, not the server's UTC one. `dueBy` is a plain
  // calendar day — the UTC midnight is only how a date with no time reaches
  // Postgres — so the day it is measured against is the day on the wall
  // behind whoever is looking. Measured in UTC, an RFI due today flipped to
  // OVERDUE at 5pm Pacific and the status line named it and counted the days
  // it was late, on a page whose whole subject is dates being defensible.
  // Resolved from the timezone cookie on the server (lib/viewerToday.ts), so
  // this is request data and not a browser call during render — the
  // hydration trap on components/localToday.ts does not apply here.
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

  const rfis = await prisma.rfi.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      ...(showClosed ? {} : { status: { not: "CLOSED" } }),
    },
    orderBy: [{ jobId: "asc" }, { number: "desc" }],
    include: { job: { select: { name: true } }, askedBy: { select: { name: true } } },
  });

  const rows = rfis.map((rfi) => ({
    id: rfi.id,
    number: rfi.number,
    jobName: rfi.job.name,
    subject: rfi.subject,
    question: rfi.question,
    drawingReference: rfi.drawingReference,
    specSection: rfi.specSection,
    status: rfi.status,
    sentOn: isoDate(rfi.sentOn),
    dueBy: isoDate(rfi.dueBy),
    answeredOn: isoDate(rfi.answeredOn),
    answer: rfi.answer,
    costImpact: rfi.costImpact,
    scheduleImpact: rfi.scheduleImpact,
    askedByName: rfi.askedBy?.name ?? null,
  }));

  const openCount = rows.filter((r) => isOpen(r.status)).length;
  const overdue = rows
    .filter((r) => isOverdue(r, today))
    .map((r) => ({ number: r.number, jobName: r.jobName, daysOverdue: daysBetween(r.dueBy as string, today) }));

  // Counted from the database rather than from `rows`, unlike the two
  // above. Open and overdue are properties of RFIs still in play, so the
  // default view already holds all of them. Cost/schedule impact is the
  // set you pull when building a change order — a job-lifetime figure —
  // and closing an answered RFI is the normal end state, so counting the
  // visible rows made the tile fall to zero exactly as the work got done.
  // Whether this company has EVER raised one, not whether the current
  // filter shows any — the teaching empty state is for the first, and a
  // filter that happens to match nothing gets the plain line.
  const everRaised = await prisma.rfi.count({ where: { companyId: company.id } });

  const impactCount = await prisma.rfi.count({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      OR: [{ costImpact: true }, { scheduleImpact: true }],
    },
  });
  const status = rfisStatus({ overdue, open: openCount, impact: impactCount });

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showClosed ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/rfis?${qs}` : "/rfis";
  };

  // 44px tall, from 34px. The job filter is the first thing someone on site
  // taps to reach their own job's RFIs.
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  // The GC's records from Procore, if this company links any (see
  // components/ProcoreFeedSection.tsx).
  const procoreFeed = await loadProcoreFeed(company.id, "RFI", activeJob);
  // Same, from Autodesk Construction Cloud (see components/ACCFeedSection.tsx).
  const accFeed = await loadAccFeed(company.id, "RFI", activeJob);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">RFIs</h1>
      <p className="mb-6 text-sm text-ink-body">
        Questions to the GC or architect, and what came back. This is evidence before it&apos;s a
        to-do list: an RFI sent on a date and answered three weeks later is the documentation behind a
        delay claim, and &ldquo;we asked and nobody got back to us&rdquo; is worth nothing without the
        dates.
      </p>

      <section className="mb-8" data-tour="rfis-raise">
        {askDraft.kind === "gone" && <AskDraftNotice what="RFI" />}
        {/* No `today` handed down. The form's sent-date default is
            localToday() — the browser's day, set after a click opens the
            form — and the prop this page used to pass was never read. */}
        <RfiForm
          jobs={jobs}
          defaultJobId={rfiDraft?.jobId ?? activeJob ?? undefined}
          draft={rfiDraft}
        />
      </section>

      <StatusLine report={status} />

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-tour="rfis-job-filter">
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
          {rows.length} {showClosed ? "total" : "in play"}
        </h2>
        <Link
          href={filterHref({ show: showClosed ? null : "all" })}
          data-tour="rfis-show-closed"
          className="inline-flex min-h-11 items-center text-sm text-link"
        >
          {showClosed ? "Hide closed" : "Show closed"}
        </Link>
      </div>

      {rows.length === 0 && everRaised === 0 ? (
        <EmptyState
          data-tour="rfis-empty"
          title="No RFIs yet"
          purpose={
            <p>
              A written question to the GC or architect when the plans do not answer it —
              &ldquo;which wall type at the corridor tie-in?&rdquo;, &ldquo;can we move this stud
              line six inches?&rdquo; — with the date you asked and the date they answered. When a
              late answer holds up the job, this is the proof.
            </p>
          }
          actions={
            jobs.length === 0
              ? [{ label: "Create a job", href: "/jobs/new" }]
              : [{ label: "Raise an RFI", opens: "rfis-raise" }]
          }
          ask={jobs.length === 0 ? undefined : `Raise an RFI on ${jobs[0].name}: which tile goes in the hall bath?`}
          example={{
            rows: [
              { title: "RFI 3 — Hall bath tile selection", tag: "Waiting on answer", detail: "Smith kitchen remodel · asked Sep 4", meta: "due Sep 11" },
              { title: "RFI 2 — Header size over new opening", tag: "Answered", detail: "Oak Ave addition · answered in 6 days", meta: "cost impact" },
              { title: "RFI 1 — Outlet height at island", tag: "Closed", detail: "Smith kitchen remodel", meta: "Aug 29" },
            ],
          }}
        />
      ) : rows.length === 0 ? (
        <p className="text-ink-body">
          {showClosed
            ? `No RFIs${activeJob ? " on this job" : ""}.`
            : `Nothing open${activeJob ? " on this job" : ""}. Closed ones are under “Show closed”.`}
        </p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="rfis-list">
          {rows.map((rfi) => (
            <RfiRow
              key={rfi.id}
              rfi={rfi}
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

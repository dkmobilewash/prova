import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { DrawingSetForm } from "@/components/DrawingSetForm";
import { EmptyState } from "@/components/EmptyState";
import { DrawingSetRow } from "@/components/DrawingSetRow";
import { setState, unreceivedRevisions } from "@/components/drawingLabels";
import { StatusLine } from "@/components/StatusLine";
import { drawingsStatus } from "@/lib/status-sentences";
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";
import { viewerToday } from "@/lib/viewerToday";
import { ProcoreFeedSection, loadProcoreFeed } from "@/components/ProcoreFeedSection";

/** Stored at UTC midnight, rendered in UTC — same rule as every other
 * dated record in this app. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function DrawingsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_JOBS");
  if (!allowed) return <NoAccess capability="MANAGE_JOBS" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter } = await searchParams;

  // The READER'S calendar day, not the server's UTC one — see /rfis. There
  // is no overdue comparison on this page: `today` ends up in
  // `daysToReachUs`, so measuring it in UTC added a day to "waiting N days"
  // every Pacific afternoon. That is the number somebody quotes at the GC
  // about a revision that never arrived, so it does not get to be a day out.
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

  const sets = await prisma.drawingSet.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
    },
    orderBy: [{ jobId: "asc" }, { name: "asc" }],
    include: {
      job: { select: { name: true } },
      revisions: { orderBy: { issuedOn: "desc" } },
    },
  });

  const rows = sets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    jobName: set.job.name,
    revisions: set.revisions.map((rev) => ({
      id: rev.id,
      label: rev.label,
      issuedOn: isoDate(rev.issuedOn) as string,
      receivedOn: isoDate(rev.receivedOn),
      description: rev.description,
      fileUrl: rev.fileUrl,
      fileName: rev.fileName,
    })),
  }));

  // Per set, with how many issues each is missing — "which sets, and how
  // far behind" is what someone chases the GC with.
  // Whether this company has EVER logged one, not whether the current
  // filter shows any — the teaching empty state is for the first, and a
  // filter that happens to match nothing keeps its plain line.
  const everLogged = activeJob ? await prisma.drawingSet.count({ where: { companyId: company.id } }) : rows.length;

  const behind = rows
    .filter((r) => setState(r.revisions) === "BEHIND")
    .map((r) => ({ name: r.name, jobName: r.jobName, missing: unreceivedRevisions(r.revisions).length }));
  const inHandCount = rows.filter((r) => setState(r.revisions) === "CURRENT_IN_HAND").length;
  const status = drawingsStatus({ behind, inHand: inHandCount, total: rows.length });

  const filterHref = (job: string | null) => (job ? `/drawings?job=${job}` : "/drawings");

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  // The GC's records from Procore, if this company links any (see
  // components/ProcoreFeedSection.tsx).
  const procoreFeed = await loadProcoreFeed(company.id, "DRAWING", activeJob);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Drawings</h1>
      <p className="mb-6 text-sm text-ink-body">
        Which revision of each set is current, and whether it&apos;s actually in the trailer. A
        revision that has been issued supersedes the one before it whether or not it has reached you
        — so an issue you haven&apos;t received means the crew is building from paper that is already
        out of date, and that rework is nobody else&apos;s to pay for once you&apos;ve signed for the
        set.
      </p>

      <section className="mb-8" data-tour="drawings-add">
        <DrawingSetForm jobs={jobs} defaultJobId={activeJob ?? undefined} />
      </section>

      {/* At zero-ever the EmptyState below is the whole answer. The status
          line and the "0 sets" count above it said "nothing" twice more
          first — three empties stacked on a new account. /bids hides its
          count the same way; both come back with the first record. */}
      {(everLogged > 0 || rows.length > 0) && <StatusLine report={status} />}

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-tour="drawings-job-filter">
          <Link href={filterHref(null)} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobs.map((j) => (
            <Link key={j.id} href={filterHref(j.id)} className={chip(activeJob === j.id)}>
              {jobPickerLabel(j)}
            </Link>
          ))}
        </div>
      )}

      {(everLogged > 0 || rows.length > 0) && (
        <h2 className="mb-3 text-sm font-semibold text-ink-label">
          {rows.length} {rows.length === 1 ? "set" : "sets"}
        </h2>
      )}

      {rows.length === 0 && everLogged === 0 ? (
        <EmptyState
          data-tour="drawings-empty"
          title="No drawings yet"
          purpose={
            <p>
              The plans for each job and which version is current. When the architect or designer
              sends a revised set, log it here, so nobody on site builds from last month&apos;s
              pages — and you can show which version was in force on the day something was built.
            </p>
          }
          actions={
            jobs.length === 0
              ? [{ label: "Create a job", href: "/jobs/new" }]
              : [{ label: "Add a drawing set", opens: "drawings-add" }]
          }
          example={{
            rows: [
              { title: "Architectural", tag: "Current, in hand", detail: "Smith kitchen remodel · Rev C issued Sep 3", meta: "3 revisions" },
              { title: "Structural", tag: "Not received", detail: "Oak Ave addition · Rev B issued Sep 10, not in hand", meta: "2 revisions" },
              { title: "Electrical", tag: "Current, in hand", detail: "Oak Ave addition · Rev A", meta: "1 revision" },
            ],
          }}
        />
      ) : rows.length === 0 ? (
        <p className="text-ink-body">No drawing sets on this job yet.</p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="drawings-list">
          {rows.map((set) => (
            <DrawingSetRow
              key={set.id}
              set={set}
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
    </div>
  );
}

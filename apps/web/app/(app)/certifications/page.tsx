import Link from "next/link";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { Disclosure } from "@/components/Disclosure";
import { PageTabs } from "@/components/PageTabs";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { CertificationForm } from "@/components/CertificationForm";
import { CertificationRequirements } from "@/components/CertificationRequirements";
import { WorkerCertificationRow } from "@/components/WorkerCertificationRow";
import {
  STANDING_LABELS,
  jobCrewStanding,
  rosterStanding,
  standingChipClass,
  standingTiming,
  summarizeRoster,
  type CertificationKindValue,
} from "@/lib/certifications";
import { viewerToday } from "@/lib/viewerToday";

export const metadata = { title: "Certifications" };

/** Stored at UTC midnight, rendered in UTC — the same rule as every other
 * dated record in this app. Rendering local would show yesterday's date to
 * everyone west of UTC, and on an expiry that is the difference between
 * "expired" and "expires today". */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

const VIEWS = [
  { href: "/certifications", label: "By person" },
  { href: "/certifications?view=job", label: "By job" },
] as const;

export default async function CertificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; view?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company, ...currentUser } = context;
  const { show, view } = await searchParams;
  const showEverything = show === "all";
  // One list, cut two ways (density audit #27): by person is the default,
  // `?view=job` is the same findings per job's crew — it used to be a second
  // list under the first.
  const byJob = view === "job";

  const today = await viewerToday();

  const [workers, certifications, requirementRows, jobs] = await Promise.all([
    prisma.user.findMany({
      where: { companyId: company.id },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.workerCertification.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.certificationRequirement.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.job.findMany({
      where: { companyId: company.id, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, assignments: { select: { userId: true } } },
    }),
  ]);

  const records = certifications.map((row) => ({
    id: row.id,
    holderUserId: row.holderUserId,
    kind: row.kind as CertificationKindValue,
    otherLabel: row.otherLabel,
    issuer: row.issuer,
    referenceNumber: row.referenceNumber,
    issuedOn: isoDate(row.issuedOn),
    expiresOn: isoDate(row.expiresOn),
    notes: row.notes,
    documentUrl: row.documentUrl,
    documentLabel: row.documentLabel,
  }));

  const requirements = requirementRows.map((row) => ({
    id: row.id,
    kind: row.kind as CertificationKindValue,
    otherLabel: row.otherLabel,
    notes: row.notes,
  }));

  const roster = rosterStanding(workers, records, requirements, today);
  const summary = summarizeRoster(roster);
  const shortlist = roster.filter((row) => row.problems.length > 0);
  const crews = jobCrewStanding(
    jobs.map((job) => ({
      id: job.id,
      name: job.name,
      crew: job.assignments.map((assignment) => assignment.userId),
    })),
    roster,
  );

  const workerOptions = workers.map((worker) => ({
    id: worker.id,
    label: worker.name?.trim() || worker.email,
  }));

  const visible = showEverything ? roster : shortlist;

  // NOTHING SET UP = no requirement and no card on file. Every tile below
  // is then zero by construction (`missing` needs a requirement, the other
  // three need a card), and the most useful first move on the page is
  // saying what everyone must carry. So for that company, and only that
  // company, the requirements come FIRST, marked "Start here", and the
  // zero tiles wait until there is something to count. The copy under
  // "people" used to send a new company to "Require OSHA 10 below", which
  // was the last section on the page. A company with anything on file keeps
  // the order and the tiles it had.
  const nothingSetUp = requirements.length === 0 && records.length === 0;

  const requirementsList = (
    <CertificationRequirements requirements={requirements} canRemove={currentUser.role === "OWNER"} />
  );
  const requirementsSection = (startHere: boolean) =>
    startHere ? (
      // Density audit #27: the page's explainer and the START HERE card were
      // two blocks of prose before anything else. One disclosure now, and
      // only while nothing is set up — after that the requirements live at
      // the foot of the page and the explainer has done its job.
      <Disclosure
        id="certifications-required"
        className="mb-6"
        summary={
          <span data-tour="certifications-required" data-start-here="">
            <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-link">Start here</span>
            What everyone here needs — set it first
          </span>
        }
      >
        <p className="mb-3 text-sm text-ink-body">
          A man turned away on Monday morning doesn&apos;t stand there alone: the rest of
          the crew waits, the GC notices, and nobody pays you for the hour. This page answers the
          question before the gate does.
        </p>
        <p className="mb-3 text-sm text-ink-body">
          Everything else on this page is measured against this list. Add the first card everyone
          has to carry, and anyone without it shows up by name below.
        </p>
        {requirementsList}
      </Disclosure>
    ) : (
      <section id="certifications-required" data-tour="certifications-required">
        <h2 className="mb-2 text-sm font-semibold text-ink-label">What everyone here needs</h2>
        {requirementsList}
      </section>
    );

  const tile = (value: number, caption: string, tone: string) => (
    <div className="rounded-xl border border-line-card bg-surface p-4">
      <p className={`text-2xl font-semibold ${value > 0 ? tone : "text-ink"}`}>{value}</p>
      <p className="text-xs text-ink-muted">{caption}</p>
    </div>
  );

  return (
    <PageShell width="working">
      <PageHeader
        route="/certifications"
        subtitle="The cards your crew has to produce at the gate — OSHA 10, scaffold, lift, silica, fit tests."
      />
      {nothingSetUp && requirementsSection(true)}

      <section className="mb-8" data-tour="certifications-record">
        <CertificationForm workers={workerOptions} />
      </section>

      {!nothingSetUp && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4" data-tour="certifications-totals">
          {tile(summary.missing, "Required, nothing on file", "text-tag-rose-ink")}
          {tile(summary.expired, "Expired", "text-tag-rose-ink")}
          {tile(summary.expiring, "Expiring soon", "text-tag-amber-ink")}
          {tile(summary.undated, "No expiry recorded", "text-tag-amber-ink")}
        </div>
      )}

      <PageTabs tabs={VIEWS} label="Certifications views" />

      {!byJob && (
      <section className="mb-10" data-tour="certifications-people">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-label">
            {showEverything
              ? `${roster.length} ${roster.length === 1 ? "person" : "people"}`
              : `${summary.workersWithProblems} of ${summary.workers} ${
                  summary.workers === 1 ? "person" : "people"
                } to sort out`}
          </h2>
          <Link
            href={showEverything ? "/certifications" : "/certifications?show=all"}
            className="inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-rail-hover mouse:min-h-8"
          >
            {showEverything ? "Only what needs acting on" : "Show everyone, including current"}
          </Link>
        </div>

        {workers.length === 0 ? (
          <p className="text-ink-body">
            Nobody is on the team yet, so there is nobody to hold a card.{" "}
            <Link href="/team" className="text-link underline">
              Invite the people you dispatch
            </Link>{" "}
            and they appear here.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-ink-body">
            {requirements.length === 0 ? (
              <>
                Nothing to act on — but nothing is required of everyone yet either, so this page can
                only see cards somebody already entered. Require OSHA 10{" "}
                {nothingSetUp ? "at the top of the page" : "below"} and anyone with no record of one
                will say so by name.
              </>
            ) : (
              <>
                Everyone is current on everything recorded and everything required. Switch to{" "}
                <Link href="/certifications?show=all" className="text-link underline">
                  show everyone
                </Link>{" "}
                to read the file itself.
              </>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface">
            {visible.map((standing) => (
              <WorkerCertificationRow
                key={standing.worker.id}
                standing={standing}
                canDelete={currentUser.role === "OWNER"}
                showEverything={showEverything}
              />
            ))}
          </ul>
        )}
      </section>
      )}

      {byJob && (
      <section className="mb-10" data-tour="certifications-by-job">
        <h2 className="mb-2 text-sm font-semibold text-ink-label">By job</h2>
        <p className="mb-3 text-sm text-ink-body">
          The same finding, cut the way it gets asked: is this job&apos;s crew clear on Monday. Jobs
          with nobody assigned are left out — they have no answer, not a good one.
        </p>
        {crews.length === 0 ? (
          <p className="text-ink-body">
            No contracted or in-progress job has assigned crew with anything outstanding. Crew is
            assigned on a job&apos;s own page; without an assignment this section has nothing to
            read.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface">
            {crews.map((crew) => (
              <li key={crew.job.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/jobs/${crew.job.id}`} className="text-ink underline">
                    {crew.job.name}
                  </Link>
                  <span className="rounded bg-tag-rose px-1.5 py-0.5 text-xs text-tag-rose-ink">
                    {crew.short.length} of {crew.crewSize} not clear
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-1 border-l-2 border-line-card pl-3">
                  {crew.short.map((row) => (
                    <li key={row.worker.id} className="text-xs text-ink-body">
                      <span className="text-ink-label">
                        {row.worker.name?.trim() || row.worker.email}
                      </span>
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-xs ${standingChipClass(row.worst)}`}
                      >
                        {STANDING_LABELS[row.worst]}
                      </span>
                      <span className="ml-2">
                        {row.problems
                          .map((holding) => `${holding.title} — ${standingTiming(holding)}`)
                          .join("; ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {!nothingSetUp && requirementsSection(false)}
    </PageShell>
  );
}

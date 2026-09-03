import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
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

/** Stored at UTC midnight, rendered in UTC — the same rule as every other
 * dated record in this app. Rendering local would show yesterday's date to
 * everyone west of UTC, and on an expiry that is the difference between
 * "expired" and "expires today". */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function CertificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { show } = await searchParams;
  const showEverything = show === "all";

  const today = new Date().toISOString().slice(0, 10);

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

  const tile = (value: number, caption: string, tone: string) => (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className={`text-2xl font-semibold ${value > 0 ? tone : "text-slate-100"}`}>{value}</p>
      <p className="text-xs text-slate-500">{caption}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Certifications</h1>
      <p className="mb-6 text-sm text-slate-400">
        The cards your crew has to be able to produce at the gate — OSHA 10, scaffold, lift, silica,
        fit tests. A man turned away on Monday morning doesn&apos;t stand there alone: the rest of
        the crew waits, the GC notices, and nobody pays you for the hour. This page answers the
        question before the gate does.
      </p>

      <section className="mb-8">
        <CertificationForm workers={workerOptions} />
      </section>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {tile(summary.missing, "Required, nothing on file", "text-red-300")}
        {tile(summary.expired, "Expired", "text-red-300")}
        {tile(summary.expiring, "Expiring soon", "text-amber-300")}
        {tile(summary.undated, "No expiry recorded", "text-amber-300")}
      </div>

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">
            {showEverything
              ? `${roster.length} ${roster.length === 1 ? "person" : "people"}`
              : `${summary.workersWithProblems} of ${summary.workers} ${
                  summary.workers === 1 ? "person" : "people"
                } to sort out`}
          </h2>
          <Link
            href={showEverything ? "/certifications" : "/certifications?show=all"}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
          >
            {showEverything ? "Only what needs acting on" : "Show everyone, including current"}
          </Link>
        </div>

        {workers.length === 0 ? (
          <p className="text-slate-400">
            Nobody is on the team yet, so there is nobody to hold a card.{" "}
            <Link href="/team" className="text-blue-400 underline">
              Invite the people you dispatch
            </Link>{" "}
            and they appear here.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-slate-400">
            {requirements.length === 0 ? (
              <>
                Nothing to act on — but nothing is required of everyone yet either, so this page can
                only see cards somebody already entered. Require OSHA 10 below and anyone with no
                record of one will say so by name.
              </>
            ) : (
              <>
                Everyone is current on everything recorded and everything required. Switch to{" "}
                <Link href="/certifications?show=all" className="text-blue-400 underline">
                  show everyone
                </Link>{" "}
                to read the file itself.
              </>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
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

      <section className="mb-10">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">By job</h2>
        <p className="mb-3 text-sm text-slate-400">
          The same finding, cut the way it gets asked: is this job&apos;s crew clear on Monday. Jobs
          with nobody assigned are left out — they have no answer, not a good one.
        </p>
        {crews.length === 0 ? (
          <p className="text-slate-400">
            No contracted or in-progress job has assigned crew with anything outstanding. Crew is
            assigned on a job&apos;s own page; without an assignment this section has nothing to
            read.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {crews.map((crew) => (
              <li key={crew.job.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/jobs/${crew.job.id}`} className="text-slate-100 underline">
                    {crew.job.name}
                  </Link>
                  <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
                    {crew.short.length} of {crew.crewSize} not clear
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-1 border-l-2 border-slate-700 pl-3">
                  {crew.short.map((row) => (
                    <li key={row.worker.id} className="text-xs text-slate-400">
                      <span className="text-slate-300">
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

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">What everyone here needs</h2>
        <CertificationRequirements
          requirements={requirements}
          canRemove={currentUser.role === "OWNER"}
        />
      </section>
    </div>
  );
}

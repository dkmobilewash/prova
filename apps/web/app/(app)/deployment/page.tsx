import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import {
  type AssignmentData,
  contradictions,
  dayLabel,
  stayLength,
} from "@/components/equipmentDeployment";

export const dynamic = "force-dynamic";

/**
 * Who and what is on which job, right now.
 *
 * `/schedule` answers a different question — when jobs run — and answers it
 * job-first. The question a dispatcher actually asks on a Monday morning is
 * the inverse: where is everybody, and where is the scaffold. Neither could
 * be answered before, because crew and equipment were both stored as bare
 * "is assigned to" pointers with no way to read them from the other end.
 */
export default async function DeploymentPage() {
  const { company } = await requireCompanyContext();

  const [jobs, crew, openAssignments] = await Promise.all([
    prisma.job.findMany({
      where: { companyId: company.id, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        name: true,
        email: true,
        assignments: { select: { job: { select: { id: true, name: true, status: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.equipmentAssignment.findMany({
      where: { companyId: company.id },
      include: {
        equipment: { select: { id: true, name: true, type: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: { sentOutOn: "desc" },
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const allStays: AssignmentData[] = openAssignments.map((a) => ({
    id: a.id,
    equipmentId: a.equipment.id,
    equipmentName: a.equipment.name,
    jobId: a.job.id,
    jobName: a.job.name,
    sentOutOn: a.sentOutOn.toISOString().slice(0, 10),
    returnedOn: a.returnedOn ? a.returnedOn.toISOString().slice(0, 10) : null,
    notes: a.notes,
  }));

  const out = allStays.filter((s) => s.returnedOn === null);

  // Two records putting one machine in two places. Surfaced rather than
  // silently resolved: which entry is wrong is a question about what
  // happened on a site, and this app doesn't know.
  const clashes = contradictions(allStays);

  const activeJobIds = new Set(jobs.map((j) => j.id));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Deployment</h1>
      <p className="mb-6 text-sm text-slate-400">
        Who and what is on which job right now.{" "}
        <Link href="/schedule" className="text-blue-400 hover:text-blue-300">
          The schedule
        </Link>{" "}
        answers when jobs run; this answers where everybody is. Equipment locations come from{" "}
        <Link href="/equipment" className="text-blue-400 hover:text-blue-300">
          assignment history
        </Link>
        , so nothing here is a stored guess.
      </p>

      {clashes.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-700/60 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-200">
            {clashes.length} {clashes.length === 1 ? "record puts" : "records put"} a machine in two
            places at once
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {clashes.map(([a, b]) => (
              <li key={`${a.id}-${b.id}`} className="text-xs text-red-100/80">
                <span className="font-medium">{a.equipmentName}</span> — {a.jobName} from{" "}
                {dayLabel(a.sentOutOn)}, and {b.jobName} from {dayLabel(b.sentOutOn)}. Fix whichever
                is wrong on the equipment page.
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Crew</h2>
        {crew.length === 0 ? (
          <p className="text-slate-400">Nobody on the team yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {crew.map((person) => {
              const on = person.assignments
                .map((a) => a.job)
                .filter((j) => j.status === "CONTRACTED" || j.status === "IN_PROGRESS");
              return (
                <li key={person.id} className="p-4">
                  <p className="font-medium text-slate-100">{person.name ?? person.email}</p>
                  {on.length === 0 ? (
                    <p className="text-sm text-slate-500">Not on an active job</p>
                  ) : (
                    <p className="text-sm text-slate-300">
                      {on.map((j, i) => (
                        <span key={j.id}>
                          {i > 0 && <span className="text-slate-600"> · </span>}
                          <Link href={`/jobs/${j.id}`} className="text-blue-400 hover:text-blue-300">
                            {j.name}
                          </Link>
                        </span>
                      ))}
                      {on.length > 1 && (
                        <span className="ml-2 text-xs text-amber-400">
                          split across {on.length} jobs
                        </span>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">By job</h2>
        {jobs.length === 0 ? (
          <p className="text-slate-400">
            No contracted or in-progress jobs. Deployment only covers work that is actually running
            — an estimate has nobody on it yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {jobs.map((job) => {
              const people = crew.filter((p) =>
                p.assignments.some((a) => a.job.id === job.id),
              );
              const gear = out.filter((s) => s.jobId === job.id);
              return (
                <li
                  key={job.id}
                  className="rounded-lg border border-slate-800 bg-slate-900 p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-slate-100 hover:text-blue-300"
                    >
                      {job.name}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {job.startDate ? dayLabel(job.startDate.toISOString().slice(0, 10)) : "no start date"}
                      {job.endDate ? ` → ${dayLabel(job.endDate.toISOString().slice(0, 10))}` : ""}
                    </span>
                  </div>

                  <p className="mt-2 text-sm">
                    <span className="text-slate-500">Crew: </span>
                    {people.length === 0 ? (
                      <span className="text-slate-500">nobody assigned</span>
                    ) : (
                      <span className="text-slate-300">
                        {people.map((p) => p.name ?? p.email).join(", ")}
                      </span>
                    )}
                  </p>

                  <p className="mt-1 text-sm">
                    <span className="text-slate-500">Equipment: </span>
                    {gear.length === 0 ? (
                      <span className="text-slate-500">none on site</span>
                    ) : (
                      <span className="text-slate-300">
                        {gear.map((g, i) => (
                          <span key={g.id}>
                            {i > 0 && ", "}
                            {g.equipmentName}{" "}
                            <span className="text-slate-500">({stayLength(g, today)})</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {out.some((s) => !activeJobIds.has(s.jobId)) && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Out on a job that isn&apos;t running</h2>
          <p className="mb-2 text-xs text-slate-500">
            These pieces are recorded as out on a job that isn&apos;t contracted or in progress —
            finished, or never started. Usually it means nobody logged the return. Worth chasing
            before somebody drives across town looking for it.
          </p>
          <ul className="divide-y divide-slate-800 rounded-lg border border-amber-800/50 bg-slate-900">
            {out
              .filter((s) => !activeJobIds.has(s.jobId))
              .map((s) => (
                <li key={s.id} className="p-3 text-sm">
                  <span className="text-slate-100">{s.equipmentName}</span>{" "}
                  <span className="text-slate-400">
                    on {s.jobName} · {stayLength(s, today)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

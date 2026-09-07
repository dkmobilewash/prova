import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { SafetyIncidentForm } from "@/components/SafetyIncidentForm";
import { SafetyIncidentRow } from "@/components/SafetyIncidentRow";
import { ToolboxTalkForm } from "@/components/ToolboxTalkForm";
import { ToolboxTalkRow } from "@/components/ToolboxTalkRow";
import { isRecordable } from "@/components/safetyLabels";

/** Dates are stored at UTC midnight and rendered in UTC, same rule as
 * daily field reports. Rendering local would show yesterday's date to
 * everyone west of UTC — a bug that only appears in production. */
function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function SafetyPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company, ...currentUser } = context;
  const { year: yearParam } = await searchParams;

  const today = isoDate(new Date());
  const thisYear = Number(today.slice(0, 4));

  const years = await prisma.safetyIncident.findMany({
    where: { companyId: company.id },
    distinct: ["caseYear"],
    select: { caseYear: true },
    orderBy: { caseYear: "desc" },
  });
  const knownYears = years.map((y) => y.caseYear);
  if (!knownYears.includes(thisYear)) knownYears.unshift(thisYear);

  const parsedYear = Number(yearParam);
  const activeYear = knownYears.includes(parsedYear) ? parsedYear : thisYear;

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const incidents = await prisma.safetyIncident.findMany({
    where: { companyId: company.id, caseYear: activeYear },
    orderBy: { caseNumber: "desc" },
    include: { job: { select: { name: true } }, reportedBy: { select: { name: true } } },
  });

  const talks = await prisma.toolboxTalk.findMany({
    where: { companyId: company.id },
    orderBy: { heldOn: "desc" },
    take: 50,
    include: { job: { select: { name: true } }, recordedBy: { select: { name: true } } },
  });

  const recordableCount = incidents.filter((i) => isRecordable(i.outcome)).length;
  const daysAwayCases = incidents.filter((i) => i.outcome === "DAYS_AWAY").length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Safety</h1>
      <p className="mb-6 text-sm text-slate-400">
        The incident log and the toolbox talk record. These are the two things a GC or an OSHA inspector asks
        for by name, and the two things that usually live in a binder in someone&apos;s truck.
      </p>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SafetyIncidentForm jobs={jobs} today={today} />
          <ToolboxTalkForm jobs={jobs} today={today} />
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">Incident log — {activeYear}</h2>
          <div className="flex flex-wrap gap-2">
            {knownYears.map((y) => (
              <Link
                key={y}
                href={`/safety?year=${y}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  y === activeYear
                    ? "border-blue-500 text-blue-400"
                    : "border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
              >
                {y}
              </Link>
            ))}
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-2xl font-semibold text-slate-100">{incidents.length}</p>
            <p className="text-xs text-slate-500">Cases logged</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-2xl font-semibold text-amber-300">{recordableCount}</p>
            <p className="text-xs text-slate-500">Recordable on the 300 log</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-2xl font-semibold text-slate-100">{daysAwayCases}</p>
            <p className="text-xs text-slate-500">Cases with days away</p>
          </div>
        </div>

        {incidents.length === 0 ? (
          <p className="text-slate-400">
            No cases logged for {activeYear}. That is the good outcome — but log the first aid ones too. A
            first-aid case that later turns into lost time is only defensible if it was written down the day it
            happened.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {incidents.map((incident) => (
              <SafetyIncidentRow
                key={incident.id}
                jobs={jobs}
                canDelete={currentUser.role === "OWNER"}
                incident={{
                  id: incident.id,
                  caseLabel: `${incident.caseYear}-${String(incident.caseNumber).padStart(3, "0")}`,
                  occurredAt: isoDate(incident.occurredAt),
                  jobId: incident.jobId,
                  jobName: incident.job?.name ?? null,
                  employeeName: incident.employeeName,
                  jobTitle: incident.jobTitle,
                  location: incident.location,
                  description: incident.description,
                  classification: incident.classification,
                  outcome: incident.outcome,
                  daysAway: incident.daysAway,
                  daysRestricted: incident.daysRestricted,
                  reportedByName: incident.reportedBy?.name ?? null,
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Toolbox talks</h2>
        {talks.length === 0 ? (
          <p className="text-slate-400">
            Nothing logged yet. Most GC contracts and union agreements require these weekly — the meeting
            happening isn&apos;t the deliverable, the record of it is.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {talks.map((talk) => (
              <ToolboxTalkRow
                key={talk.id}
                canDelete={currentUser.role === "OWNER"}
                talk={{
                  id: talk.id,
                  heldOn: isoDate(talk.heldOn),
                  topic: talk.topic,
                  presenter: talk.presenter,
                  attendees: talk.attendees,
                  notes: talk.notes,
                  jobName: talk.job?.name ?? null,
                  recordedByName: talk.recordedBy?.name ?? null,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

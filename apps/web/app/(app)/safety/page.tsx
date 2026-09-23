import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { SafetyIncidentForm } from "@/components/SafetyIncidentForm";
import { SafetyIncidentRow } from "@/components/SafetyIncidentRow";
import { ToolboxTalkForm } from "@/components/ToolboxTalkForm";
import { ToolboxTalkRow } from "@/components/ToolboxTalkRow";
import { isRecordable } from "@/components/safetyLabels";
import { EmptyState } from "@/components/EmptyState";
import { StatusLine } from "@/components/StatusLine";
import { safetyStatus } from "@/lib/status-sentences";
import { toJobOption } from "@/components/jobLabels";

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
  // Whether this company has EVER logged a case, in any year — read off the
  // query above, no second count. The teaching empty state (with its
  // example) is for a company that has never used the log; a company whose
  // only cases are in earlier years gets the status line for this year and
  // the reminder under it.
  const everLogged = knownYears.length > 0;
  if (!knownYears.includes(thisYear)) knownYears.unshift(thisYear);

  const parsedYear = Number(yearParam);
  const activeYear = knownYears.includes(parsedYear) ? parsedYear : thisYear;

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
  const status = safetyStatus({
    year: activeYear,
    cases: incidents.length,
    recordable: recordableCount,
    daysAway: daysAwayCases,
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Safety</h1>
      <p className="mb-6 text-sm text-ink-body">
        The incident log and the toolbox talk record. These are the two things a GC or an OSHA inspector asks
        for by name, and the two things that usually live in a binder in someone&apos;s truck.
      </p>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SafetyIncidentForm jobs={jobs} today={today} />
          <ToolboxTalkForm jobs={jobs} today={today} />
        </div>
      </section>

      <section className="mb-10" data-tour="safety-incident-log">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-label">Incident log — {activeYear}</h2>
          <div className="flex flex-wrap gap-2" data-tour="safety-years">
            {knownYears.map((y) => (
              <Link
                key={y}
                href={`/safety?year=${y}`}
                // 44px tall — these year chips were 34px and sit right next
                // to each other, which is a mis-tap into the wrong year's log.
                className={`inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
                  y === activeYear
                    ? "border-brand text-link"
                    : "border-line-card text-ink-label hover:bg-neutral-800"
                }`}
              >
                {y}
              </Link>
            ))}
          </div>
        </div>

        {/* ONE "no cases" sentence, never two. The status line and the
            paragraph under it both said "No cases logged for 2026." (#450
            took it out of the paragraph). On a company that has never
            logged a case the EmptyState's title says it, so the status line
            waits; everywhere else the status line owns the sentence and the
            paragraph under it does not repeat it. copyFixes.test.ts pins the
            wording, one-empty-sentence.test.ts counts it in the render. */}
        {(incidents.length > 0 || everLogged) && <StatusLine report={status} />}

        {incidents.length === 0 && !everLogged ? (
          <EmptyState
            data-tour="safety-empty"
            title={`No cases logged for ${activeYear}`}
            purpose={
              <p>
                Every injury on your jobs, first aid included, written down the day it happened —
                who, where, what, and how it turned out. Each case gets its own number for the year,
                and the ones marked recordable are your OSHA 300 log. A first-aid case that later turns
                into lost time is only defensible if it was logged that day.
              </p>
            }
            actions={[
              { label: "Record an incident", opens: "safety-record-incident" },
              { label: "Log a toolbox talk", opens: "safety-log-talk" },
            ]}
            example={{
              rows: [
                { title: "Case 2026-003 — laceration, left hand", tag: "First aid only", detail: "Oak Ave Medical · Level 2 framing", meta: "Sep 14" },
                { title: "Case 2026-002 — strain lifting board", tag: "Recordable", detail: "Lincoln HS gym · 2 days restricted", meta: "Aug 28" },
                { title: "Case 2026-001 — debris in eye", tag: "First aid only", detail: "Oak Ave Medical", meta: "Aug 3" },
              ],
            }}
          />
        ) : incidents.length === 0 ? (
          <p className="text-ink-body">
            {/* The StatusLine directly above already says "No cases logged
                for <year>." — this paragraph used to repeat it word for word. */}
            That is the good outcome — but log the first aid ones too. A
            first-aid case that later turns into lost time is only defensible if it was written down the day it
            happened.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
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

      <section data-tour="safety-talks">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Toolbox talks</h2>
        {talks.length === 0 ? (
          <EmptyState
            data-tour="safety-talks-empty"
            title="No toolbox talks logged yet"
            walkthrough={false}
            purpose={
              <p>
                The record of each safety meeting — the date, the topic, who gave it and who was
                there. Most GC contracts and union agreements require one a week, and the meeting
                happening is not the deliverable; the record of it is.
              </p>
            }
            actions={[{ label: "Log a toolbox talk", opens: "safety-log-talk" }]}
            example={{
              rows: [
                { title: "Ladder safety — three points of contact", detail: "Oak Ave Medical · given by the foreman", meta: "Sep 15 · 9 there" },
                { title: "Silica dust when cutting board", detail: "Lincoln HS gym", meta: "Sep 8 · 7 there" },
              ],
            }}
          />
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
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

import Link from "next/link";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PunchListForm } from "@/components/PunchListForm";
import { EmptyState } from "@/components/EmptyState";
import { PunchListRow } from "@/components/PunchListRow";
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";
import { can } from "@/lib/permissions";
import type { PunchListPeople } from "@/components/PunchItemFields";

export default async function PunchListsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter, show } = await searchParams;
  const showDone = show === "all";

  // No ?draft= here any more: the Ask box's punch command is DIRECT and
  // writes every item itself (lib/ask/commands/punchLists.ts), so there is
  // no card left for this page to open a prefilled form from.

  // The GC's name, for the pickers: issue #65 — seven jobs sharing one
  // placeholder name made every picker seven identical rows.
  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: { contact: { select: { name: true } } },
  });
  const jobOptions = jobs.map(toJobOption);
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const items = await prisma.punchListItem.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      // "Completed" means VERIFIED here, not "the crew says so": an item
      // waiting on a sign-off is exactly what this page is for, and hiding
      // it behind "show completed" would bury the state the split added.
      ...(showDone ? {} : { status: { not: "VERIFIED" } }),
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      job: true,
      raisedBy: true,
      assignedUser: { select: { name: true } },
      assignedCrewMember: { select: { legalFirstName: true, legalLastName: true } },
      readyByUser: { select: { name: true } },
      verifiedByUser: { select: { name: true } },
      // The photo prompt's input. A count, not the photos: this page never
      // renders them, and Gap 3's capture is what attaches one.
      _count: { select: { media: true } },
    },
  });

  // Who an item can be handed to, and what it can be evidence for. Crew
  // first in the picker because they are who actually fixes these.
  const [teamUsers, crew, backcharges] = await Promise.all([
    prisma.user.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.crewMember.findMany({
      where: { companyId: company.id, archivedAt: null },
      orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
      select: { id: true, legalFirstName: true, legalLastName: true },
    }),
    // Scoped to the filtered job when there is one. With no job filter the
    // picker would otherwise offer deductions from every job at once, and
    // the action refuses a backcharge from a different job anyway.
    activeJob
      ? prisma.backcharge.findMany({
          where: { companyId: company.id, jobId: activeJob },
          orderBy: { number: "desc" },
          select: { id: true, number: true, description: true },
        })
      : Promise.resolve([]),
  ]);

  const people: PunchListPeople = {
    users: teamUsers.map((u) => ({ id: u.id, name: u.name ?? u.email })),
    crew: crew.map((c) => ({ id: c.id, name: `${c.legalFirstName} ${c.legalLastName}` })),
    backcharges: backcharges.map((b) => ({
      id: b.id,
      label: `#${b.number} — ${b.description.slice(0, 60)}`,
    })),
  };

  // Computed once on the server: "overdue" derived per row in the browser
  // would answer in the reader's timezone, and every date here is UTC.
  const today = new Date();
  const canVerify = can(context, "VERIFY_PUNCH_ITEMS");

  const openCount = await prisma.punchListItem.count({
    where: { companyId: company.id, status: "OPEN", ...(activeJob ? { jobId: activeJob } : {}) },
  });

  /** Waiting on somebody to agree. The number this feature exists to make
   * visible — before the split it was inside "done" and nobody could see
   * how much of the list nobody had checked. */
  const awaitingCount = await prisma.punchListItem.count({
    where: { companyId: company.id, status: "READY_FOR_REVIEW", ...(activeJob ? { jobId: activeJob } : {}) },
  });

  // Whether this company has EVER had a punch item, not whether the current
  // filter shows any — the teaching empty state is for the first.
  const everLogged = await prisma.punchListItem.count({ where: { companyId: company.id } });

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showDone ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/punch-lists?${qs}` : "/punch-lists";
  };

  // 44px tall. This is the job filter — the first thing someone on site taps
  // to get to their own job — and at 34px it was among the smallest targets
  // on the page.
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  return (
    // The archetypal `split`: a thing, and the thing it feeds. "Add an item"
    // and the job filter both exist to change what the list below them says,
    // and they sat ON TOP of it — the form's own height decided how much of
    // the list you could see, so on a job with a full walkthrough list you
    // scrolled past the form every time to reach the thing you came for.
    // Beside it, the form stays put and the list starts at the top of the
    // page. Below `lg` this stacks back to exactly the order it had.
    <PageShell
      width="split"
      asideLabel="Add an item and filter by job"
      header={
        <>
          <h1 className="mb-2 text-xl font-semibold text-ink">Punch lists</h1>
          <p className="mb-6 text-sm text-ink-body">
            What still has to be fixed before a job closes out. Jobs currently go straight from
            in-progress to complete with nothing tracking the walkthrough, so this is the list that
            used to live on someone&apos;s memory.
          </p>
        </>
      }
      aside={
        <>
          <section
            className="mb-4 rounded-lg border border-line-card bg-surface p-4"
            data-tour="punch-add"
          >
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Add an item</h2>
            <PunchListForm jobs={jobOptions} defaultJobId={activeJob ?? undefined} people={people} />
          </section>

          {jobOptions.length > 0 && (
            <div className="flex flex-wrap gap-2" data-tour="punch-job-filter">
              <Link href={filterHref({ job: null })} className={chip(!activeJob)}>
                All jobs
              </Link>
              {jobOptions.map((j) => (
                <Link key={j.id} href={filterHref({ job: j.id })} className={chip(activeJob === j.id)}>
                  {jobPickerLabel(j)}
                </Link>
              ))}
            </div>
          )}
        </>
      }
    >
      <section data-tour="punch-open">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-label">
            {openCount} open{awaitingCount > 0 ? `, ${awaitingCount} waiting to be verified` : ""}
            {activeJob ? " on this job" : ""}
          </h2>
          <Link
            href={filterHref({ show: showDone ? null : "all" })}
            className="inline-flex min-h-11 items-center text-sm text-link"
          >
            {showDone ? "Hide verified" : "Show verified"}
          </Link>
        </div>

        {items.length === 0 && everLogged === 0 ? (
          <EmptyState
            data-tour="punch-empty"
            title="No punch items yet"
            purpose={
              <p>
                The last-few-things list before a job is done — touch-up paint, a sticking door, a
                missing outlet cover — found on the walkthrough with the GC&apos;s super. Tick
                each one off as it is fixed, and the job is finished when the list is empty.
              </p>
            }
            actions={
              jobOptions.length === 0
                ? [{ label: "Create a job", href: "/jobs/new" }]
                : [{ label: "Add an item", opens: "punch-add" }]
            }
            ask={
              jobOptions.length === 0
                ? undefined
                : `Add to the punch list on ${jobOptions[0].name}: touch up paint in the hall, adjust the pantry door`
            }
            example={{
              rows: [
                { title: "Touch up paint behind the fridge", detail: "Smith kitchen remodel · raised by Mike", meta: "open" },
                { title: "Pantry door rubs at the top", detail: "Smith kitchen remodel · raised by the GC's super", meta: "open" },
                { title: "Outlet cover missing by the island", detail: "Smith kitchen remodel", meta: "verified Sep 12" },
              ],
            }}
          />
        ) : items.length === 0 ? (
          <p className="text-ink-body">
            {showDone || openCount > 0 ? (
              // "Nothing here." was the barest string in the app — two
              // words, no way out, on a list that is empty only because a
              // filter is on. The filter chips are above the fold, but a
              // reader who does not connect the empty list to the chip he
              // tapped is stuck looking at a page that appears broken. Both
              // escapes are named, and only when they apply.
              <>
                Nothing to show{activeJob ? " on this job" : ""} with the filters you have on.
                {activeJob && (
                  <>
                    {" "}
                    <Link href={filterHref({ job: null })} className="text-link hover:underline">
                      Show every job
                    </Link>
                    .
                  </>
                )}
                {!showDone && (
                  <>
                    {" "}
                    <Link href={filterHref({ show: "all" })} className="text-link hover:underline">
                      Show verified items
                    </Link>
                    .
                  </>
                )}
              </>
            ) : (
              "Nothing open. Add what you find on the walkthrough — grid out of level, missing corner bead, touch-up paint."
            )}
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {items.map((item) => (
              <PunchListRow
                key={item.id}
                canDelete={currentUser.role === "OWNER"}
                jobs={jobOptions}
                showJob={!activeJob}
                canVerify={canVerify}
                people={people}
                today={today}
                item={{
                  id: item.id,
                  description: item.description,
                  jobId: item.jobId,
                  jobName: item.job.name,
                  status: item.status,
                  area: item.area,
                  dueOn: item.dueOn,
                  assignedUserId: item.assignedUserId,
                  assignedCrewMemberId: item.assignedCrewMemberId,
                  assignedName: item.assignedName,
                  assignedUserName: item.assignedUser?.name ?? null,
                  assignedCrewMemberName: item.assignedCrewMember
                    ? `${item.assignedCrewMember.legalFirstName} ${item.assignedCrewMember.legalLastName}`
                    : null,
                  causedByOthers: item.causedByOthers,
                  responsibleParty: item.responsibleParty,
                  backchargeId: item.backchargeId,
                  raisedByName: item.raisedBy?.name ?? null,
                  readyByName: item.readyByUser?.name ?? null,
                  verifiedByName: item.verifiedByUser?.name ?? null,
                  reopenReason: item.reopenReason,
                  photoCount: item._count.media,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

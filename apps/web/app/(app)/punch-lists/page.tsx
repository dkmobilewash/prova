import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PunchListForm } from "@/components/PunchListForm";
import { EmptyState } from "@/components/EmptyState";
import { PunchListRow } from "@/components/PunchListRow";
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";

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
      ...(showDone ? {} : { isDone: false }),
    },
    orderBy: [{ isDone: "asc" }, { createdAt: "asc" }],
    include: { job: true, raisedBy: true },
  });

  const openCount = await prisma.punchListItem.count({
    where: { companyId: company.id, isDone: false, ...(activeJob ? { jobId: activeJob } : {}) },
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
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Punch lists</h1>
      <p className="mb-6 text-sm text-ink-body">
        What still has to be fixed before a job closes out. Jobs currently go straight from in-progress to
        complete with nothing tracking the walkthrough, so this is the list that used to live on someone&apos;s
        memory.
      </p>

      <section className="mb-8 rounded-lg border border-line-card bg-surface p-4" data-tour="punch-add">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Add an item</h2>
        <PunchListForm jobs={jobOptions} defaultJobId={activeJob ?? undefined} />
      </section>

      {jobOptions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-tour="punch-job-filter">
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

      <section data-tour="punch-open">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-label">
            {openCount} open{activeJob ? " on this job" : ""}
          </h2>
          <Link
            href={filterHref({ show: showDone ? null : "all" })}
            className="inline-flex min-h-11 items-center text-sm text-link"
          >
            {showDone ? "Hide completed" : "Show completed"}
          </Link>
        </div>

        {items.length === 0 && everLogged === 0 ? (
          <EmptyState
            data-tour="punch-empty"
            title="No punch items yet"
            purpose={
              <p>
                The last-few-things list before a job is done — touch-up paint, a sticking door, a
                missing outlet cover — found on the walkthrough with the homeowner or builder. Tick
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
                { title: "Pantry door rubs at the top", detail: "Smith kitchen remodel · raised by the homeowner", meta: "open" },
                { title: "Outlet cover missing by the island", detail: "Smith kitchen remodel", meta: "done Sep 12" },
              ],
            }}
          />
        ) : items.length === 0 ? (
          <p className="text-ink-body">
            {showDone || openCount > 0
              ? "Nothing here."
              : "Nothing open. Add what you find on the walkthrough — grid out of level, missing corner bead, touch-up paint."}
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {items.map((item) => (
              <PunchListRow
                key={item.id}
                canDelete={currentUser.role === "OWNER"}
                jobs={jobOptions}
                showJob={!activeJob}
                item={{
                  id: item.id,
                  description: item.description,
                  jobId: item.jobId,
                  jobName: item.job.name,
                  isDone: item.isDone,
                  raisedByName: item.raisedBy?.name ?? null,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PunchListForm } from "@/components/PunchListForm";
import { PunchListRow } from "@/components/PunchListRow";

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

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
  });
  const jobOptions = jobs.map((j) => ({ id: j.id, name: j.name }));
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

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showDone ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/punch-lists?${qs}` : "/punch-lists";
  };

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Punch lists</h1>
      <p className="mb-6 text-sm text-slate-400">
        What still has to be fixed before a job closes out. Jobs currently go straight from in-progress to
        complete with nothing tracking the walkthrough, so this is the list that used to live on someone&apos;s
        memory.
      </p>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Add an item</h2>
        <PunchListForm jobs={jobOptions} defaultJobId={activeJob ?? undefined} />
      </section>

      {jobOptions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href={filterHref({ job: null })} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobOptions.map((j) => (
            <Link key={j.id} href={filterHref({ job: j.id })} className={chip(activeJob === j.id)}>
              {j.name}
            </Link>
          ))}
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300">
            {openCount} open{activeJob ? " on this job" : ""}
          </h2>
          <Link href={filterHref({ show: showDone ? null : "all" })} className="text-sm text-blue-400">
            {showDone ? "Hide completed" : "Show completed"}
          </Link>
        </div>

        {items.length === 0 ? (
          <p className="text-slate-400">
            {showDone || openCount > 0
              ? "Nothing here."
              : "Nothing open. Add what you find on the walkthrough — grid out of level, missing corner bead, touch-up paint."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
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

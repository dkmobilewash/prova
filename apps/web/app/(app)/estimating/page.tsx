import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { money } from "@/lib/money";

/**
 * Everything still being priced, in one place.
 *
 * Estimating has no UI of its own — it lives inside a job, and only while
 * that job's status is ESTIMATE, which makes it close to invisible from the
 * sidebar. This page is the missing entry point. It deliberately does more
 * than filter the jobs list to ESTIMATE: for each one it works out the next
 * thing that has to happen, because "which of my estimates is stuck, and on
 * what" is the actual question, and nothing in the app answered it.
 *
 * The stage is derived on render from line items and signature requests —
 * the same rule the rest of the app follows. A stored "estimate stage" field
 * would be a second source of truth that disagrees with the job the moment
 * someone adds a line item.
 */

type Stage = {
  label: string;
  detail: string;
  tone: "empty" | "ready" | "waiting" | "go";
};

const TONE: Record<Stage["tone"], string> = {
  empty: "border-slate-700 bg-slate-800 text-slate-400",
  ready: "border-blue-700 bg-blue-950 text-blue-300",
  waiting: "border-amber-700 bg-amber-950 text-amber-300",
  go: "border-emerald-700 bg-emerald-950 text-emerald-300",
};

function stageFor(lineItemCount: number, signatureStatuses: string[]): Stage {
  if (lineItemCount === 0) {
    return {
      label: "Needs pricing",
      detail: "No line items yet — price it up, or draft them from the scope text.",
      tone: "empty",
    };
  }
  if (signatureStatuses.includes("SIGNED")) {
    return {
      label: "Signed",
      detail: "The client has signed. Mark it contracted to lock the estimate in.",
      tone: "go",
    };
  }
  if (signatureStatuses.includes("PENDING")) {
    return {
      label: "Out for signature",
      detail: "Waiting on the client. Nothing to do here until they sign.",
      tone: "waiting",
    };
  }
  return {
    label: "Ready to send",
    detail: "Priced, but no signature request yet — send it to the client.",
    tone: "ready",
  };
}

export default async function EstimatingPage() {
  const { company } = await requireCompanyContext();

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id, status: "ESTIMATE" },
    orderBy: { createdAt: "desc" },
    include: {
      contact: true,
      lineItems: { where: { isDeleted: false } },
      signatureRequests: { select: { status: true } },
      estimateVersions: { select: { id: true } },
    },
  });

  const totalPipeline = jobs.reduce(
    (sum, job) =>
      sum +
      job.lineItems.reduce(
        (lineSum, item) => lineSum + Number(item.quantity) * Number(item.unitPrice ?? 0),
        0,
      ),
    0,
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-1 text-xl font-semibold text-slate-100">Estimating</h1>
      <p className="mb-6 text-sm text-slate-400">
        Jobs still being priced. A job leaves this list the moment it&apos;s contracted — after that
        its scope changes through change orders instead.
      </p>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/jobs/new"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          New job
        </Link>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/catalog" className="text-blue-400 hover:text-blue-300 hover:underline">
            Line item catalog
          </Link>
          <Link href="/bids" className="text-blue-400 hover:text-blue-300 hover:underline">
            Bid history
          </Link>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-slate-300">Nothing is being estimated right now.</p>
          <p className="mt-1 text-sm text-slate-400">
            Every job is either contracted or finished. Start a{" "}
            <Link href="/jobs/new" className="text-blue-400 hover:underline">
              new job
            </Link>{" "}
            to begin an estimate.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-400">
            {jobs.length} {jobs.length === 1 ? "estimate" : "estimates"} · {money(totalPipeline)} priced
            and unsigned
          </p>
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {jobs.map((job) => {
              const total = job.lineItems.reduce(
                (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice ?? 0),
                0,
              );
              const stage = stageFor(
                job.lineItems.length,
                job.signatureRequests.map((request) => request.status),
              );
              return (
                <li key={job.id} className="p-4">
                  <Link href={`/jobs/${job.id}`} className="block">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-100">{job.name}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE[stage.tone]}`}>
                          {stage.label}
                        </span>
                      </div>
                      <p className="text-sm font-medium tabular-nums text-slate-100">{money(total)}</p>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-400">{job.contact.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {stage.detail}
                      {job.lineItems.length > 0 &&
                        ` · ${job.lineItems.length} line ${job.lineItems.length === 1 ? "item" : "items"}`}
                      {job.estimateVersions.length > 0 &&
                        ` · ${job.estimateVersions.length} saved ${
                          job.estimateVersions.length === 1 ? "version" : "versions"
                        }`}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

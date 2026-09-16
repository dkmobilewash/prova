import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@prova/ui";
import { prisma } from "@prova/db";
import { money } from "@/lib/money";
import { countSharedJobMediaByJob } from "@/lib/job-media-query";
import { isPortalAccessRevoked } from "@/lib/access-tokens";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const contact = await prisma.contact.findUnique({
    where: { portalToken: token },
    include: {
      company: true,
      jobs: {
        orderBy: { createdAt: "desc" },
        include: { lineItems: { where: { isDeleted: false } } },
      },
    },
  });

  // Issue #106 finding 2: same revoked/INACTIVE check as
  // /portal/[token]/jobs/[jobId] — see that page's comment for why this
  // 404s rather than showing a different error for "revoked" than for
  // "never existed".
  if (!contact || isPortalAccessRevoked(contact)) {
    notFound();
  }

  /* A PHOTO COUNT PER JOB, and the argument for it is that without one the
     gallery is invisible. Photos live one click in, inside a job, and
     nothing on this page would suggest there is anything new to look at —
     so a sub who carefully shared eight photos of the west wall has
     published them to a page the GC has no reason to open. A count is the
     smallest thing that fixes that.

     It leaks nothing the job page would not: the number counts exactly the
     rows `loadSharedJobMediaForClient` would return for a job this contact
     already owns, and the jobs are `contact.jobs`, so nothing outside their
     own list is even asked about.

     ONE `groupBy` FOR THE WHOLE LIST rather than a count inside the map
     below — that would be one query per job, the N+1 that the tag include
     in `loadJobMedia` carries its own warning about. A job with nothing
     shared is simply absent from the map, which is why the render below
     tests for a number rather than for a zero. */
  const sharedPhotoCounts = await countSharedJobMediaByJob(contact.jobs.map((job) => job.id));

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm font-medium text-ink-muted">{contact.company.name}</p>
      <h1 className="mb-6 text-xl font-semibold text-ink">Hi, {contact.name}</h1>

      {contact.jobs.length === 0 ? (
        <p className="text-ink-body">No jobs yet.</p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {contact.jobs.map((job) => {
            const total = job.lineItems.reduce(
              (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
              0,
            );
            const photoCount = sharedPhotoCounts.get(job.id) ?? 0;
            return (
              <li key={job.id} className="p-4">
                <Link
                  href={`/portal/${token}/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink">{job.name}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-sm font-medium text-ink">{money(total)}</p>
                </Link>
                {/* Only when there is something to open. A "0 photos" line
                    on every job would be noise on most of them and, on a job
                    where the sub simply has not shared any yet, reads as a
                    complaint. ink-body rather than ink-muted on this ground
                    (#89). */}
                {photoCount > 0 && (
                  <p className="mt-1 text-sm text-ink-body">
                    {photoCount} {photoCount === 1 ? "photo" : "photos"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

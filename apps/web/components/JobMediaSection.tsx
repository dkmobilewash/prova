import Link from "next/link";
import { JobMediaCapture } from "@/components/JobMediaCapture";
import { JobMediaCard, type JobMediaCardData } from "@/components/JobMediaCard";

/**
 * The site-photo section on a job page.
 *
 * A server component holding two client ones, so the job page's own diff
 * stays a single element — that file is 2000+ lines with three unmarked
 * fixed section slots (CLAUDE.md), and the less of it this feature touches
 * the better.
 *
 * Capped at a dozen with a link to the full gallery rather than rendering
 * every photo a job has ever collected: this sits below everything else on
 * an already long page, and a year of site capture is hundreds of images.
 * The count is honest about what is being withheld.
 */
export function JobMediaSection({
  jobId,
  media,
  total,
  limit = 12,
}: {
  jobId: string;
  media: JobMediaCardData[];
  total: number;
  limit?: number;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold text-slate-100">Site photos</h2>
      <p className="mb-4 text-sm text-slate-400">
        What this job actually looked like, on the day.
      </p>

      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <JobMediaCapture jobId={jobId} />
      </div>

      {media.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-slate-300">No photos on this job yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            Existing conditions before you start is the one people wish they had.
          </p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {media.map((item) => (
              <JobMediaCard key={item.id} media={item} />
            ))}
          </ul>
          {total > limit && (
            <p className="mt-3 text-sm text-slate-400">
              Showing the {limit} most recent of {total}.{" "}
              <Link href={`/photos?job=${jobId}`} className="text-blue-400 hover:text-blue-300">
                See all photos on this job
              </Link>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

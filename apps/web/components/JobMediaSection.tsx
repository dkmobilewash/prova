import Link from "next/link";
import { JobMediaCapture } from "@/components/JobMediaCapture";
import type { JobMediaCardData } from "@/components/JobMediaCard";
import { JobMediaGallery } from "@/components/JobMediaGallery";
import { JobMediaTagDatalist } from "@/components/JobMediaTagDatalist";
import { photoReportHref } from "@/lib/photo-report";

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
  tagNames,
  limit = 12,
}: {
  jobId: string;
  media: JobMediaCardData[];
  total: number;
  /** Every tag name this company already uses, for the cards' autocomplete.
   *  Threaded down from the page because the datalist is rendered ONCE for
   *  the whole section rather than once per card — see JobMediaTagDatalist
   *  for why, and for what breaks quietly if a gallery forgets it. */
  tagNames: string[];
  limit?: number;
}) {
  return (
    <section className="mb-10" data-tour="job-photos">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Site photos</h2>
        {/* THE ONLY ENTRY POINT TO THE REPORT FROM A JOB, and it is here
            rather than in the nav on purpose: the report is one job's
            document, so it hangs off the job the way wh-347 hangs off
            certified payroll. Shown even when the gallery is empty —
            the report's own page explains what is and is not in a
            selection, which is more useful than a link that vanishes. */}
        <Link
          href={photoReportHref(jobId)}
          className="text-sm text-link hover:text-link-hover"
        >
          Photo report →
        </Link>
      </div>
      <p className="mb-4 text-sm text-ink-body">
        What this job actually looked like, on the day.
      </p>

      <JobMediaTagDatalist names={tagNames} />

      <div className="mb-4 rounded-lg border border-line-card bg-surface p-4">
        <JobMediaCapture jobId={jobId} />
      </div>

      {media.length === 0 ? (
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <p className="text-sm text-ink-label">No photos on this job yet.</p>
          <p className="mt-1 text-sm text-ink-body">
            Existing conditions before you start is the one people wish they had.
          </p>
        </div>
      ) : (
        <>
          <JobMediaGallery media={media} />
          {total > limit && (
            <p className="mt-3 text-sm text-ink-body">
              Showing the {limit} most recent of {total}.{" "}
              <Link href={`/photos?job=${jobId}`} className="text-link hover:text-link-hover">
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

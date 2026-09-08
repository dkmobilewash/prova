import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { viewerTimeZone } from "@/lib/viewerToday";
import { countJobMedia, loadJobMedia, loadJobMediaTags } from "@/lib/job-media-query";
import { photosFilterHref } from "@/lib/job-media-tags";
import { NoAccess } from "@/components/NoAccess";
import { JobMediaCapture } from "@/components/JobMediaCapture";
import { JobMediaCard } from "@/components/JobMediaCard";
import { JobMediaTagDatalist } from "@/components/JobMediaTagDatalist";
import { JobMediaTagManager } from "@/components/JobMediaTagManager";

/**
 * Every site photo the company has, newest first, filterable by job and by
 * tag.
 *
 * The company-wide read. The per-job view lives on `/jobs/[id]` and both
 * render the same card from `loadJobMedia`, so they cannot drift.
 *
 * MANAGE_FIELD, matching `/punch-lists`, `/field-reports`, `/safety` and
 * `/equipment` — the capability the crew on site holds, which is the whole
 * point of a feature used from a phone in a stairwell.
 *
 * CAPPED, and it was not. This read every photo the company had ever taken
 * — no `take`, one row per image, every one of them projected and rendered
 * as a card. A year of site capture on a few jobs is thousands of images
 * and a page that a phone on LTE never finishes. The cap is generous
 * rather than tight (a filter chip per job is the way to a specific job,
 * and 60 is five screens of a three-across grid), and the count beneath it
 * is honest about what is being withheld — the same shape and the same
 * wording as the job page's own section, which already did this.
 *
 * THE TWO FILTERS COMPOSE. Job AND tag, never one replacing the other:
 * "the west wall on the Riverside job" is the question this page exists to
 * answer, and it is not answerable by either chip alone. Every href on the
 * page is built by `photosFilterHref`, which is pure and tested — a chip
 * that quietly drops the other filter shows MORE photos than were asked
 * for while looking entirely healthy, which is the kind of wrong nobody
 * notices.
 */

/** Five screens of the three-across grid. Larger than the job page's dozen
 * because this is the gallery you come to when you want to scroll, and the
 * job page's section is a summary with a link to here. */
const PHOTO_LIMIT = 60;

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; tag?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company } = context;
  const { job: jobFilter, tag: tagFilter } = await searchParams;

  const [jobs, tags] = await Promise.all([
    prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    loadJobMediaTags(company.id),
  ]);
  // Both filters are validated against what this company actually has, so
  // an id from a stale link or another company's URL falls back to "no
  // filter" rather than producing an empty gallery with a live chip
  // nothing on the page can explain.
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;
  const activeTag = tagFilter && tags.some((t) => t.id === tagFilter) ? tagFilter : null;

  const timeZone = await viewerTimeZone();
  const [media, total] = await Promise.all([
    loadJobMedia(
      {
        companyId: company.id,
        ...(activeJob ? { jobId: activeJob } : {}),
        ...(activeTag ? { tagId: activeTag } : {}),
        withJobName: true,
        take: PHOTO_LIMIT,
      },
      timeZone,
    ),
    // Counted rather than measured off `media.length`, which is the cap
    // once there are more than the cap — the number the line withholds is
    // exactly the number it could not get from the list. Same filter as
    // the list above, through the same builder.
    countJobMedia({
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      ...(activeTag ? { tagId: activeTag } : {}),
    }),
  ]);

  // 44px, same as the punch-list filter: this is the first thing somebody
  // on site taps to get to their own job.
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  // A tag with no photos on it is a dead chip: tapping it empties the
  // gallery and there is nothing on the page to say why. They stay in
  // "Manage tags", where a zero is the useful signal that the word can go.
  // The active one is kept whatever its count, so the chip you are standing
  // on never vanishes underneath you.
  const filterableTags = tags.filter((tag) => tag.photoCount > 0 || tag.id === activeTag);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-slate-100">Site photos</h1>
      <p className="mb-6 text-sm text-slate-400">
        What the job actually looked like, on the day. Photos are filed against a job, tagged in
        this company&apos;s own words, and stay in Prova rather than on somebody&apos;s phone.
      </p>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-300">
            There are no jobs yet, and a photo is always filed against one.
          </p>
          <Link
            href="/jobs/new"
            className="mt-3 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500"
          >
            Create a job
          </Link>
        </div>
      ) : (
        <>
          {/* Rendered once for the whole page: every card's tag input points
              its `list` attribute at this one element. */}
          <JobMediaTagDatalist names={tags.map((tag) => tag.name)} />

          <div className="mb-3 flex flex-wrap gap-2">
            <Link href={photosFilterHref({ tag: activeTag })} className={chip(!activeJob)}>
              All jobs
            </Link>
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={photosFilterHref({ job: job.id, tag: activeTag })}
                className={chip(activeJob === job.id)}
              >
                {job.name}
              </Link>
            ))}
          </div>

          {/* The tag row, beneath the job row rather than beside it. Each
              tag chip keeps whatever job is chosen and each job chip keeps
              whatever tag is chosen, so the two narrow together. */}
          {filterableTags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Link href={photosFilterHref({ job: activeJob })} className={chip(!activeTag)}>
                All tags
              </Link>
              {filterableTags.map((tag) => (
                <Link
                  key={tag.id}
                  href={photosFilterHref({ job: activeJob, tag: tag.id })}
                  className={chip(activeTag === tag.id)}
                >
                  {tag.name}{" "}
                  {/* The count is computed on every read, never stored —
                      see loadJobMediaTags. It counts the tag's photos
                      company-wide, not within the chosen job, because it is
                      describing the TAG rather than the current filter. */}
                  <span className="ml-1 text-slate-400">{tag.photoCount}</span>
                </Link>
              ))}
            </div>
          )}

          <JobMediaTagManager tags={tags} />

          {/* Uploading needs a job, so the form only appears once one is
              chosen. On the job page it is always there, because the job is
              the page. */}
          {activeJob ? (
            <div className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <JobMediaCapture jobId={activeJob} />
            </div>
          ) : (
            <p className="mb-8 text-sm text-slate-400">
              Pick a job above to add photos, or open the job itself.
            </p>
          )}

          {media.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm text-slate-300">
                {activeTag && activeJob
                  ? "No photos on this job carry that tag."
                  : activeTag
                    ? "No photos carry that tag."
                    : activeJob
                      ? "No photos on this job yet."
                      : "No photos yet."}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {activeTag ? (
                  <Link
                    href={photosFilterHref({ job: activeJob })}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Clear the tag filter
                  </Link>
                ) : activeJob ? (
                  "Add the first one above — a photo of the existing conditions before you start is the one people wish they had."
                ) : (
                  "Pick a job above and add the first one."
                )}
              </p>
            </div>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {media.map((item) => (
                  <JobMediaCard key={item.id} media={item} />
                ))}
              </ul>
              {total > PHOTO_LIMIT && (
                <p className="mt-3 text-sm text-slate-400">
                  Showing the {PHOTO_LIMIT} most recent of {total}.{" "}
                  {activeJob || activeTag
                    ? "Older photos matching this filter are not on this page yet."
                    : "Pick a job or a tag above to narrow this down."}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

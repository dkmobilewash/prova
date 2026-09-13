import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { viewerTimeZone } from "@/lib/viewerToday";
import { countJobMedia, loadJobMedia, loadJobMediaTags } from "@/lib/job-media-query";
import { parseLocatedFilter, parseSharedFilter, photosFilterHref } from "@/lib/job-media-tags";
import { photoReportHref, selectionFromSharedFilter } from "@/lib/photo-report";
import { NoAccess } from "@/components/NoAccess";
import { JobMediaCapture } from "@/components/JobMediaCapture";
import { JobMediaCard } from "@/components/JobMediaCard";
import { JobMediaTagDatalist } from "@/components/JobMediaTagDatalist";
import { JobMediaTagManager } from "@/components/JobMediaTagManager";

/**
 * Every site photo the company has, newest first, filterable by job, by
 * tag, and by whether the client can see it.
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
 * THE FOUR FILTERS COMPOSE. Job AND tag AND client visibility AND whether
 * the capture knows where it was taken, never one replacing another: "the
 * west wall on the Riverside job" is the question this page exists to
 * answer, and it is not answerable by either chip alone. Every href on the
 * page is built by `photosFilterHref`, which is pure and tested — a chip
 * that quietly drops another filter shows MORE photos than were asked for
 * while looking entirely healthy, which is the kind of wrong nobody notices.
 *
 * THE LOCATION FILTER IS WHERE "WHERE WAS THIS TAKEN" GETS ANSWERED WITHOUT
 * LEAVING THE GALLERY. Each card carries its own coordinate and a link out
 * to a map; this pair of chips is what makes the gallery ITSELF answer the
 * question — "Has a location" is every capture that recorded a position, in
 * capture order, each with its own fix, which is a walk of the job. "No
 * location" is its honest other half rather than an error list: everything
 * from before this shipped, every desktop upload, every photo filed more
 * than an hour after it was taken, and everybody who tapped "Don't allow".
 * A crew wondering why a photo has no pin looks there and finds it
 * alongside all the others in the same position, which is the answer.
 *
 * THE CLIENT-VISIBILITY FILTER IS THE SUB'S MIRROR OF THE PORTAL. A photo
 * is shown to the GC one at a time, from a card, by whoever was looking at
 * that card — which is the right way to decide it and a terrible way to
 * REVIEW it, because the decisions end up scattered across weeks and
 * across people. The safeguard the sharing feature rests on is that a sub
 * can see what the GC can see, and this is where they see it: pick the job
 * chip, pick "Shared with client", and the page is exactly the portal
 * gallery for that GC. "Not shared" is the same query inverted, for
 * checking that nothing was published by accident.
 */

/** Five screens of the three-across grid. Larger than the job page's dozen
 * because this is the gallery you come to when you want to scroll, and the
 * job page's section is a summary with a link to here. */
const PHOTO_LIMIT = 60;

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; tag?: string; shared?: string; located?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company } = context;
  const {
    job: jobFilter,
    tag: tagFilter,
    shared: sharedFilter,
    located: locatedFilter,
  } = await searchParams;

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
  // Validated the same way, against the only two values that mean anything
  // — see `parseSharedFilter`. An unrecognised `?shared=` is no filter, not
  // half of one.
  const activeShared = parseSharedFilter(sharedFilter);
  const activeLocated = parseLocatedFilter(locatedFilter);
  // The one place the string turns into the three-valued query flag.
  // `undefined` is "both", and it has to be spelled out rather than left to
  // fall out of a truthiness test: `false` is a filter here.
  const sharedWhere = activeShared === null ? undefined : activeShared === "yes";
  // Same three-valued conversion, same reason. `false` here means "only the
  // ones with no location", which is a real question and not the absence of
  // one — written the truthy way it would silently show everything.
  const locatedWhere = activeLocated === null ? undefined : activeLocated === "yes";

  const timeZone = await viewerTimeZone();
  const [media, total] = await Promise.all([
    loadJobMedia(
      {
        companyId: company.id,
        ...(activeJob ? { jobId: activeJob } : {}),
        ...(activeTag ? { tagId: activeTag } : {}),
        ...(sharedWhere === undefined ? {} : { shared: sharedWhere }),
        ...(locatedWhere === undefined ? {} : { located: locatedWhere }),
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
      ...(sharedWhere === undefined ? {} : { shared: sharedWhere }),
      ...(locatedWhere === undefined ? {} : { located: locatedWhere }),
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
            <Link
              href={photosFilterHref({ tag: activeTag, shared: activeShared, located: activeLocated })}
              className={chip(!activeJob)}
            >
              All jobs
            </Link>
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={photosFilterHref({
                  job: job.id,
                  tag: activeTag,
                  shared: activeShared,
                  located: activeLocated,
                })}
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
              <Link
                href={photosFilterHref({
                  job: activeJob,
                  shared: activeShared,
                  located: activeLocated,
                })}
                className={chip(!activeTag)}
              >
                All tags
              </Link>
              {filterableTags.map((tag) => (
                <Link
                  key={tag.id}
                  href={photosFilterHref({
                    job: activeJob,
                    tag: tag.id,
                    shared: activeShared,
                    located: activeLocated,
                  })}
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

          {/* The client-visibility row, last of the three, because it is the
              narrowing you reach for once you already know which job — "what
              have we shown Turner on Riverside" is the job chip and then
              this one.

              ALWAYS RENDERED, unlike the tag row above it, which hides when
              a company has no tags. The difference is that a tag chip
              nobody has used leads to a guaranteed-empty gallery, while
              "Not shared" on a company that has never shared anything is
              the true and useful answer that everything is still internal.
              A control that disappears when its answer is "none" is a
              control you cannot use to CHECK that the answer is none.

              DELIBERATELY NO COUNTS on these two, unlike the tag chips. A
              tag's count describes the tag and is the same number wherever
              you stand; a shared count only means anything relative to the
              job you are looking at, so the honest version of it would
              change with the job chip while the tag counts beside it did
              not — two numbers on one row of chips, counting different
              populations, and no room to say which. The gallery's own
              "showing N of M" line already states the filtered total. */}
          <div className="mb-3 flex flex-wrap gap-2">
            <Link
              href={photosFilterHref({ job: activeJob, tag: activeTag, located: activeLocated })}
              className={chip(!activeShared)}
            >
              All photos
            </Link>
            <Link
              href={photosFilterHref({
                job: activeJob,
                tag: activeTag,
                shared: "yes",
                located: activeLocated,
              })}
              className={chip(activeShared === "yes")}
            >
              Shared with client
            </Link>
            <Link
              href={photosFilterHref({
                job: activeJob,
                tag: activeTag,
                shared: "no",
                located: activeLocated,
              })}
              className={chip(activeShared === "no")}
            >
              Not shared
            </Link>
          </div>

          {/* The location row, fourth and last, because it is the narrowing
              you reach for once you know which job — and because it is the
              only one of the four that some captures structurally cannot
              satisfy.

              ALWAYS RENDERED, like the visibility row above it and unlike
              the tag row. "No location" on a company that has never
              recorded one is the true and useful answer that nothing is
              located yet, and a control that disappears when its answer is
              "none" is a control you cannot use to CHECK that the answer is
              none.

              "ON SITE" IS NOT THE LABEL, and that is deliberate. This app
              does not know whether a capture was on site: that would mean
              comparing a coordinate to the job's address, which is derived
              state this schema refuses to store and a comparison a ±40 m
              fix cannot support. The chip says what the filter actually
              tests — whether a position was recorded — because a label
              claiming more than the query does is how somebody ends up
              arguing about where a crew was standing.

              NO COUNTS, matching the visibility chips and for the same
              reason: a located count only means something relative to the
              job you are standing on, so an honest one would change with
              the job chip while the tag counts beside it did not. The
              gallery's own "showing N of M" line already states the
              filtered total. */}
          <div className="mb-3 flex flex-wrap gap-2">
            <Link
              href={photosFilterHref({ job: activeJob, tag: activeTag, shared: activeShared })}
              className={chip(!activeLocated)}
            >
              Anywhere
            </Link>
            <Link
              href={photosFilterHref({
                job: activeJob,
                tag: activeTag,
                shared: activeShared,
                located: "yes",
              })}
              className={chip(activeLocated === "yes")}
            >
              Has a location
            </Link>
            <Link
              href={photosFilterHref({
                job: activeJob,
                tag: activeTag,
                shared: activeShared,
                located: "no",
              })}
              className={chip(activeLocated === "no")}
            >
              No location
            </Link>
          </div>

          <JobMediaTagManager tags={tags} />

          {/* Uploading needs a job, so the form only appears once one is
              chosen. On the job page it is always there, because the job is
              the page. */}
          {activeJob ? (
            <div className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <JobMediaCapture jobId={activeJob} />
              {/* ONLY WITH A JOB CHOSEN, because a photo report is one
                  JOB's document — the header names the job and the client,
                  and there is no such thing as a company-wide one. The
                  filters travel with the link, except that an unfiltered
                  gallery lands on the SAFE selection rather than on
                  "everything": see `selectionFromSharedFilter`. */}
              <p className="mt-3 text-sm text-slate-400">
                <Link
                  href={photoReportHref(activeJob, {
                    selection: selectionFromSharedFilter(activeShared),
                    tag: activeTag,
                  })}
                  className="text-blue-400 hover:text-blue-300"
                >
                  Photo report for this job →
                </Link>{" "}
                — a printable document with the marks on the photos.
              </p>
            </div>
          ) : (
            <p className="mb-8 text-sm text-slate-400">
              Pick a job above to add photos, or open the job itself.
            </p>
          )}

          {media.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
              {/* THE VISIBILITY FILTER GETS THE FIRST WORD when it is on,
                  because it is then the likeliest reason the gallery is
                  empty and — unlike the other two — the emptiness is itself
                  the answer somebody came for. "Nothing on this job has
                  been shared" is a fact worth reading, not a dead end.

                  Both sentences are phrased about THIS PAGE rather than
                  about the world, and that is a correctness point rather
                  than a stylistic one. An empty "Not shared" gallery has two
                  causes — every photo is shared, or there are no photos —
                  and the page cannot tell them apart without another query.
                  "Every photo is shared with the client" would be a
                  confident lie on a job with no photos at all. */}
              <p className="text-sm text-slate-300">
                {activeShared === "yes"
                  ? activeJob
                    ? "Nothing on this job is shared with the client."
                    : "Nothing here is shared with a client."
                  : activeShared === "no"
                    ? "Nothing here is being held back from the client."
                    : /* Below the visibility filter and above the tag one,
                         because an empty "Has a location" gallery is the
                         likeliest of the remaining three to be surprising —
                         somebody who just uploaded from a phone expects
                         something here. Phrased about THIS PAGE, like the
                         two above it: "no capture on this job recorded
                         one" is checkable from the rows; "location is
                         broken" would be a guess. */
                      activeLocated === "yes"
                      ? activeJob
                        ? "No capture on this job recorded where it was taken."
                        : "Nothing here recorded where it was taken."
                      : activeLocated === "no"
                        ? "Everything here recorded where it was taken."
                        : activeTag && activeJob
                          ? "No photos on this job carry that tag."
                          : activeTag
                            ? "No photos carry that tag."
                            : activeJob
                              ? "No photos on this job yet."
                              : "No photos yet."}
              </p>
              {/* A way out of every filter that is on, not just the one the
                  sentence above happened to name. With four filters
                  composing, the old single-link version could leave somebody
                  looking at an empty page whose only offered escape was from
                  a filter that was not the one narrowing it. */}
              <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-slate-400">
                {activeShared && (
                  <Link
                    href={photosFilterHref({ job: activeJob, tag: activeTag, located: activeLocated })}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {/* Keeps the location filter, and drops only the one it
                        names. Each escape link clears exactly its own
                        filter — a link that cleared everything would be a
                        "start again" button wearing four different labels,
                        and somebody two chips deep would lose the chip they
                        meant to keep. */}
                    Show all photos
                  </Link>
                )}
                {activeTag && (
                  <Link
                    href={photosFilterHref({
                      job: activeJob,
                      shared: activeShared,
                      located: activeLocated,
                    })}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Clear the tag filter
                  </Link>
                )}
                {activeLocated && (
                  <Link
                    href={photosFilterHref({
                      job: activeJob,
                      tag: activeTag,
                      shared: activeShared,
                    })}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Show captures from anywhere
                  </Link>
                )}
                {!activeShared && !activeTag && !activeLocated && (
                  <span>
                    {activeJob
                      ? "Add the first one above — a photo of the existing conditions before you start is the one people wish they had."
                      : "Pick a job above and add the first one."}
                  </span>
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
                  {activeJob || activeTag || activeShared || activeLocated
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

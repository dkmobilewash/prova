import Image from "next/image";
import { JobMediaMarks } from "@/components/JobMediaMarks";
import type { PortalJobPhoto } from "@/lib/job-media-query";

/**
 * The photos of a job, as the GC sees them through their portal link.
 *
 * READ-ONLY, AND THE THINGS IT LEAVES OUT ARE THE FEATURE. This file has a
 * near-twin in `components/JobMediaCard.tsx`, and the temptation on the day
 * somebody edits this one will be to reach for that component instead, or
 * to bring its parts over one at a time because each looks harmless on its
 * own. Every one of them is here-be-dragons, so each is written down:
 *
 *  1. NO TAGS. The tag vocabulary is this sub's internal framing of their
 *     own job — real ones on a real gallery read "backcharge", "GC delay",
 *     "rework". Those words are a position in a dispute, written for the
 *     sub's retrieval and for the sub's argument later. Handing them to the
 *     party the dispute is with is the single most damaging thing this
 *     feature could do, and it would not read as damage in a diff: it looks
 *     like adding a useful label. `PortalJobPhoto` does not carry tags at
 *     all, so this is enforced a type away rather than only here.
 *
 *  2. NO PHOTOGRAPHER. The GC has no use for which of the crew held the
 *     phone. What a name does provide is a person to name in a complaint,
 *     and a sub's foreman being individually attached to a photo of a
 *     defect is a cost with no matching benefit. The company took the
 *     photo; the company is on the page already.
 *
 *  3. NO DELETE, NO CAPTION EDIT, NO UPLOAD. The portal has no auth — the
 *     token IS the credential (see the page's own guard) — so a write
 *     control here is a write control for anyone who has ever been
 *     forwarded the link. There is no Server Action imported by this file
 *     and there must not be one. That also means no `"use client"`: this is
 *     a server component with no state and nothing to hydrate, which is the
 *     cheapest possible way for it to have no write path.
 *
 * Two more things it does not show, for the same family of reasons: the
 * file size (an internal detail of storage) and the clock warning (a note
 * to the sub that their own device's time looks wrong, which is not the
 * GC's business and would read as an admission).
 */
export function PortalJobPhotos({
  photos,
  total,
  limit,
}: {
  photos: PortalJobPhoto[];
  /** Every shared photo on the job, not just the ones on this page. The
   *  section is honest about what it is withholding for the same reason the
   *  internal galleries are — a capped list that says nothing looks
   *  complete. */
  total: number;
  limit: number;
}) {
  // Nothing shared means no section at all, rather than an empty state. An
  // empty state is a prompt to a person who can act, and there is nothing
  // the GC can do here — "no photos yet" on a client-facing page reads as a
  // promise the sub has not made.
  if (photos.length === 0) return null;

  return (
    <section className="mb-10">
      {/* "and videos" because the section can now hold clips and voice
          notes, and a heading that says photos over a video player is the
          kind of small wrongness a GC reads as carelessness about the rest
          of it. */}
      <h2 className="mb-3 text-lg font-semibold text-slate-100">Site photos and videos</h2>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {photos.map((photo) => (
          <li
            key={photo.id}
            className="flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
          >
            {/* Same posture as the internal card: the blob URL is the only
                src, and `unoptimized` keeps Next's optimizer — and the
                `images.remotePatterns` config it would need — out of it.
                JobMediaCard's own comment carries the reading of
                next@15.5.23 that establishes why that is correct rather
                than an oversight. */}
            {/* The same three-way branch the internal card makes, and for
                the same reason: only the photo is wrapped in a link,
                because a player inside an anchor navigates away on every
                tap of play or scrub. The GC gets controls instead. */}
            <div className="relative block aspect-[4/3] bg-slate-950">
              {photo.kind === "photo" ? (
                <a
                  href={photo.blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute inset-0"
                >
                  <Image
                    src={photo.blobUrl}
                    alt={photo.caption ?? "Site photo"}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </a>
              ) : photo.kind === "video" ? (
                <video
                  src={photo.blobUrl}
                  controls
                  preload="metadata"
                  playsInline
                  className="absolute inset-0 h-full w-full bg-black object-contain"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
                  <span aria-hidden className="text-3xl">🎙️</span>
                  <p className="text-sm text-slate-400">Voice note</p>
                  <audio src={photo.blobUrl} controls preload="metadata" className="w-full" />
                </div>
              )}
              {/* The same overlay the sub sees, from the same component and
                  the same projection. That is deliberate rather than
                  convenient: an arrow drawn to show the GC where the damage
                  is has to land in the same place on their screen as it did
                  on the screen where somebody decided to show it. */}
              <JobMediaMarks marks={photo.marks} aspect={4 / 3} />
            </div>
            <div className="flex flex-col gap-1 p-3">
              <p className="text-sm text-slate-200">
                {photo.caption ?? <span className="text-slate-400">No caption</span>}
              </p>
              {/* slate-400 on slate-900, never slate-500 — #89 measured that
                  pair at 3.83:1, under the 4.5 floor. A GC reading this on a
                  phone in a site trailer is the same eye in the same light
                  as the crew reading the internal gallery. */}
              <p className="text-sm text-slate-400">{photo.capturedAtLabel}</p>
              {/* SAID PLAINLY, because the alternative is a GC opening the
                  file, seeing no arrows, and reasonably concluding the
                  markup was added to a copy. The marks live beside the
                  photo rather than in it (media-annotations.prisma), so the
                  original genuinely is unmarked — that is a property of the
                  photograph being left alone, not a trick. */}
              {photo.marks.length > 0 && (
                <p className="text-sm text-slate-400">
                  Opening the image gives you the original, without the markup.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {total > limit && (
        <p className="mt-3 text-sm text-slate-400">
          Showing the {limit} most recent of {total}.
        </p>
      )}
    </section>
  );
}

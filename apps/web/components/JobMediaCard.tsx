"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addJobMediaTags,
  deleteJobMedia,
  removeJobMediaTag,
  updateJobMediaDetails,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { JOB_MEDIA_TAG_DATALIST_ID, JOB_MEDIA_TAGS_PER_PHOTO_MAX } from "@/lib/job-media-tags";

/** Everything the card needs, already formatted on the server.
 *
 * Dates arrive as STRINGS rather than `Date`s on purpose: `capturedAt` is
 * an instant and has to be rendered in the viewer's zone, which is
 * resolved server-side (lib/viewerToday.ts). Formatting it here would mean
 * reading the browser's zone during render, and the markup would then
 * disagree with the server's — the hydration break components/localToday.ts
 * exists to warn about.
 *
 * NO `contentType`. It was shipped to every card and read by nothing —
 * this renders an `<Image>` unconditionally, because photos are the only
 * thing that can be uploaded. It goes back in on the day the card actually
 * branches on it (video), and not before: a field nothing reads is
 * indistinguishable from one whose reader is broken, which is the
 * `acknowledgedSeverity` shape CLAUDE.md names. The COLUMN stays — it is
 * what that branch will be derived from. */
export type JobMediaCardData = {
  id: string;
  blobUrl: string;
  caption: string | null;
  capturedAtLabel: string;
  /** The same instant as a datetime-local input value, in the viewer's
   * zone — the edit form's default. */
  capturedAtInputValue: string;
  sizeLabel: string;
  capturedByName: string | null;
  /** Non-null only when the row's own two timestamps disagree — see
   * jobMediaClockWarning. Derived at read time, stored nowhere. */
  clockWarning: string | null;
  /** The labels on this photo, in name order, as they were typed. Display
   * names only: `normalizedName` exists to be the target of a unique index
   * and is never shown, so it never leaves the query module. */
  tags: { id: string; name: string }[];
  /** Shown only on the company-wide gallery, where one card's job is not
   * implied by the page it is on. */
  jobName?: string;
};

const btn =
  "min-h-11 inline-flex items-center rounded-md border border-slate-700 px-3 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function JobMediaCard({ media }: { media: JobMediaCardData }) {
  /* One mode for the card, with the tag form as a third value rather than
     a second boolean beside `edit`. Two independent flags would allow a
     card showing the caption form and the tag form at once — two inputs,
     two Save buttons, on a 250px-wide card on a phone. */
  const [mode, setMode] = useState<"view" | "edit" | "tags">("view");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const full = media.tags.length >= JOB_MEDIA_TAGS_PER_PHOTO_MAX;

  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {/* The blob URL is the only src. No proxy, no signing — these are
          public-but-unguessable (lib/blob.ts), which is the same posture
          every other upload in this app already has.

          `unoptimized` because Next's optimizer would have to be told about
          the blob hostname in next.config.mjs, and routing every jobsite
          photo through it is a per-image cost for a gallery already serving
          exactly the file that was uploaded.

          It is also what makes the missing `images.remotePatterns` entry
          correct rather than an oversight: `generateImgAttrs` returns the
          src untouched when unoptimized is set (next@15.5.23
          dist/shared/lib/get-img-props.js:98), so the default loader — and
          the remote-pattern check inside it — never runs. Read from the
          installed source, because a remote `<Image>` that needs config and
          does not have it builds cleanly and throws at request time.

          That same early return drops `srcSet` and `sizes`, so there is
          deliberately no `sizes` prop here: it would be inert, and an inert
          prop reads like a working one. Sizing is entirely CSS. */}
      <a href={media.blobUrl} target="_blank" rel="noopener noreferrer" className="relative block aspect-[4/3] bg-slate-950">
        <Image
          src={media.blobUrl}
          alt={media.caption ?? "Site photo"}
          fill
          unoptimized
          className="object-cover"
        />
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {media.jobName && <p className="text-sm font-medium text-slate-200">{media.jobName}</p>}

        {mode === "edit" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              const formData = new FormData(event.currentTarget);
              // A datetime-local input carries no zone — "2026-09-07T15:00"
              // is a wall clock, not an instant. `new Date(...)` on that
              // string resolves it against the BROWSER's own zone, which is
              // the calendar the person reading it is standing on, and
              // toISOString then sends the instant they meant. Doing this
              // in the browser is only safe because it happens in an event
              // handler rather than during render — the hydration rule
              // components/localToday.ts documents.
              const localCapturedAt = String(formData.get("capturedAt") ?? "");
              if (localCapturedAt) {
                const instant = new Date(localCapturedAt);
                if (!Number.isNaN(instant.getTime())) {
                  formData.set("capturedAt", instant.toISOString());
                }
              }
              startTransition(async () => {
                try {
                  const result = await updateJobMediaDetails(media.id, formData);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.refresh();
                  setMode("view");
                } catch {
                  setError("Could not save the caption");
                }
              });
            }}
            className="flex flex-col gap-2"
          >
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Caption
              <input
                name="caption"
                defaultValue={media.caption ?? ""}
                placeholder="What this shows"
                className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
            {/* Correctable because it was never entered by a person in the
                first place — it comes off the device's clock. This is the
                remedy for the warning shown in the view state; without it
                that warning is a dead end, since re-uploading from the same
                wrong clock reproduces the same wrong time. */}
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Taken
              <input
                type="datetime-local"
                name="capturedAt"
                defaultValue={media.capturedAtInputValue}
                className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="min-h-11 inline-flex items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
                Cancel
              </button>
            </div>
          </form>
        ) : mode === "tags" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              const form = event.currentTarget;
              const formData = new FormData(form);
              startTransition(async () => {
                try {
                  const result = await addJobMediaTags(media.id, formData);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.refresh();
                  setMode("view");
                } catch {
                  setError("Could not add that tag");
                }
              });
            }}
            className="flex flex-col gap-2"
          >
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Tags
              {/* `list` points at the ONE datalist the page renders
                  (JobMediaTagDatalist), so the browser offers the words this
                  company already uses before somebody invents a fourth
                  spelling of "west wall". `autoComplete="off"` is what stops
                  the browser's own form-history dropdown covering it — the
                  two suggestion popups are separate and the wrong one wins
                  by default.

                  `text-base` is not a size choice: iOS Safari zooms the
                  whole page in when a focused input renders under 16px, and
                  a crew tagging photos one-handed on a roof ends up zoomed
                  and scrolled sideways after every tap (#89). */}
              <input
                name="tags"
                autoComplete="off"
                list={JOB_MEDIA_TAG_DATALIST_ID}
                placeholder="west wall, before pour"
                autoFocus
                className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <p className="text-sm text-slate-400">
              Separate several with commas. {media.tags.length} of {JOB_MEDIA_TAGS_PER_PHOTO_MAX} used.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="min-h-11 inline-flex items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isPending ? "Adding…" : "Add"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* The tags, above the caption, because they are what somebody
                scanning a wall of photos reads first — a caption is a
                sentence and a tag is a label.

                Each chip carries its own remove, and it is ONE click rather
                than the two-step every delete in this app uses. That is a
                deliberate exception and the line is reversibility: taking a
                label off a photo is undone by putting it back, in the same
                place, in two taps. Nothing is lost that the person cannot
                restore, which is not true of the photo delete below it or of
                deleting the tag itself on /photos — both of those are
                two-step, and making a trivially reversible action two-step
                too is how a confirm step stops meaning anything. */}
            {media.tags.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {media.tags.map((tag) => (
                  <li
                    key={tag.id}
                    className="inline-flex items-center overflow-hidden rounded-full border border-slate-700 bg-slate-950"
                  >
                    <span className="py-1 pl-3 text-sm text-slate-300">{tag.name}</span>
                    {/* 44px square, per #89: this is the smallest thing on
                        the card and it is on a phone screen. The label says
                        which tag, because "×" alone is what a screen reader
                        would otherwise read out eleven times. */}
                    <button
                      type="button"
                      disabled={isPending}
                      aria-label={`Remove tag ${tag.name}`}
                      title={`Remove tag ${tag.name}`}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          try {
                            const result = await removeJobMediaTag(media.id, tag.id);
                            if (!result.ok) {
                              setError(result.error);
                              return;
                            }
                            router.refresh();
                          } catch {
                            setError("Could not remove that tag");
                          }
                        });
                      }}
                      className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-red-400 disabled:opacity-50"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-sm text-slate-200">
              {media.caption ?? <span className="text-slate-400">No caption</span>}
            </p>
            {/* slate-400 rather than slate-500: #89 measured slate-500 on a
                slate-900 card at 3.83:1, under the 4.5 floor, and this line
                carries the when and the who. */}
            <p className="text-sm text-slate-400">
              {media.capturedAtLabel}
              {media.capturedByName ? ` · ${media.capturedByName}` : ""} · {media.sizeLabel}
            </p>
            {media.clockWarning && <p className="text-sm text-amber-400">{media.clockWarning}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* Left-aligned cluster, so the default pinned="start" is
                correct here: Cancel takes the first slot, which is the one
                Delete vacates. See the prop's own doc comment — the rule is
                "Cancel inherits the Delete pixel", and which end that is
                depends on the cluster's alignment. */}
            <RowActions
              className="mt-auto flex flex-wrap items-center gap-3 pt-1"
              destructive={
                <ConfirmDelete
                  pendingLabel="Deleting…"
                  pending={isPending}
                  onConfirm={() => {
                    setError(null);
                    startTransition(async () => {
                      try {
                        const result = await deleteJobMedia(media.id);
                        if (!result.ok) {
                          setError(result.error);
                          return;
                        }
                        router.refresh();
                      } catch {
                        setError("Could not delete this photo");
                      }
                    });
                  }}
                  hint="The file is removed from storage too."
                  deleteClassName={btn}
                  cancelClassName={btn}
                  confirmClassName="min-h-11 inline-flex items-center rounded-md border border-red-500 px-3 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                />
              }
            >
              <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
                Caption
              </button>
              {/* An ordinary action, so it is a CHILD of RowActions and is
                  not rendered at all while the photo's delete is armed —
                  rule 1 of #152, enforced by the component rather than
                  remembered here. */}
              <button
                type="button"
                disabled={isPending || full}
                title={full ? `This photo already has ${JOB_MEDIA_TAGS_PER_PHOTO_MAX} tags` : undefined}
                onClick={() => {
                  setError(null);
                  setMode("tags");
                }}
                className={btn}
              >
                Add tag
              </button>
            </RowActions>
          </>
        )}
      </div>
    </li>
  );
}

"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addJobMediaTags,
  deleteJobMedia,
  removeJobMediaTag,
  setJobMediaClientSharing,
  updateJobMediaDetails,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { JOB_MEDIA_TAG_DATALIST_ID, JOB_MEDIA_TAGS_PER_PHOTO_MAX } from "@/lib/job-media-tags";
import type { JobMediaKind } from "@/lib/job-media";
import type { CapturedLocationSummary } from "@/lib/job-media-location";
import { JobMediaMarks, type JobMediaMark } from "@/components/JobMediaMarks";
import { JobMediaAnnotator } from "@/components/JobMediaAnnotator";
import { annotationSummary } from "@/lib/job-media-annotations";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

/** Everything the card needs, already formatted on the server.
 *
 * Dates arrive as STRINGS rather than `Date`s on purpose: `capturedAt` is
 * an instant and has to be rendered in the viewer's zone, which is
 * resolved server-side (lib/viewerToday.ts). Formatting it here would mean
 * reading the browser's zone during render, and the markup would then
 * disagree with the server's — the hydration break components/localToday.ts
 * exists to warn about.
 *
 * `kind` RATHER THAN `contentType`, and that is this comment's third
 * position on the same field. It was originally shipped raw and read by
 * nothing; it was then removed, with a note saying it would come back "on
 * the day the card actually branches on it (video), and not before". This
 * is that day, and what comes back is the DERIVED kind, not the raw type:
 * the card needs to know whether to render a picture, a player or a
 * recording, and every screen that asks should get the same answer from
 * `jobMediaKind` rather than each re-deriving it from a MIME string.
 *
 * `playbackWarning` is derived the same way and for a blunter reason: some
 * of what a phone records does not play in some browsers, and the person
 * deciding whether to show a clip to a GC is the one who has to be told. */
export type JobMediaCardData = {
  id: string;
  /** The job this is filed against. The CARD never renders it — `jobName`
   *  is what the company-wide gallery shows. It is on this type because the
   *  gallery around the card needs it: a multi-capture selection can only
   *  become a photo report when every ticked capture is on ONE job, and
   *  `/photos` is free to show several at once. See
   *  components/jobMediaSelection.ts. */
  jobId: string;
  blobUrl: string;
  /** Photo, video or voice note — derived from `contentType` at read time
   *  and stored nowhere. */
  kind: JobMediaKind;
  /** Non-null when a common browser cannot play this file. */
  playbackWarning: string | null;
  /** What somebody drew on it, as fractions of the 4:3 box the editor drew
   *  on — NOT of the image, which is what this said until issue #256 and is
   *  the difference the bug lived in. Empty for most photos and always empty
   *  for video and voice notes — you cannot usefully put a static arrow on a
   *  moving picture, and nothing offers to. */
  marks: JobMediaMark[];
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
  /** WHERE it was taken, or null — which is what most rows are and what an
   * ordinary row looks like. Every field of it is derived from the stored
   * coordinates at read time (`describeCapturedLocation`), including the
   * map link: no coordinate arithmetic happens in this component and no
   * mapping library is loaded anywhere in this app. */
  location: CapturedLocationSummary | null;
  /** The labels on this photo, in name order, as they were typed. Display
   * names only: `normalizedName` exists to be the target of a unique index
   * and is never shown, so it never leaves the query module. */
  tags: { id: string; name: string }[];
  /** Whether the job's client can currently see this photo through their
   *  portal link, and when that started. Null means internal-only, which is
   *  what every photo is until somebody decides otherwise. The LABEL rather
   *  than the raw date because the card renders it and the viewer's zone is
   *  resolved server-side. */
  sharedWithClientLabel: string | null;
  /** Shown only on the company-wide gallery, where one card's job is not
   * implied by the page it is on. */
  jobName?: string;
};

const btn =
  "min-h-11 inline-flex items-center rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";

/** The tick box on one card, handed down from the gallery that owns the
 *  selection. Optional so the card renders unchanged anywhere a selection
 *  makes no sense; both galleries pass it. */
export type JobMediaCardSelection = {
  selected: boolean;
  onToggle: () => void;
};

export function JobMediaCard({
  media,
  select,
}: {
  media: JobMediaCardData;
  select?: JobMediaCardSelection;
}) {
  /* One mode for the card, with the tag form as a third value rather than
     a second boolean beside `edit`. Two independent flags would allow a
     card showing the caption form and the tag form at once — two inputs,
     two Save buttons, on a 250px-wide card on a phone.

     "share" is a FOURTH VALUE OF THE SAME STATE and not a second armed
     flag, which is the only shape that could work here. The confirm
     `RowActions` provides is the `destructive` slot, and there is exactly
     one of it — a second independently-armed control living beside the
     children would put an armed confirm next to live ordinary actions,
     which is the precise shape #152 exists to remove. Switching mode
     replaces the whole body instead, so while the share question is on
     screen there is nothing else on the card to mis-tap. */
  /* "marks" is a FIFTH value of the same state, for the reason the fourth
     one is: the drawing surface replaces the card's body while it is open.
     A photo being marked up needs the whole card — a 250px preview with an
     edit form beside it is not a surface anybody can draw an arrow on. */
  const [mode, setMode] = useState<"view" | "edit" | "tags" | "share" | "marks">("view");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the media id so two cards can never share a draft; caption
  // and tags are different forms with different fields, so different keys.
  const detailsDraft = useFormDraft(`job-media:edit:${media.id}`);
  const tagsDraft = useFormDraft(`job-media:tags:${media.id}`);
  const router = useRouter();
  const full = media.tags.length >= JOB_MEDIA_TAGS_PER_PHOTO_MAX;

  if (mode === "marks") {
    return (
      <li className="flex flex-col overflow-hidden rounded-lg border border-line-card bg-surface p-3">
        <JobMediaAnnotator
          mediaId={media.id}
          blobUrl={media.blobUrl}
          alt={media.caption ?? "Site photo"}
          initialMarks={media.marks}
          onDone={() => setMode("view")}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-line-card bg-surface">
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
      <div className="relative block aspect-[4/3] bg-canvas">
        {/* THREE RENDERINGS, ONE BOX. The aspect box is kept for all three
            so a mixed gallery stays a grid rather than reflowing around
            whichever card happens to hold a voice note.

            Only the photo is a LINK to the raw file. A `<video>`/`<audio>`
            wrapped in an anchor is a control inside a link: every tap on
            play, scrub or volume also navigates, which on a phone means
            leaving the gallery to land on a bare blob URL. The players get
            their own controls instead, and the file is still reachable —
            the caption row below carries a plain "Open file" link. */}
        {media.kind === "photo" ? (
          <a
            href={media.blobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute inset-0"
          >
            {/* `object-contain`, where this was a centre crop until
                2026-09-15, and that is issue #256 rather than a taste call
                about thumbnails.

                (Spelled "a centre crop" rather than with the class name on
                purpose: `jobMediaMarkSurfaces.test.ts` fails this file if
                the crop class appears anywhere in it, and a comment quoting
                the pattern a census greps for is how #185 disarmed one.)

                A mark is stored as a fraction of the 4:3 box the editor
                drew on, with the photograph letterboxed inside it. Cropped
                to fill, the box is the same and the fractions are the same,
                but the photograph is bigger than the box — so the part of
                the picture under a given fraction is not the part the
                person drew on. Measured in real Chromium: 0px out on a
                genuinely 4:3 photo, 31px out on a 16:9 one in a phone-width
                cell and 89px out on a portrait 3:4 one in a desktop cell.

                What it costs, stated plainly because it is visible on every
                card: a non-4:3 photo now letterboxes, with bars on the
                slate-950 ground the box already had. The grid does not
                move — the box is still 4:3 — and a gallery of evidence
                showing the whole frame rather than a centre crop is the
                better default anyway, which is the same call
                `/jobs/[id]/photo-report` already made for paper. */}
            <Image
              src={media.blobUrl}
              alt={media.caption ?? "Site photo"}
              fill
              unoptimized
              className="object-contain"
            />
          </a>
        ) : media.kind === "video" ? (
          /* `preload="metadata"` rather than `auto`: a gallery of a dozen
             clips must not pull a dozen videos down a hotspot to show
             twelve first frames. `playsInline` is what stops iOS Safari
             taking over the whole screen the moment play is tapped, which
             on a walk-through you want to be the person's choice. */
          <video
            src={media.blobUrl}
            controls
            preload="metadata"
            playsInline
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : (
          /* A voice note has nothing to show, so the box says what it is
             and the control sits under it rather than floating in black. */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
            <span aria-hidden className="text-3xl">🎙️</span>
            <p className="text-sm text-ink-body">Voice note</p>
            <audio src={media.blobUrl} controls preload="metadata" className="w-full" />
          </div>
        )}
        {/* ON THE IMAGE, not only in the text below it, and that placement
            is the safeguard rather than decoration. The question this
            feature has to keep answerable is "which of these can the GC
            see", asked while scrolling a wall of sixty thumbnails — and a
            line of small grey type in a card body is not readable at that
            distance. A solid chip over the corner of the photo is.

            NAMES THE AUDIENCE, and the bare state's name will not do.
            "Shared" alone invites the reading "shared with the team", and
            every photo here is already shared with the team; the whole risk
            in this feature is somebody misreading which audience is meant.

            It said "Client can see this" until a customer pointed out that
            the audience is not the client — the portal link goes to whoever
            the sub sends it to, the GC, the architect, an owner's rep — and
            that naming one of them narrows the control wrongly. "Shared by
            link" names the MECHANISM, which is the only thing that is true
            of every reader: holding the job's portal link is exactly what
            this state confers, and it cannot be misread as the team.

            A dark label on the opaque brand yellow rather than a
            translucent overlay: the background is an arbitrary photograph,
            so any contrast a see-through chip has is whatever the picture
            happened to be. */}
        {/* The marks over the thumbnail, so "which of these is marked up"
            is answerable while scrolling rather than only after opening
            one.

            This used to pass `aspect={4 / 3}` with a comment saying "the
            editor measures the real photo instead". It does not — its
            `surfaceRef` is a hard-coded 4:3 div, so it measured 4/3 too,
            and that sentence is why the mismatch above went unnoticed for
            as long as it did: it told every reader the geometry was already
            handled. There is no `aspect` prop any more; the number lives on
            `JOB_MEDIA_MARK_BOX_ASPECT` with the contract it implies. */}
        <JobMediaMarks marks={media.marks} />
        {media.sharedWithClientLabel && (
          <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-neutral-900">
            Shared by link
          </span>
        )}
        {/* THE TICK BOX, on the image and OPPOSITE the shared badge so the
            two never collide on a 250px card.
            ON THE IMAGE rather than in the card body for the reason the
            badge is: this has to be findable while scrolling a wall of
            sixty thumbnails, which is the only situation in which picking
            three of them is hard work.

            NOT A CHILD OF `RowActions`, unlike every other control on this
            card, and that is deliberate rather than an oversight of #152's
            rule 1. That rule empties a row of ordinary ACTIONS while a
            delete is armed, because an action taken by mistake next to an
            armed confirm is a mutation. Ticking a box mutates nothing —
            there is no server call, no disclosure and nothing to undo —
            and it is 300px away from the armed pair at the foot of the
            card. What it must not do is sit in the cluster: `RowActions`
            unmounts its children while armed, so a selection living there
            would silently untick every card whose delete somebody opened
            and cancelled.

            A real `<input type="checkbox">` inside a 44px label (#89),
            rather than a styled button: it is what a screen reader
            announces as a checkbox with a state, and what a keyboard
            toggles with a space bar. The opaque backing is the badge's
            argument — the ground is an arbitrary photograph, so anything
            translucent has whatever contrast the picture happened to
            have. */}
        {select && (
          <label className="absolute right-2 top-2 z-10 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-line-card bg-surface">
            <input
              type="checkbox"
              checked={select.selected}
              onChange={select.onToggle}
              aria-label={
                media.caption ? `Pick “${media.caption}”` : "Pick this capture"
              }
              className="h-5 w-5 accent-brand"
            />
          </label>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {media.jobName && <p className="text-sm font-medium text-ink-label">{media.jobName}</p>}

        {mode === "edit" ? (
          <form
            ref={detailsDraft.formRef}
            onChange={detailsDraft.save}
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
                  detailsDraft.clear();
                  router.refresh();
                  setMode("view");
                } catch {
                  setError("Could not save the caption");
                }
              });
            }}
            className="flex flex-col gap-2"
          >
            <FormDraftNotice draft={detailsDraft} />
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Caption
              <input
                name="caption"
                defaultValue={media.caption ?? ""}
                placeholder="What this shows"
                className="min-h-11 rounded-md border border-line-card bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
              />
            </label>
            {/* Correctable because it was never entered by a person in the
                first place — it comes off the device's clock. This is the
                remedy for the warning shown in the view state; without it
                that warning is a dead end, since re-uploading from the same
                wrong clock reproduces the same wrong time. */}
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Taken
              <input
                type="datetime-local"
                name="capturedAt"
                defaultValue={media.capturedAtInputValue}
                className="min-h-11 rounded-md border border-line-card bg-canvas px-3 text-base text-ink focus:border-link focus:outline-none"
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="min-h-11 inline-flex items-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
            ref={tagsDraft.formRef}
            onChange={tagsDraft.save}
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
                  tagsDraft.clear();
                  router.refresh();
                  setMode("view");
                } catch {
                  setError("Could not add that tag");
                }
              });
            }}
            className="flex flex-col gap-2"
          >
            <FormDraftNotice draft={tagsDraft} />
            <label className="flex flex-col gap-1 text-sm text-ink-label">
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
                className="min-h-11 rounded-md border border-line-card bg-canvas px-3 text-base text-ink placeholder:text-ink-body focus:border-link focus:outline-none"
              />
            </label>
            <p className="text-sm text-ink-body">
              Separate several with commas. {media.tags.length} of {JOB_MEDIA_TAGS_PER_PHOTO_MAX} used.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="min-h-11 inline-flex items-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
              >
                {isPending ? "Adding…" : "Add"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
                Cancel
              </button>
            </div>
          </form>
        ) : mode === "share" ? (
          /* THE ONE CONFIRM STEP IN THIS FEATURE, and it guards the SHARE
             direction only. Both halves of that are decisions:

             WHY SHARE IS CONFIRMED. Every other confirm in this app guards
             a delete, i.e. something irreversible. Sharing looks reversible
             — "Stop sharing" is right there — and that reading is wrong in
             the way that matters. Withdrawal removes the photo from the
             portal page; it does not remove it from the GC who has already
             looked at it, and blob URLs stay reachable to anyone who saved
             one (lib/blob.ts). The DISCLOSURE is the irreversible part, and
             a disclosure to the other side of a construction contract is
             exactly what a sub cannot take back. So the thing being
             confirmed is not "are you sure you want to change this field",
             it is "are you sure this one is theirs to see" — of the photos
             on a job, the backcharge evidence and the crew's own mistake
             are on the same page as the progress shots.

             WHY UNSHARING IS NOT CONFIRMED. It is the safety action. A
             confirm on it would slow down the one control somebody reaches
             for having realised they published the wrong photo, and it
             would buy nothing: the worst outcome of an accidental
             withdrawal is that the GC stops seeing a photo they were
             welcome to see, which one tap restores. Friction belongs on the
             direction that cannot be undone, and putting it on both is how
             a confirm step stops meaning anything — the same argument the
             tag chips' one-click remove is written from, further down. */
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-label">Share this photo?</p>
            <p className="text-sm text-ink-body">
              Anyone holding this job&apos;s portal link will see the file, any marks drawn on it,
              its caption and when it was taken. Tags and who took it are never shown. You can stop
              sharing it later, but you cannot un-show it.
            </p>
            {/* HERE, not only on the card, because this is the moment the
                decision is made. A .mov shown to a GC on a Windows laptop
                is a blank box, and finding that out from the GC is worse
                than finding it out from this sentence. */}
            {media.playbackWarning && (
              <p className="text-sm text-amber-400">{media.playbackWarning}</p>
            )}
            {annotationSummary(media.marks.length) && (
              <p className="text-sm text-ink-body">{annotationSummary(media.marks.length)}</p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await setJobMediaClientSharing(media.id, true);
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      router.refresh();
                      setMode("view");
                    } catch {
                      setError("Could not share this photo");
                    }
                  });
                }}
                className="min-h-11 inline-flex items-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
              >
                {isPending ? "Sharing…" : "Share it"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
                Cancel
              </button>
            </div>
          </div>
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
                    className="inline-flex items-center overflow-hidden rounded-full border border-line-card bg-canvas"
                  >
                    <span className="py-1 pl-3 text-sm text-ink-label">{tag.name}</span>
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
                      className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center text-ink-body hover:text-red-400 disabled:opacity-50"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-sm text-ink-label">
              {media.caption ?? <span className="text-ink-body">No caption</span>}
            </p>
            {/* ink-body rather than ink-muted: the muted level is under the
                4.5 floor (#89's rule), and this line carries the when and
                the who. */}
            <p className="text-sm text-ink-body">
              {media.capturedAtLabel}
              {media.capturedByName ? ` · ${media.capturedByName}` : ""} · {media.sizeLabel}
            </p>
            {media.clockWarning && <p className="text-sm text-amber-400">{media.clockWarning}</p>}
            {/* WHERE, on the line under WHEN and WHO, because that is the
                order somebody reads a caption in and because a photo
                without one must not leave a hole. Nothing at all is
                rendered for an unlocated capture — no "no location", no
                greyed-out pin. Most rows have none and a placeholder on
                every one of them would turn the normal case into a
                complaint.

                THE MAP IS A LINK, NOT A MAP. This app loads no third-party
                script into any page, and an embedded map would also hand a
                crew member's position to a tile server on render, for every
                card in a sixty-photo gallery, without anybody choosing to.
                A link means the disclosure happens when a person decides it
                should. `rel="noopener noreferrer"` for the same reason
                every other outbound link here carries it.

                slate-400 rather than slate-500, per #89 — slate-500 on
                slate-900 measures 3.83:1, under the 4.5 floor. */}
            {media.location && (
              <p className="text-sm text-slate-400">
                <span aria-hidden="true">📍 </span>
                {media.location.coordinateLabel}
                {media.location.accuracyLabel ? ` · ${media.location.accuracyLabel}` : ""}{" "}
                <a
                  href={media.location.mapHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link hover:text-link-hover"
                >
                  Map
                </a>
              </p>
            )}
            {/* Amber, like the clock warning above and for the same reason:
                a caveat about the record rather than a failure of it. This
                is the whole point of storing the accuracy radius — without
                it a 2 km network fix and an 8 m GPS fix are the same
                five-decimal number on the same line. */}
            {media.location?.coarseNote && (
              <p className="text-sm text-amber-400">{media.location.coarseNote}</p>
            )}
            {/* Amber like the clock warning and for the same reason: it is
                a caveat about the file rather than a failure, and the
                person who needs it is the one about to show this to a GC. */}
            {media.playbackWarning && (
              <p className="text-sm text-amber-400">{media.playbackWarning}</p>
            )}
            {/* The photo IS its own link (the whole image opens the file).
                A video and a voice note are not — wrapping a player in an
                anchor makes every tap on play or scrub navigate away — so
                they get this instead, which is also the only way to hand
                the raw file to somebody who wants to download it. */}
            {media.kind !== "photo" && (
              <a
                href={media.blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-link hover:text-link-hover"
              >
                Open file
              </a>
            )}

            {/* The second half of "obvious at a glance": the badge on the
                image says THAT the client can see it, this says SINCE WHEN.
                Both, rather than one, because they answer different
                questions and the second is the one that settles an argument
                — "we sent you that on the 8th" is a claim the timestamp
                supports and a badge does not.

                tag-blue-ink, matching the badge's brand family, so the two
                read as one state rather than as two unrelated pieces of
                furniture. On the white card it measures well clear of the
                4.5 floor #89 set. */}
            {media.sharedWithClientLabel && (
              <p className="text-sm text-tag-blue-ink">
                Shared by link, {media.sharedWithClientLabel}
              </p>
            )}
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
                  describe="Deletes this photo or video from the job for everyone in the company."
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
                  confirmClassName="min-h-11 inline-flex items-center rounded-md border border-red-500 px-3 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
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
              {/* ALSO A CHILD OF `RowActions`, and it has to be. The
                  tempting placement is its own row above the cluster, since
                  "who can see this" is a different kind of thing from
                  "edit the caption" — but a control outside this component
                  stays live while the photo's delete is armed, which is
                  rule 1 of #152 and the exact sibling-of-the-ternary shape
                  RowActions was built to make impossible. It goes in the
                  cluster; the badge and the line above are what carry the
                  state, and they do not need a button's help to be seen.

                  Two different controls rather than one toggle whose label
                  flips. A single button reading "Share"/"Stop sharing" puts
                  the destructive-to-privacy direction and the safe one on
                  the same pixel, so a card that revalidated underneath a
                  thumb does the opposite of what was aimed at. These also
                  behave differently on purpose — one asks first, one does
                  not — and one button that sometimes opens a confirm and
                  sometimes acts immediately is a worse thing to explain
                  than two buttons. */}
              {/* PHOTOS ONLY. A static arrow on a moving picture points at
                  whatever happens to be in frame at second nought, which
                  is worse than no arrow, so the affordance is simply not
                  offered rather than offered and then explained. */}
              {media.kind === "photo" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setError(null);
                    setMode("marks");
                  }}
                  className={btn}
                >
                  {media.marks.length > 0 ? "Edit marks" : "Mark up"}
                </button>
              )}
              {media.sharedWithClientLabel ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      try {
                        const result = await setJobMediaClientSharing(media.id, false);
                        if (!result.ok) {
                          setError(result.error);
                          return;
                        }
                        router.refresh();
                      } catch {
                        setError("Could not stop sharing this photo");
                      }
                    });
                  }}
                  className={btn}
                >
                  {/* A CONSTANT LABEL, unlike the delete's "Deleting…", and
                      the difference is not an oversight. `isPending` is the
                      card's ONE transition, shared by every control on it —
                      so a pending label here would also light up while a tag
                      chip beside it was being removed, announcing work that
                      is not this button's. The delete can say "Deleting…"
                      safely because it is only reachable while armed, and
                      `RowActions` hides every other control in that state,
                      so nothing else can be in flight. Here the feedback is
                      the disabled state (#19) and then the button itself
                      becoming "Share". */}
                  Stop sharing
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setError(null);
                    setMode("share");
                  }}
                  className={btn}
                >
                  {/* "SHARE", NOT "SHOW CLIENT", and the customer who asked
                      for it put the reason better than we had: "so you can
                      share with anybody, right?" The control sends nothing
                      to a named party — it puts this capture behind the
                      job's portal link, and that link goes to whoever the
                      sub sends it to. "Client" narrowed the button to one
                      of its audiences and made people stop and wonder
                      whether it was the right control. The confirmation
                      step below is where the audience is described exactly,
                      which is where a person deciding needs it. */}
                  Share
                </button>
              )}
            </RowActions>
          </>
        )}
      </div>
    </li>
  );
}

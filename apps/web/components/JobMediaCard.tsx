"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteJobMedia, updateJobMediaDetails } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/** Everything the card needs, already formatted on the server.
 *
 * Dates arrive as STRINGS rather than `Date`s on purpose: `capturedAt` is
 * an instant and has to be rendered in the viewer's zone, which is
 * resolved server-side (lib/viewerToday.ts). Formatting it here would mean
 * reading the browser's zone during render, and the markup would then
 * disagree with the server's — the hydration break components/localToday.ts
 * exists to warn about. */
export type JobMediaCardData = {
  id: string;
  blobUrl: string;
  contentType: string;
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
  /** Shown only on the company-wide gallery, where one card's job is not
   * implied by the page it is on. */
  jobName?: string;
};

const btn =
  "min-h-11 inline-flex items-center rounded-md border border-slate-700 px-3 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function JobMediaCard({ media }: { media: JobMediaCardData }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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
        ) : (
          <>
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
            </RowActions>
          </>
        )}
      </div>
    </li>
  );
}

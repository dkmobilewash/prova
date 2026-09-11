"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteJobMediaTag, renameJobMediaTag } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { JOB_MEDIA_TAG_MAX_LENGTH } from "@/lib/job-media-tags";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

/** One tag in the company's vocabulary, with how many photos wear it.
 *
 * The count is computed by the query on every read and stored nowhere —
 * see `loadJobMediaTags`. It is on screen because of what it is FOR: the
 * delete below says "it comes off 12 photos" before it does it, and a
 * number that could be stale would make that sentence a lie at exactly
 * the moment somebody is relying on it. */
export type JobMediaTagSummary = {
  id: string;
  name: string;
  photoCount: number;
};

const btn =
  "min-h-11 inline-flex items-center rounded-md border border-slate-700 px-3 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";

/**
 * Renaming and deleting the company's photo tags.
 *
 * WHY THIS SCREEN EXISTS AT ALL. A vocabulary table you cannot edit is
 * just a slower string column: the first typo — "wset wall" on forty
 * photos — is permanent, and from then on the autocomplete offers the typo
 * beside the correct word and half the crew picks the wrong one. Renaming
 * is one row here and fixes all forty photos at once, which is most of the
 * argument for the table in the first place (media-tags.prisma).
 *
 * COLLAPSED BEHIND A BUTTON, like every add-form in this app. This is
 * housekeeping done once a month; the gallery underneath it is the page.
 */
export function JobMediaTagManager({ tags }: { tags: JobMediaTagSummary[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={btn}
        aria-expanded={open}
      >
        {open ? "Done managing tags" : `Manage tags (${tags.length})`}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900">
          {tags.length === 0 ? (
            <div className="p-4">
              <p className="text-sm text-slate-300">No tags yet.</p>
              {/* A real way out rather than a dead end: this list is filled
                  from the photos, not from here, and saying so is the
                  difference between an empty state and a broken screen. */}
              <p className="mt-1 text-sm text-slate-400">
                Tags are made by using them. Add one to a photo below — &ldquo;west wall&rdquo;,
                &ldquo;before pour&rdquo; — and it appears here for everyone to reuse.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {tags.map((tag) => (
                <JobMediaTagRow key={tag.id} tag={tag} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function JobMediaTagRow({ tag }: { tag: JobMediaTagSummary }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // Keyed by the tag id so two rows' rename forms can never share a draft.
  const draft = useFormDraft(`job-media-tag:edit:${tag.id}`);

  const photos = `${tag.photoCount} ${tag.photoCount === 1 ? "photo" : "photos"}`;

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          ref={draft.formRef}
          onChange={draft.save}
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              try {
                const result = await renameJobMediaTag(tag.id, formData);
                if (!result.ok) {
                  // The collision case lands here — "you already have a tag
                  // called …" — and it is a returned failure rather than a
                  // thrown one precisely so this line can show it. A thrown
                  // Server Action message is redacted to a digest in
                  // production (CLAUDE.md, verified 2026-08-27).
                  setError(result.error);
                  return;
                }
                draft.clear();
                router.refresh();
                setMode("view");
              } catch {
                setError("Could not rename that tag");
              }
            });
          }}
          className="flex flex-col gap-2"
        >
          <FormDraftNotice draft={draft} />
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Tag name
            <input
              name="name"
              defaultValue={tag.name}
              maxLength={JOB_MEDIA_TAG_MAX_LENGTH}
              autoFocus
              className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <p className="text-sm text-slate-400">Renaming it changes it on all {photos}.</p>
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
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-slate-100">{tag.name}</p>
        {/* slate-400, not slate-500: #89 measured slate-500 on slate-900 at
            3.83:1, under the 4.5 contrast floor. */}
        <p className="text-sm text-slate-400">On {photos}</p>
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Arming the delete empties this row of everything else — "Rename"
          disappears rather than sitting live beside a confirm. That is
          RowActions' job, not this file's (#152).

          `pinned="end"` because this cluster is right-pinned (shrink-0 in a
          justify-between row): in that geometry the LAST control keeps the
          position Delete vacated, so Cancel goes last. Measured, not
          reasoned — see the prop's own comment. */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2"
        destructive={
          <ConfirmDelete
            pinned="end"
            pendingLabel="Deleting…"
            pending={isPending}
            prompt={`Delete "${tag.name}"?`}
            hint={`It comes off ${photos}. The photos themselves are untouched.`}
            onConfirm={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const result = await deleteJobMediaTag(tag.id);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.refresh();
                } catch {
                  setError("Could not delete that tag");
                }
              });
            }}
            deleteClassName={btn}
            cancelClassName={btn}
            confirmClassName="min-h-11 inline-flex items-center rounded-md border border-red-500 px-3 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
          />
        }
      >
        <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
          Rename
        </button>
      </RowActions>
    </li>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { createSubmittal } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";
import { SubmittalFields } from "@/components/SubmittalFields";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The worked example for field-level errors and drafts: `createSubmittal`
 * returns `fieldErrors` (via `InputError(message, field)` and `failOn`), and
 * `ActionForm` puts each one under its input. `draftKey` is the same key the
 * hand-rolled `useFormDraft` used, so a draft saved before this change still
 * comes back.
 */
export function SubmittalForm({ jobs, defaultJobId, startOpen = false }: { jobs: JobOption[]; defaultJobId?: string; startOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(startOpen);

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5">
        <p className="text-sm font-medium text-ink-label">No jobs yet</p>
        <p className="mt-1 text-sm text-ink-body">
          A submittal is always a package against a specific job&apos;s spec sections, so it has to
          belong to a job. Create one and the form will appear here.
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Go to Jobs
        </Link>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Log a submittal
      </button>
    );
  }

  return (
    <ActionForm
      action={createSubmittal}
      draftKey="submittal:create"
      onSuccess={() => setIsOpen(false)}
      errorClassName="text-sm text-danger"
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink-label">Log a submittal</h2>

      <SubmittalFields
        jobs={jobs}
        defaultJobId={defaultJobId}
        defaults={{ title: "", description: null, specSection: null, drawingReference: null }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Date sent
          {/* Blank, like `dueBack` three lines down and like the sentence
              under this input. `createSubmittal` says it out loud — "Blank
              means it hasn't gone out yet: registered but not submitted, and
              deletable" — and a date here creates revision 1, after which
              only a NOT_SENT submittal can be deleted. Today's date is a
              claim about the GC's mail, so it is entered, never assumed. */}
          <input type="date" name="sentOn" defaultValue="" className={inputClass} />
          <span className="text-xs text-ink-muted">
            Blank means it hasn&apos;t gone out yet. Backdate it when you&apos;re entering a package you
            already sent.
          </span>
        </label>
        <label className={labelClass}>
          Answer needed back by
          <input type="date" name="dueBack" defaultValue="" className={inputClass} />
        </label>
      </div>

      <div className="flex gap-2">
        <SubmitButton
          type="submit"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          Save submittal
        </SubmitButton>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}

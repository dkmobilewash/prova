"use client";

import { useState } from "react";

import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { recordTakeoffPlanRevision } from "@/lib/actions";

/**
 * Which issue of the drawings this sheet is, off its own title block.
 *
 * COLLAPSED BEHIND A BUTTON whose label says what is missing, because the
 * state that matters is the absent one: a plan with no issue date reads as
 * UNKNOWABLE, and the app cannot tell whether its quantities came off current
 * paper. The button is the prompt.
 *
 * Separate from the upload because the label and date are read off the sheet
 * once it is open in the viewer, which is after the upload happened. Asking
 * at upload time would be asking before anybody can see them.
 */
export function TakeoffPlanRevisionForm({
  jobId,
  planId,
  revisionLabel,
  sheetIssuedOn,
}: {
  jobId: string;
  planId: string;
  revisionLabel: string | null;
  /** YYYY-MM-DD, or null. */
  sheetIssuedOn: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-md border px-2 py-1 text-xs ${
          sheetIssuedOn
            ? "border-line-card text-ink-label hover:bg-neutral-800"
            : "border-tag-amber-ink/40 text-tag-amber-ink hover:bg-amber-500/10"
        }`}
      >
        {sheetIssuedOn
          ? `${revisionLabel ?? "Issue"} · ${sheetIssuedOn}`
          : "Which revision is this?"}
      </button>
    );
  }

  return (
    <ActionForm
      action={recordTakeoffPlanRevision.bind(null, jobId)}
      className="flex flex-wrap items-end gap-2"
      onSuccess={() => setOpen(false)}
    >
      <input type="hidden" name="planId" value={planId} />

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Revision, off the title block
        <input
          name="revisionLabel"
          defaultValue={revisionLabel ?? ""}
          placeholder="Rev 2"
          className="w-28 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Dated
        <input
          type="date"
          name="sheetIssuedOn"
          defaultValue={sheetIssuedOn ?? ""}
          className="rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
        {/* Said here because the wrong instinct is to put today's date in. */}
        <span className="text-ink-muted">
          The date printed on the sheet, not today — it is what later revisions are compared against.
        </span>
      </label>

      <SubmitButton
        type="submit"
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        Save
      </SubmitButton>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

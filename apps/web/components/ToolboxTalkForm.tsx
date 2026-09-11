"use client";

import { useState, useTransition } from "react";
import { createToolboxTalk } from "@/lib/actions";
import { inputClass, labelClass, type JobOption } from "@/components/SafetyIncidentFields";
import { localToday } from "@/components/localToday";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export function ToolboxTalkForm({ jobs, today }: { jobs: JobOption[]; today: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("toolbox-talk:create");

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
      >
        Log a toolbox talk
      </button>
    );
  }

  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            await createToolboxTalk(formData);
            draft.clear();
            draft.resetForm();
            setIsOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log the toolbox talk");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink-label">Log a toolbox talk</h2>
      <FormDraftNotice draft={draft} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Date held
          <input type="date" name="heldOn" required defaultValue={localToday()} className={inputClass} />
        </label>
        <label className={labelClass}>
          Job (optional)
          <select name="jobId" defaultValue="" className={inputClass}>
            <option value="">Not job-specific (shop, yard, all-hands)</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Topic
          <input
            type="text"
            name="topic"
            required
            placeholder="e.g. Silica exposure when cutting board"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Presenter
          <input type="text" name="presenter" placeholder="e.g. Foreman name" className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        Who attended
        <textarea
          name="attendees"
          rows={2}
          placeholder="Names, as written on the sign-in sheet"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Notes
        <textarea name="notes" rows={2} placeholder="Anything raised or committed to" className={inputClass} />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Log talk"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

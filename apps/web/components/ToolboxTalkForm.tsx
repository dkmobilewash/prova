"use client";

import { useRef, useState, useTransition } from "react";
import { createToolboxTalk } from "@/lib/actions";
import { inputClass, labelClass, type JobOption } from "@/components/SafetyIncidentFields";

export function ToolboxTalkForm({ jobs, today }: { jobs: JobOption[]; today: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500"
      >
        Log a toolbox talk
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            await createToolboxTalk(formData);
            formRef.current?.reset();
            setIsOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log the toolbox talk");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Log a toolbox talk</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Date held
          <input type="date" name="heldOn" required defaultValue={today} className={inputClass} />
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

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

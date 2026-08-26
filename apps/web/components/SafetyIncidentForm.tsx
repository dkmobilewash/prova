"use client";

import { useRef, useState, useTransition } from "react";
import { createSafetyIncident } from "@/lib/actions";
import {
  SafetyIncidentFields,
  type JobOption,
} from "@/components/SafetyIncidentFields";

export function SafetyIncidentForm({ jobs, today }: { jobs: JobOption[]; today: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Record an incident
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
            await createSafetyIncident(formData);
            formRef.current?.reset();
            setIsOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not record the incident");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Record an incident</h2>

      <SafetyIncidentFields
        jobs={jobs}
        defaults={{
          occurredAt: today,
          jobId: null,
          employeeName: "",
          jobTitle: null,
          location: null,
          description: "",
          classification: "INJURY",
          outcome: "FIRST_AID_ONLY",
          daysAway: null,
          daysRestricted: null,
        }}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Record incident"}
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

"use client";

import { useState, useTransition } from "react";
import { createSafetyIncident } from "@/lib/actions";
import {
  SafetyIncidentFields,
  type JobOption,
} from "@/components/SafetyIncidentFields";
import { localToday } from "@/components/localToday";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export function SafetyIncidentForm({ jobs, today }: { jobs: JobOption[]; today: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("safety-incident:create");

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-tour="safety-record-incident"
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Record an incident
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
          // Reads the RETURNED result. This used to be a try/catch around a
          // throwing action, which works in dev and not in production —
          // Next redacts a thrown Server Action message to a digest, so the
          // sentence naming the missing field never reached the person
          // filing an injury report.
          const result = await createSafetyIncident(formData);
          if (result.ok) {
            draft.clear();
            draft.resetForm();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink-label">Record an incident</h2>
      <FormDraftNotice draft={draft} />

      <SafetyIncidentFields
        jobs={jobs}
        defaults={{
          occurredAt: localToday(),
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

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

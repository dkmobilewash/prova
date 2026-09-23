"use client";

import { useState, useTransition } from "react";
import { recordExperienceModRate } from "@/lib/actions";
import {
  ExperienceModRateFields,
  type ExperienceModRateDefaults,
} from "@/components/ExperienceModRateFields";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

const EMPTY: ExperienceModRateDefaults = {
  effectiveDate: null,
  rate: null,
  source: null,
  sourceUrl: null,
  note: null,
};

/** Collapsed behind a button until someone wants it, like every other add
 * form in this app. Submit is disabled while in flight — no create action is
 * idempotent, and a page that stalls after a commit invites a second click
 * (#19). */
export function ExperienceModRateForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("experience-mod-rate:create");

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Record a mod rate
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
          const result = await recordExperienceModRate(formData);
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
      <h3 className="text-sm font-semibold text-ink-label">Record a mod rate</h3>
      <FormDraftNotice draft={draft} />
      <p className="text-xs text-ink-muted">
        One rate per policy year. Next year&apos;s rate can be recorded as soon as the bureau issues it — it
        becomes the current one on its effective date.
      </p>

      <ExperienceModRateFields defaults={EMPTY} showEffectiveDate />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save rate"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

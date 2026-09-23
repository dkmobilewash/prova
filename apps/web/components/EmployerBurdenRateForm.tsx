"use client";

import { useState, useTransition } from "react";
import { recordEmployerBurdenRate } from "@/lib/actions";
import {
  EmployerBurdenRateFields,
  type EmployerBurdenRateDefaults,
} from "@/components/EmployerBurdenRateFields";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

const EMPTY: EmployerBurdenRateDefaults = {
  effectiveDate: null,
  percent: null,
  note: null,
};

/** Collapsed behind a button until someone wants it, like every other add
 * form in this app. Submit is disabled while in flight — no create action is
 * idempotent, and a page that stalls after a commit invites a second click
 * (#19). The draft survives a failed save (#313): this form is three fields,
 * one of which is a sentence somebody wrote, and losing it to a validation
 * message is how a person stops recording the note at all. */
export function EmployerBurdenRateForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("employer-burden-rate:create");

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Record a burden rate
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
          const result = await recordEmployerBurdenRate(formData);
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
      <h3 className="text-sm font-semibold text-ink-label">Record a burden rate</h3>
      <FormDraftNotice draft={draft} />
      <p className="text-xs text-ink-muted">
        One rate per start date. Next year&apos;s can be recorded as soon as your accountant works it
        out — it takes over on its own date, and hours already logged keep the rate they were costed
        at.
      </p>

      <EmployerBurdenRateFields defaults={EMPTY} showEffectiveDate />

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

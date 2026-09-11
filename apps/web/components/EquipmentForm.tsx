"use client";

import { useState, useTransition } from "react";
import { createEquipment } from "@/lib/actions";
import { EquipmentFields } from "@/components/EquipmentFields";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

/** Collapsed by default — same reasoning as VendorForm: the list is why
 * you came, adding is occasional.
 *
 * No `jobs` prop: equipment is not created onto a job. It goes out to one
 * later, through EquipmentDeploymentControls, which is where the overlap
 * rule lives. Both this form and EquipmentRow took a `jobs` list that had
 * stopped reaching `EquipmentFields` and was passed to nothing. */
export function EquipmentForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("equipment:create");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await createEquipment(formData);
        draft.clear();
        draft.resetForm();
        setIsOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save equipment");
      }
    });
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Add equipment
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line-card bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-label">Add equipment</h2>
      <form ref={draft.formRef} onSubmit={handleSubmit} onChange={draft.save} className="flex flex-col gap-3">
        <FormDraftNotice draft={draft} />
        <EquipmentFields />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Add equipment"}
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
    </div>
  );
}

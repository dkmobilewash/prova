"use client";

import { useState, useTransition } from "react";
import { createVendor } from "@/lib/actions";
import { VendorFields } from "@/components/VendorFields";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

/** Collapsed by default. Looking a vendor up is the common case; adding
 * one is occasional, and an always-open six-field form pushes the whole
 * directory below the fold. */
export function VendorForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("vendor:create");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createVendor(formData);
      // Returned, not thrown: production replaces a thrown Server Action
      // message with React's own "omitted in production builds" paragraph,
      // so "Vendor name is required" never reached anyone. The form is reset
      // and closed only on the OK branch, so a refusal leaves the six fields
      // as typed.
      if (!result.ok) {
        setError(result.error);
        return;
      }
      draft.clear();
      draft.resetForm();
      setIsOpen(false);
    });
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Add a vendor
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line-card bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-label">Add a vendor</h2>
      <form ref={draft.formRef} onSubmit={handleSubmit} onChange={draft.save} className="flex flex-col gap-3">
        <FormDraftNotice draft={draft} />
        <VendorFields />

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Add vendor"}
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
    </div>
  );
}

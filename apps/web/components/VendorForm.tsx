"use client";

import { useRef, useState, useTransition } from "react";
import { createVendor } from "@/lib/actions";
import { VendorFields } from "@/components/VendorFields";

/** Collapsed by default. Looking a vendor up is the common case; adding
 * one is occasional, and an always-open six-field form pushes the whole
 * directory below the fold. */
export function VendorForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await createVendor(formData);
        formRef.current?.reset();
        setIsOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save vendor");
      }
    });
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Add a vendor
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-300">Add a vendor</h2>
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
        <VendorFields />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

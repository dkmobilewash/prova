"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSalesLead } from "@/lib/actions";
import { SalesLeadFields } from "@/components/SalesLeadFields";
import { Spinner } from "@/components/Spinner";

export function SalesLeadForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * The success side-effects, held until the saved row is on screen.
   *
   * `router.refresh()` stays inside the transition, so `isPending` is true
   * until the refreshed tree COMMITS — measured on production at 3,502 ms
   * against the action resolving at 1,251 ms. Running the close at the
   * earlier moment took the form away while the row behind it still showed
   * the old value, which two click-throughs reported as a lost update.
   * Issue #163.
   */
  const settle = useRef<null | (() => void)>(null);
  useEffect(() => {
    if (isPending || settle.current === null) return;
    const run = settle.current;
    settle.current = null;
    run();
  }, [isPending]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
      >
        Add a lead
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
            const result = await createSalesLead(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
            // Queued rather than run: what this save produced has not
            // reached the screen yet. See `settle` above.
            settle.current = () => {
              formRef.current?.reset();
              setIsOpen(false);
            };
          } catch {
            setError("Could not add this lead");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-ink-label">Add a lead</h3>

      <SalesLeadFields defaults={{ companyName: "", contactName: null, email: null, phone: null, source: null }} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending || undefined}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Saving…
            </span>
          ) : (
            "Save"
          )}
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

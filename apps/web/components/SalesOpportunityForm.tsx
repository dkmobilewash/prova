"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSalesOpportunity } from "@/lib/actions";
import { SalesOpportunityFields } from "@/components/SalesOpportunityFields";
import { localToday } from "@/components/localToday";
import { Spinner } from "@/components/Spinner";

export function SalesOpportunityForm({ leadId }: { leadId: string }) {
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
        Add an opportunity
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
            const result = await createSalesOpportunity(leadId, formData);
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
            setError("Could not add this opportunity");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-ink-label">Add an opportunity</h3>

      <SalesOpportunityFields
        mode="create"
        // localToday(), not the server's date: this form only renders after
        // a click, so there is no server markup to disagree with.
        defaults={{
          stage: "NEW",
          estimatedMrr: null,
          expectedCloseDate: null,
          notes: null,
          stageEffectiveOn: localToday(),
        }}
      />

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

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSalesActivity } from "@/lib/actions";
import {
  SalesActivityFields,
  type OpportunityOption,
} from "@/components/SalesActivityFields";
import { localToday } from "@/components/localToday";

export function SalesActivityForm({
  leadId,
  opportunityOptions,
}: {
  leadId: string;
  opportunityOptions: readonly OpportunityOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-200"
      >
        Log an activity
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
            const result = await createSalesActivity(leadId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
            formRef.current?.reset();
            setIsOpen(false);
          } catch {
            setError("Could not log this activity");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-ink-label">Log an activity</h3>

      <SalesActivityFields
        // localToday(), not the server's date: this form only ever renders
        // after a click, so there is no server markup for it to disagree
        // with, and someone logging a call at 5pm in Los Angeles must not
        // have it dated tomorrow.
        defaults={{
          type: "CALL",
          occurredOn: localToday(),
          summary: "",
          followUpOn: null,
          opportunityId: null,
        }}
        opportunityOptions={opportunityOptions}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

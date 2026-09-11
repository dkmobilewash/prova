"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContactInteraction } from "@/lib/actions";
import { ContactInteractionFields, type MemberOption, type PersonOption } from "@/components/ContactInteractionFields";
import { localToday } from "@/components/localToday";

export function ContactInteractionForm({
  contactId,
  members,
  people,
}: {
  contactId: string;
  members: MemberOption[];
  people: PersonOption[];
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
        className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
      >
        Log an interaction
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
            const result = await createContactInteraction(contactId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
            formRef.current?.reset();
            setIsOpen(false);
          } catch {
            setError("Could not log the interaction");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-ink-label">Log an interaction</h3>

      <ContactInteractionFields
        members={members}
        people={people}
        defaults={{
          type: "CALL",
          occurredOn: localToday(),
          summary: "",
          followUpOn: null,
          followUpAssignedToUserId: null,
          contactPersonId: null,
        }}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

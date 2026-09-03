"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContactPerson } from "@/lib/actions";
import { ContactPersonFields } from "@/components/ContactPersonFields";

export function ContactPersonForm({ contactId }: { contactId: string }) {
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
        className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
      >
        Add a person
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
            const result = await createContactPerson(contactId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
            formRef.current?.reset();
            setIsOpen(false);
          } catch {
            setError("Could not add this person");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h3 className="text-sm font-semibold text-slate-300">Add a person</h3>

      <ContactPersonFields defaults={{ name: "", title: null, email: null, phone: null }} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

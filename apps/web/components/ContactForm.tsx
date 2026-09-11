"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContact } from "@/lib/actions";
import { ContactFields, ContactStandingTermsFields } from "@/components/ContactFields";

export function ContactForm() {
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
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Add a contact
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
            const result = await createContact(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
            formRef.current?.reset();
            setIsOpen(false);
          } catch {
            setError("Could not add the contact");
          }
        });
      }}
      className="mb-6 flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Add a contact</h2>

      <ContactFields defaults={{ name: "", email: null, phone: null, address: null, status: "PROSPECT", accountType: null }} />

      {/* #218: standing terms are reachable at creation now — a sub often
          already knows a GC's retainage %, payment terms and preferred
          subcontract form before the first job, from having worked with
          (or bid to) them before. MSA/prequalification expiry dates are
          deliberately NOT here; see the comment beside them in
          ContactEditForm.tsx. */}
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        Standing terms with this GC (optional)
      </p>
      <ContactStandingTermsFields
        defaults={{ defaultRetainagePercent: null, paymentTermsDays: null, standardFormsUsed: null }}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save contact"}
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

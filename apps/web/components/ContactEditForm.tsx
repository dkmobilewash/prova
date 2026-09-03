"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContact } from "@/lib/actions";
import { ContactFields, type ContactDefaults } from "@/components/ContactFields";
import { inputClass, labelClass } from "@/components/RfiFields";
import { classifyRenewal, renewalTiming } from "@/lib/compliance-expiry";
import { SubmitButton } from "@/components/SubmitButton";

export type ContactEditDefaults = ContactDefaults & {
  defaultRetainagePercent: string | null;
  paymentTermsDays: string | null;
  standardFormsUsed: string | null;
  msaExpirationDate: string | null;
  prequalificationExpiresAt: string | null;
};

/** Renders "Expired"/"due in Nd" beside a date input, from the value already
 * saved — reuses the same renewal-status logic as licences/insurance/bonds
 * rather than a second copy of the day-counting, which is what produced two
 * disagreeing numbers for the same fact the last time this schema tried it
 * ad hoc. */
function expiryNote(dateIso: string | null, kind: "MSA" | "PREQUALIFICATION", today: string) {
  if (!dateIso) return null;
  const renewal = classifyRenewal(
    { id: "", kind, title: "", detail: null, date: dateIso, expectsDate: true, href: "" },
    today,
  );
  if (renewal.urgency === "EXPIRED") return { text: "Expired", className: "text-red-400" };
  if (renewal.urgency === "DUE_SOON") return { text: renewalTiming(renewal), className: "text-amber-400" };
  return { text: renewalTiming(renewal), className: "text-slate-500" };
}

export function ContactEditForm({
  contactId,
  defaults,
  today,
}: {
  contactId: string;
  defaults: ContactEditDefaults;
  today: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const msaNote = expiryNote(defaults.msaExpirationDate, "MSA", today);
  const prequalNote = expiryNote(defaults.prequalificationExpiresAt, "PREQUALIFICATION", today);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await updateContact(contactId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          } catch {
            setError("Could not save changes");
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <ContactFields defaults={defaults} />

      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Standing terms with this GC
      </p>
      <div className="flex flex-wrap gap-3">
        <label className={labelClass}>
          Default retainage %
          <input
            name="defaultRetainagePercent"
            defaultValue={defaults.defaultRetainagePercent ?? ""}
            placeholder="e.g. 10"
            className={`w-32 ${inputClass}`}
          />
        </label>
        <label className={labelClass}>
          Payment terms (days)
          <input
            name="paymentTermsDays"
            defaultValue={defaults.paymentTermsDays ?? ""}
            placeholder="e.g. 30"
            className={`w-32 ${inputClass}`}
          />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm text-slate-300">
          Standard forms used
          <input
            name="standardFormsUsed"
            defaultValue={defaults.standardFormsUsed ?? ""}
            placeholder="e.g. AIA A401"
            className={inputClass}
          />
        </label>
      </div>

      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Master service agreement &amp; prequalification
      </p>
      <div className="flex flex-wrap gap-3">
        <label className={labelClass}>
          MSA expiration date
          <input
            type="date"
            name="msaExpirationDate"
            defaultValue={defaults.msaExpirationDate ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Blank means no MSA on file.
            {msaNote && <span className={`ml-1 ${msaNote.className}`}>{msaNote.text}</span>}
          </span>
        </label>
        <label className={labelClass}>
          Prequalification expires
          <input
            type="date"
            name="prequalificationExpiresAt"
            defaultValue={defaults.prequalificationExpiresAt ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Blank means never prequalified with this GC.
            {prequalNote && <span className={`ml-1 ${prequalNote.className}`}>{prequalNote.text}</span>}
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <SubmitButton
        type="submit"
        disabled={isPending}
        className="mt-2 inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </SubmitButton>
    </form>
  );
}

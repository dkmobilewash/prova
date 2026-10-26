"use client";

import { createContact } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";

const field =
  "rounded-md border border-line-card bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

/**
 * C Stream Bid — add a GC. A bid invitation needs a GC (`BidInvitation.contactId`
 * is required) and the CRM sends a person to its Contacts page to make one;
 * Bid has no contact page and must not link to one.
 *
 * THE CRM'S OWN `createContact` (company.ts), unchanged: the same row, the same
 * defaults (a new contact is a PROSPECT, no standing terms), the same refusal
 * sentences through `ActionForm`. Only the fields differ — name, email, phone —
 * because the CRM form's status, account type and standing retainage/payment
 * terms are account management, not something a sub needs to hold an invitation.
 * Everything left out is still editable in the full product; nothing is lost.
 */
export function BidAddGcForm() {
  return (
    <ActionForm action={createContact} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm text-ink-label">
        GC name
        <input name="name" required className={field} placeholder="Turner Construction" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Email (optional)
        <input name="email" type="email" className={`${field} w-56`} placeholder="pm@turner.com" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Phone (optional)
        <input name="phone" type="tel" className={`${field} w-44`} />
      </label>
      <SubmitButton
        type="submit"
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
      >
        Add GC
      </SubmitButton>
    </ActionForm>
  );
}

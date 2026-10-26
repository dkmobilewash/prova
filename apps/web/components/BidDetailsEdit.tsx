"use client";

import { useState } from "react";
import { updateBidInvitationDetails } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { BidDetailsFields, type BidDetailsDefaults } from "@/components/BidDetailsFields";

/**
 * "Edit details & dates" on a bid row: inline, collapsed behind a button,
 * saving through `updateBidInvitationDetails`. It exists because of addenda —
 * they move the due date (and the walk, and the RFI cutoff) after the bid was
 * logged, and until now nothing could change any of it.
 */
export function BidDetailsEdit({ bidInvitationId, defaults }: { bidInvitationId: string; defaults: BidDetailsDefaults }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center text-sm text-link hover:underline mouse:min-h-0"
      >
        Edit details &amp; dates
      </button>
    );
  }

  return (
    <ActionForm
      action={updateBidInvitationDetails.bind(null, bidInvitationId)}
      resetOnSuccess={false}
      onSuccess={() => setOpen(false)}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-line-card bg-surface p-3"
    >
      <BidDetailsFields defaults={defaults} />
      <div className="flex gap-2">
        <SubmitButton
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
        >
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-11 items-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover mouse:min-h-9"
        >
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}

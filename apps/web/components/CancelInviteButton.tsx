"use client";

import { useState, useTransition } from "react";
import { cancelInvite } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * Cancelling a pending invite, in two steps, with the refusal on screen.
 *
 * It was one click on a red "Cancel" pinned to the right of the invited
 * address — and the two rows of an invite list look alike, so the misclick
 * cancels somebody else's. Cheap to recover (invite again) and still worth
 * asking, because nothing on the page said which one went.
 *
 * `cancelInvite` returns its refusals now instead of throwing them, so "that
 * invite is no longer there" reads as a sentence rather than as a page that
 * did nothing.
 *
 * GEOMETRY. The row is `flex items-center justify-between`, so this cluster is
 * right-pinned and the LAST control keeps its position: `pinned="end"`.
 * There is no ordinary action in the row, so `RowActions` carries no children
 * — it is still what holds the arming state, which is the one place it lives.
 */
export function CancelInviteButton({ inviteId }: { inviteId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelInvite(inviteId);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Could not cancel this invite");
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <RowActions
        className="flex shrink-0 items-center justify-end gap-2"
        destructive={
          <ConfirmDelete
            pinned="end"
            label="Cancel"
            confirmLabel="Confirm cancel"
            pendingLabel="Cancelling…"
            cancelLabel="Keep invite"
            pending={isPending}
            onConfirm={handleCancel}
            deleteClassName="text-sm text-red-400 hover:underline disabled:opacity-50"
          />
        }
      />
      {error && <p className="max-w-[16rem] text-right text-xs text-rose-300">{error}</p>}
    </div>
  );
}

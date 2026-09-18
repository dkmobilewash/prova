"use client";

import { useState, useTransition } from "react";
import { archiveCrewMember } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * Archiving a crew member, in two steps, with the refusal on screen. Not a
 * delete — their hours and name stay on every payroll — but there is no
 * un-archive button, so it still asks twice.
 *
 * GEOMETRY. Same row shape as CancelInviteButton (`justify-between`, this
 * cluster right-pinned), so the LAST control keeps its position:
 * `pinned="end"`.
 */
export function ArchiveCrewButton({ crewMemberId }: { crewMemberId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await archiveCrewMember(crewMemberId);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Could not archive this crew member. Reload the page and try again.");
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
            describe="Takes them off the crew: they stop appearing when hours are logged. Every hour already logged for them, and their name on past payrolls, stays exactly as it is."
            label="Archive"
            confirmLabel="Confirm archive"
            pendingLabel="Archiving…"
            cancelLabel="Keep"
            pending={isPending}
            onConfirm={handleArchive}
            deleteClassName="text-sm text-red-400 hover:underline disabled:opacity-50"
          />
        }
      />
      {error && <p className="max-w-[16rem] text-right text-xs text-rose-300">{error}</p>}
    </div>
  );
}

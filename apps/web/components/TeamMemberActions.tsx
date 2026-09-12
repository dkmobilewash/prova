"use client";

import { useState, useTransition, type ReactNode } from "react";
import { removeTeamMember } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * Removing a teammate, in two steps, with the refusal on screen.
 *
 * It was one click: a bare `<form action={removeTeamMember.bind(null, id)}>`
 * with a red "Remove", directly under the job-function dropdown. One misclick
 * deleted the User row — and with it that person's sign-in, since
 * `requireCompanyContext` adopts a row by verified email and there was no row
 * left to adopt. Nothing asked, and nothing could be undone from the page.
 *
 * `removeTeamMember` now returns `{ ok: false, error }` instead of throwing
 * (production redacts a thrown Server Action message), so this renders the
 * reason: not the owner, already gone, or an owner who has to have their role
 * changed first. Before, all four of those looked identical — the teammate
 * simply stayed on the list.
 *
 * GEOMETRY. The cluster is `shrink-0` and `items-end` inside the row's
 * `sm:justify-between`, so on the desktop it hangs off the right edge and the
 * LAST control keeps its position: `pinned="end"`, per the rule in
 * `RowActions.tsx`. The job-function picker is `children` rather than a
 * sibling, so arming the delete hides it — otherwise the hurried second click
 * lands on a permissions dropdown. Below 640px `ConfirmDelete` puts the pair
 * in its own column with Cancel on top; no caller decides that.
 */
export function TeamMemberActions({
  userId,
  children,
}: {
  userId: string;
  /** The job-function picker, when the viewer may set it. Hidden while the
   *  delete is armed, which is the whole reason it is passed in here. */
  children?: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeTeamMember(userId);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Could not remove this teammate");
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <RowActions
        className="flex shrink-0 flex-col items-end gap-2"
        destructive={
          <ConfirmDelete
            pinned="end"
            label="Remove"
            confirmLabel="Confirm remove"
            pendingLabel="Removing…"
            pending={isPending}
            onConfirm={handleRemove}
            armedClassName="flex flex-wrap items-center justify-end gap-2"
            deleteClassName="text-sm text-red-400 hover:underline disabled:opacity-50"
            hint={
              <span className="max-w-[16rem] text-right text-ink-muted">
                Their account goes, and with it their sign-in. A teammate with hours or a dispatch
                slip recorded cannot be deleted at all — clear their job function instead.
              </span>
            }
          />
        }
      >
        {children}
      </RowActions>
      {error && <p className="max-w-[16rem] text-right text-xs text-rose-300">{error}</p>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { disconnectAcc } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import type { FeedCardState } from "@/lib/acc/setup";

const linkButton =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500";

/**
 * Connect / Reconnect / Disconnect for the ACC card, worded for Autodesk
 * Construction Cloud but otherwise the same control as ProcoreControls.
 *
 * Connect is a LINK, not an action: it has to leave the app for Autodesk's
 * sign-in, and /api/acc/start sets the state cookie on that redirect.
 * Disconnect is the same two-step control IntegrationControls uses
 * (RowActions + ConfirmDelete), never `window.confirm`.
 *
 * With ACC not set up on this install there is nothing to press, and the
 * card says so in words rather than showing a button that would fail.
 */
export function ACCControls({ state, startHref }: { state: FeedCardState; startHref: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (state === "not-set-up") {
    return (
      <p className="max-w-[16rem] text-right text-xs text-ink-muted" data-tour="acc-not-set-up">
        Not set up on this install yet. Whoever runs C Stream for you has to add the Autodesk app keys
        before this can connect.
      </p>
    );
  }

  if (state === "connect" || state === "reconnect") {
    return (
      <div className="flex flex-col items-end gap-2">
        <a href={startHref} className={linkButton} data-tour="acc-connect">
          {state === "reconnect" ? "Reconnect" : "Connect"}
        </a>
        <span className="max-w-[16rem] text-right text-xs text-ink-muted">
          Opens Autodesk. Sign in with your own ACC login — the one your GCs invite to their projects.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <RowActions
        className="flex flex-col items-end gap-1"
        destructive={
          <ConfirmDelete
            describe="C Stream stops reading Autodesk Construction Cloud. Linked projects keep what was last read."
            label="Disconnect"
            confirmLabel="Confirm disconnect"
            pendingLabel="Disconnecting…"
            pending={isPending}
            onConfirm={() => {
              setError(null);
              startTransition(async () => {
                const result = await disconnectAcc();
                if (!result.ok) setError(result.error);
              });
            }}
            armedClassName="flex flex-wrap items-center justify-end gap-2"
            hint={
              <span className="max-w-[16rem] text-right text-ink-muted">
                Nothing changes in ACC, and none of your own records are touched.
              </span>
            }
            deleteClassName="inline-flex items-center justify-center rounded-md border border-line-card bg-surface px-3 py-1.5 text-xs font-medium text-ink-label hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            cancelClassName="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-body hover:text-ink disabled:opacity-60"
            confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-tag-rose disabled:cursor-not-allowed disabled:opacity-60"
          />
        }
      />
      {error && (
        <p role="alert" className="max-w-[18rem] text-right text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

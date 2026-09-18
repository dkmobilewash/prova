"use client";

import { useState, useTransition } from "react";
import { disconnectJobber } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import type { ImportCardState } from "@/lib/jobber/setup";

const linkButton =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500";

/**
 * Connect / Reconnect / Disconnect for the Jobber card.
 *
 * Connect is a LINK, not an action: it has to leave the app for Jobber's
 * consent screen, and /api/jobber/start sets the state cookie on that
 * redirect. Disconnect is the same two-step control IntegrationControls
 * uses (RowActions + ConfirmDelete), never `window.confirm`.
 *
 * With Jobber not set up on this install there is nothing to press, and
 * the card says so in words rather than showing a button that would fail.
 */
export function JobberControls({ state, startHref }: { state: ImportCardState; startHref: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (state === "not-set-up") {
    return (
      <p className="max-w-[16rem] text-right text-xs text-ink-muted" data-tour="jobber-not-set-up">
        Not set up on this install yet. Whoever runs C Stream for you has to add the Jobber app keys
        before this can connect.
      </p>
    );
  }

  if (state === "connect" || state === "reconnect") {
    return (
      <div className="flex flex-col items-end gap-2">
        <a href={startHref} className={linkButton} data-tour="jobber-connect">
          {state === "reconnect" ? "Reconnect" : "Connect"}
        </a>
        <span className="max-w-[16rem] text-right text-xs text-ink-muted">
          Opens Jobber to sign in and allow C Stream to read your account.
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
            describe="C Stream stops reading Jobber. Everything already imported stays."
            label="Disconnect"
            confirmLabel="Confirm disconnect"
            pendingLabel="Disconnecting…"
            pending={isPending}
            onConfirm={() => {
              setError(null);
              startTransition(async () => {
                const result = await disconnectJobber();
                if (!result.ok) setError(result.error);
              });
            }}
            armedClassName="flex flex-wrap items-center justify-end gap-2"
            hint={
              <span className="max-w-[16rem] text-right text-ink-muted">
                Clients and jobs already imported are kept.
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

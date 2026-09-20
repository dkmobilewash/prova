"use client";

import { useState, useTransition } from "react";
import { disconnectBluebeam } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import type { BluebeamCardState } from "@/lib/bluebeam/setup";

const linkButton =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500";

/**
 * Connect / Reconnect / Disconnect for the Bluebeam card — the DocuSign
 * card's arrangement. Connect is a LINK (it leaves the app for Bluebeam's
 * consent screen, and /api/bluebeam/start sets the state cookie on that
 * redirect). Disconnect is the shared two-step control, never
 * `window.confirm`.
 */
export function BluebeamControls({ state, startHref }: { state: BluebeamCardState; startHref: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (state === "not-set-up") {
    return (
      <p className="max-w-[16rem] text-right text-xs text-ink-muted" data-tour="bluebeam-not-set-up">
        Not set up on this install yet. Whoever runs C Stream for you has to add the Bluebeam app keys before this
        can connect.
      </p>
    );
  }

  if (state === "connect" || state === "reconnect") {
    return (
      <div className="flex flex-col items-end gap-2">
        <a href={startHref} className={linkButton} data-tour="bluebeam-connect">
          {state === "reconnect" ? "Reconnect" : "Connect"}
        </a>
        <span className="max-w-[16rem] text-right text-xs text-ink-muted">
          Opens Bluebeam to sign in and allow C Stream to create Studio Sessions from your account.
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
            describe="C Stream stops pushing documents or reading markup status. Linked jobs stay linked, and nothing already in a Studio Session is touched."
            label="Disconnect"
            confirmLabel="Confirm disconnect"
            pendingLabel="Disconnecting…"
            pending={isPending}
            pinned="end"
            onConfirm={() => {
              setError(null);
              startTransition(async () => {
                const result = await disconnectBluebeam();
                if (!result.ok) setError(result.error);
              });
            }}
            armedClassName="flex flex-wrap items-center justify-end gap-2"
            hint={<span className="max-w-[16rem] text-right text-ink-muted">Linked jobs and Studio Sessions are kept.</span>}
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

"use client";

import { useState, useTransition } from "react";
import { Button } from "@prova/ui";
import type { ActionResult } from "@/lib/actions/shared";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * Connect and disconnect for one integration card.
 *
 * A client component because the actions RETURN their failures rather than
 * throwing — a thrown Server Action message is redacted to a digest in a
 * production build (verified 2026-08-27) — and something has to hold the
 * returned error and render it. `<form action={serverAction}>` discards the
 * return value, so this uses the same explicit `startTransition` shape as
 * SubmittalForm.
 *
 * Disconnect asks twice, matching every other destructive control in this
 * app, and never `window.confirm`. It is not a delete, but it does drop a
 * credential and stop a sync, and a single click that quietly stops an
 * accounting feed is the kind of thing nobody notices until month end.
 *
 * It goes through `<RowActions>` for the same reason every row does. Nothing
 * is live beside it today — "Connect" only renders when disconnected — but
 * it was hand-rolling its own armed state, which is exactly the mechanism
 * issue #152 catalogued twenty times, and the next button added to this card
 * would have inherited the bug for free.
 */
export function IntegrationControls({
  connected,
  connect,
  disconnect,
  providerName,
}: {
  connected: boolean;
  connect: () => Promise<ActionResult>;
  disconnect: () => Promise<ActionResult>;
  providerName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<ActionResult>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) onDone?.();
      else setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {!connected && (
        <Button
          type="button"
          // Disabled while in flight for the same reason every create in
          // this app is: a second click has nothing to make it idempotent.
          disabled={isPending}
          onClick={() => run(connect)}
        >
          {isPending ? "Connecting…" : "Connect"}
        </Button>
      )}

      {connected && (
        <RowActions
          className="flex flex-col items-end gap-1"
          destructive={
            <ConfirmDelete
              label="Disconnect"
              confirmLabel="Confirm disconnect"
              pendingLabel="Disconnecting…"
              pending={isPending}
              onConfirm={() => run(disconnect)}
              armedClassName="flex flex-wrap items-center justify-end gap-2"
              hint={
                <span className="max-w-[16rem] text-right text-ink-muted">
                  {providerName} stops syncing. The history below is kept.
                </span>
              }
              // Matches @prova/ui's <Button variant="secondary">, which this
              // used to be. ConfirmDelete renders a plain button so that one
              // component can serve both the pill rows and the text-link rows.
              deleteClassName="inline-flex items-center justify-center rounded-md border border-line-card bg-surface px-3 py-1.5 text-xs font-medium text-ink-label hover:bg-tag-slate disabled:cursor-not-allowed disabled:opacity-60"
              cancelClassName="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-body hover:text-ink disabled:opacity-60"
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          }
        />
      )}

      {error && (
        <p role="alert" className="max-w-[18rem] text-right text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

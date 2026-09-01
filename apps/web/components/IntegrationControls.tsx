"use client";

import { useState, useTransition } from "react";
import { Button } from "@prova/ui";
import type { ActionResult } from "@/lib/actions/shared";

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
  const [isConfirming, setIsConfirming] = useState(false);

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

      {connected && !isConfirming && (
        <Button type="button" variant="secondary" onClick={() => setIsConfirming(true)}>
          Disconnect
        </Button>
      )}

      {connected && isConfirming && (
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(disconnect, () => setIsConfirming(false))}
              className="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Disconnecting…" : "Confirm disconnect"}
            </button>
            <button
              type="button"
              onClick={() => setIsConfirming(false)}
              className="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-body hover:text-ink"
            >
              Cancel
            </button>
          </div>
          <p className="max-w-[16rem] text-right text-xs text-ink-muted">
            {providerName} stops syncing. The history below is kept.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="max-w-[18rem] text-right text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

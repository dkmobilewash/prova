"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/shared";

/**
 * Sends the alerts on this page to yourself, as one email.
 *
 * Its most useful property is the one that looks like a failure: click it
 * twice and the second click says there is nothing new to send. That is
 * the anti-nag ledger working, and it is the fastest way for a person to
 * see that this feature will not mail them the same licence every morning.
 *
 * Disabled while in flight, per #19 — a create action that a person can
 * click twice while the first is still running has no idempotency to fall
 * back on, and this one sends mail.
 */
export function SendDigestButton({
  sendMyAlertDigest,
  recipientEmail,
}: {
  sendMyAlertDigest: () => Promise<ActionResult>;
  recipientEmail: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-200">
            Email these to me
          </p>
          <p className="text-xs text-slate-500">
            One email to {recipientEmail}, covering anything you haven&apos;t
            already been told.
          </p>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setSent(false);
            startTransition(async () => {
              const result = await sendMyAlertDigest();
              if (result.ok) {
                // On top of the action's own revalidatePath, matching the
                // other twelve write paths. The send writes a Message row
                // that /messages renders, and the delivery-log line this
                // button points at is the first thing anyone checks after
                // clicking it — a stale one reads as mail that never went.
                router.refresh();
                setSent(true);
              } else {
                setError(result.error);
              }
            });
          }}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Email these to me"}
        </button>
      </div>
      {sent && (
        <p className="mt-3 text-sm text-emerald-400">
          Sent. It is in the delivery log, which will say whether it actually
          arrived.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}
    </div>
  );
}

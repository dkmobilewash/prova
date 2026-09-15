"use client";

import { useEffect, useState } from "react";
import { installRscFailureGuard, type RscFailureEvent } from "@/lib/rsc-fetch-guard";

/**
 * #118: makes a previously-invisible 5xx visible. See
 * `lib/rsc-fetch-guard.ts` for the full mechanism and its own honesty
 * notes about what this does and does not fix -- in short, it does not
 * explain or prevent the 5xx, and for a navigation fetch it does not
 * guarantee the page you're looking at is the retried/fresh data (Next's
 * prefetch cache may already have rendered from an earlier successful
 * request); it only turns silence into a plain, dismissible message.
 *
 * Two message shapes because the two failure kinds carry different risk:
 * a Server Action write may or may not have completed server-side before
 * the 5xx, so its message says not to resubmit before checking --
 * matching (app)/error.tsx's existing pattern for #19. A failed
 * navigation fetch is a read; its message only says the page might not be
 * current.
 *
 * RENDERS NOTHING until the guard actually fires, same shape as
 * StaleDeployBanner -- no markup to disagree about on a normal page.
 */
export function RscFailureBanner() {
  const [event, setEvent] = useState<RscFailureEvent | null>(null);

  useEffect(() => {
    return installRscFailureGuard((e) => setEvent((prev) => prev ?? e));
  }, []);

  if (!event) return null;

  const message =
    event.kind === "server-action"
      ? "The last action you took may not have completed -- the server did not respond normally. Reload and check before trying again."
      : "This page may not be showing the latest data -- a background request to refresh it failed. Reload to make sure.";

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-950 px-4 py-3 text-center text-sm text-amber-100"
    >
      <span>{message}</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-500"
      >
        Reload now
      </button>
      <button
        onClick={() => setEvent(null)}
        className="rounded-md border border-amber-500/60 px-3 py-1 font-medium text-amber-100 hover:bg-amber-900"
      >
        Dismiss
      </button>
    </div>
  );
}

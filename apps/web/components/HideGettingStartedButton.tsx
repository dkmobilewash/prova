"use client";

import { useState, useTransition } from "react";
import { hideGettingStarted } from "@/lib/actions";

/**
 * "Hide this" on the getting-started card.
 *
 * HYDRATION: this component's first render depends on nothing but its
 * initial state (not pending, no error), which is the same on the server
 * and in the browser. It never reads `document.cookie`. Whether the card
 * exists at all was already decided on the server from the request cookie;
 * after the action sets it, the server re-renders /dashboard and the card
 * is simply not in the new payload.
 */
export function HideGettingStartedButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleHide() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await hideGettingStarted();
        if (!result.ok) setError(result.error);
      } catch {
        setError("Could not hide this. Reload the page and try again.");
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleHide}
        disabled={isPending}
        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-ink-body hover:text-ink hover:underline disabled:opacity-50"
      >
        {isPending ? "Hiding…" : "Hide this"}
      </button>
      {error && <p className="max-w-[16rem] text-right text-xs text-tag-rose-ink">{error}</p>}
    </div>
  );
}

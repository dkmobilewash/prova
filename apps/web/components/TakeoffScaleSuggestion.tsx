"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import type { SuggestedScale } from "@/lib/takeoff/suggestedScale";

/**
 * A scale read off the doors, offered and never applied: a wrong one multiplies
 * through every wall on the sheet, so only the Confirm press saves anything.
 */
export function TakeoffScaleSuggestion({
  suggestion,
  onConfirm,
  onDismiss,
}: {
  suggestion: SuggestedScale;
  /** Resolves to a sentence when it did not save. */
  onConfirm: () => Promise<string | null>;
  onDismiss: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setSaving(true);
    setError(await onConfirm());
    setSaving(false);
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-body" data-takeoff="scale-suggestion">
      <span>
        Suggested {suggestion.scaleName} from {suggestion.because}: confirm?
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={() => void confirm()}
        className="rounded-md bg-brand px-2 py-0.5 font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        data-takeoff="confirm-suggested-scale"
      >
        {saving ? (
          <>
            <Spinner /> Saving…
          </>
        ) : (
          "Confirm"
        )}
      </button>
      <button type="button" disabled={saving} onClick={onDismiss} className="underline hover:text-ink-body" data-takeoff="dismiss-suggested-scale">
        Not this
      </button>
      {error !== null && <span className="text-tag-amber-ink">{error}</span>}
    </div>
  );
}

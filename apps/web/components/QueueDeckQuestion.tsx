"use client";

import { useState } from "react";
import { parseFeetInches } from "@/lib/feet-inches";
import { feetLabel } from "@/lib/takeoff/wallHeight";
import type { DeckItem } from "@/lib/takeoff/deckQuestion";

/**
 * ── "WALLS GO TO DECK: DECK HEIGHT?" (`deckQuestion.ts`) ──
 *
 * One press: the box is pre-filled with what C-Stream read (or the company's usual height), its
 * source under it, and Enter puts it on every to-deck wall of the job. A typed height wins.
 */
export function QueueDeckQuestion({ item, onAnswer, onSkip }: { item: DeckItem; onAnswer: (feet: number) => void; onSkip: () => void }) {
  const [typed, setTyped] = useState(item.prefill === null ? "" : feetLabel(item.prefill.feet));
  const [error, setError] = useState<string | null>(null);
  const button = "min-h-[32px] rounded-md border border-line-card px-3 text-xs font-medium text-ink-body hover:bg-rail disabled:opacity-50";
  return (
    <form
      className="flex flex-col gap-1"
      data-takeoff="review-queue-deck"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseFeetInches(typed, { label: "Deck height", min: 0 });
        if (!parsed.ok) return setError(parsed.error);
        if (parsed.n <= 0) return setError("Type the deck height first.");
        onAnswer(parsed.n);
      }}
    >
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
        Walls go to deck: deck height?
        <input
          inputMode="decimal"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={`14'-0"`}
          aria-label="Deck height"
          data-takeoff="review-queue-deck-height"
          className="w-20 rounded-md border border-line-card bg-surface px-1.5 py-0.5 text-sm text-ink-body"
        />
        <button type="submit" className={`${button} border-brand`} data-takeoff="review-queue-deck-accept" disabled={typed.trim() === ""}>
          Use for all {item.walls} to-deck wall{item.walls === 1 ? "" : "s"}
        </button>
        <button type="button" className={button} onClick={onSkip}>
          Skip
        </button>
      </label>
      <p className="text-xs text-ink-muted" data-takeoff="review-queue-deck-source">
        {item.prefill === null ? "No deck elevation, floor-to-floor or bearing line read from the drawings, and no usual height set." : `From ${item.prefill.from}. No deck elevation is printed on the set.`}
      </p>
      {error !== null && (
        <span role="alert" className="text-xs text-tag-rose-ink">
          {error}
        </span>
      )}
    </form>
  );
}

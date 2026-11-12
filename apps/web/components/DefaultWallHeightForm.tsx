"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWallHeightAnswer } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import { WALL_HEIGHT_CONVENTION_LABELS, WALL_HEIGHT_CONVENTIONS, type WallHeightConvention } from "@/lib/takeoff/heightsByCode";

/**
 * "Your interior partitions usually go": the company's answer for a wall the drawing gives no height
 * (`heightsByCode.ts`, level 3) — and its fixed height, which "a fixed height" is and the other two
 * fall back to. Its own form and action; the figure is text with a decimal keypad, never
 * `type="number"` (the openings entry in CLAUDE.md); nothing `required`, because not answering is an answer.
 */
export function DefaultWallHeightForm({ convention, feet, isOwner }: { convention: WallHeightConvention | null; feet: number | null; isOwner: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-col gap-3" data-settings="wall-height-answer">
      <p className="text-sm text-ink-body">
        Where the drawing gives a wall no height, the bid uses your answer here, marks it as assumed on the estimate, and bid check asks you to confirm it. A height the
        drawing prints always comes first.
      </p>
      {!isOwner ? (
        <p className="text-sm text-ink">
          {convention === null ? "Not answered" : WALL_HEIGHT_CONVENTION_LABELS[convention]}
          {feet === null ? "" : ` · ${feet} ft`}
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            setSaved(false);
            startTransition(async () => {
              try {
                const result = await saveWallHeightAnswer(formData);
                if (!result.ok) return setError(result.error);
                setSaved(true);
                router.refresh();
              } catch {
                setError("That didn't save. Reload the page and try again.");
              }
            });
          }}
        >
          <fieldset>
            <legend className="mb-1 text-sm text-ink-label">Your interior partitions usually go</legend>
            <div className="flex flex-col gap-2">
              {WALL_HEIGHT_CONVENTIONS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="wallHeightConvention" value={c} defaultChecked={convention === c} className="h-4 w-4 shrink-0" />
                  {WALL_HEIGHT_CONVENTION_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-ink">
            Your usual height
            <input
              name="defaultWallHeightFt"
              type="text"
              inputMode="decimal"
              defaultValue={feet === null ? "" : String(feet)}
              placeholder="not set"
              className="min-h-11 w-24 rounded-md border border-line-card bg-canvas px-2 text-sm text-ink"
            />
            ft <span className="text-xs text-ink-muted">(the fixed height, and what the other two use where the drawing gives them nothing)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? <Spinner /> : "Save"}
            </button>
            {saved && !isPending && <span className="text-sm text-ink-muted">Saved.</span>}
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

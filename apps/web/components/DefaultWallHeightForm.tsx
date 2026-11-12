"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDefaultWallHeight } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";

/**
 * The company's default wall height: what a wall is ASSUMED to be when the drawing gives it none
 * (`heightsByCode.ts`, level 3). Its own form and action; text with a decimal keypad, never
 * `type="number"` (the openings entry in CLAUDE.md); no `required`, because blank (not set) is an answer.
 */
export function DefaultWallHeightForm({ feet, isOwner }: { feet: number | null; isOwner: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-col gap-3" data-settings="default-wall-height">
      <p className="text-sm text-ink-body">
        Where the drawing gives a wall no height, the bid uses this one, marks it as assumed on the estimate, and bid check asks you to confirm it. Heights the
        drawing prints always come first.
      </p>
      {!isOwner ? (
        <p className="text-sm text-ink">{feet === null ? "Not set: such walls have no height until somebody gives them one." : `${feet} ft`}</p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            setSaved(false);
            startTransition(async () => {
              try {
                const result = await saveDefaultWallHeight(formData);
                if (!result.ok) return setError(result.error);
                setSaved(true);
                router.refresh();
              } catch {
                setError("That didn't save. Reload the page and try again.");
              }
            });
          }}
        >
          <label className="flex items-center gap-2 text-sm text-ink">
            Default wall height
            <input
              name="defaultWallHeightFt"
              type="text"
              inputMode="decimal"
              defaultValue={feet === null ? "" : String(feet)}
              placeholder="not set"
              className="min-h-11 w-24 rounded-md border border-line-card bg-canvas px-2 text-sm text-ink"
            />
            ft
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            {isPending ? <Spinner /> : "Save"}
          </button>
          {saved && !isPending && <span className="text-sm text-ink-muted">Saved.</span>}
          {error && (
            <p role="alert" className="w-full rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDoorScope } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import { DOOR_SCOPE_LABELS, DOOR_SCOPES, type DoorScope } from "@/lib/estimating/doorLines";

/**
 * "Doors and frames": who installs the doors a set shows (`Company.doorScope`). Its own form and
 * action, as the openings question is, so no other field's validation can stop it saving; no
 * `required`, because every option, the default included, is an answer.
 */
export function DoorScopeForm({ answer, isOwner }: { answer: DoorScope; isOwner: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-col gap-3" data-settings="door-scope">
      <p className="text-sm text-ink-body">
        When a door is posted on a takeoff, does it go on the bid? Installed doors add their labor at your production rates and, for framing, the
        opening&apos;s header, king and jack studs from your partition&apos;s own studs and track.
      </p>
      {!isOwner ? (
        <p className="text-sm text-ink">{DOOR_SCOPE_LABELS[answer]}</p>
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
                const result = await saveDoorScope(formData);
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
            <legend className="mb-1 text-sm text-ink-label">Doors and frames</legend>
            <div className="flex flex-col gap-2">
              {DOOR_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="doorScope" value={scope} defaultChecked={answer === scope} className="h-4 w-4 shrink-0" />
                  {DOOR_SCOPE_LABELS[scope]}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="rounded-md border border-red-700 bg-tag-rose px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
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
        </form>
      )}
    </div>
  );
}

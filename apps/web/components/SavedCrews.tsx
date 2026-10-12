"use client";

import { useState, useTransition, type RefObject } from "react";
import { archiveCrew, renameCrew, saveCrew } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { Spinner } from "@/components/Spinner";

/**
 * Saved crews on the schedule's "Put someone on" form.
 *
 * A crew only TICKS CHECKBOXES. Picking one sets the form's "Who" boxes to
 * exactly that crew's people, client-side; the person can still untick or
 * add anyone, and the bulk schedule action receives the ticked people as it
 * always has. That is why a crew can be renamed, re-saved or archived
 * without touching a single planned day.
 *
 * Every action RETURNS its failure and this renders it — production
 * redacts a thrown Server Action message.
 */

/** One saved crew, its people as the same `user:<id>` / `crew:<id>` values
 * the form's checkboxes carry. */
export type SavedCrew = { id: string; name: string; members: string[] };

/** Ticks exactly `members` among the form's "worker" checkboxes. A member
 * with no box (archived since the crew was saved) is simply not ticked. */
export function tickCrew(form: HTMLFormElement, members: readonly string[]) {
  const wanted = new Set(members);
  for (const box of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="worker"]')) {
    box.checked = wanted.has(box.value);
  }
}

const fieldClass = "mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink";
const smallBtn =
  "inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50 mouse:min-h-9";
// Its own string, not smallBtn plus overrides: two border colours in one
// class list resolve by stylesheet order, not by which is written last.
const confirmBtn =
  "inline-flex min-h-11 items-center rounded-md border border-red-500 px-3 text-sm text-danger hover:bg-tag-rose disabled:opacity-50 mouse:min-h-9";

/** The "Crew" picker, inside the schedule form. */
export function CrewPicker({ crews, formRef }: { crews: SavedCrew[]; formRef: RefObject<HTMLFormElement | null> }) {
  if (crews.length === 0) return null;
  return (
    <label className="block text-sm">
      <span className="text-ink-label">Crew (ticks its people)</span>
      <select
        // Not submitted: the schedule action reads only the ticked boxes.
        aria-label="Crew"
        defaultValue=""
        onChange={(event) => {
          const crew = crews.find((c) => c.id === event.target.value);
          if (crew && formRef.current) tickCrew(formRef.current, crew.members);
        }}
        className={fieldClass}
      >
        <option value="">Pick a saved crew…</option>
        {crews.map((crew) => (
          <option key={crew.id} value={crew.id}>
            {crew.name} ({crew.members.length})
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Save these people as a crew" — reads the ticked boxes off the schedule
 * form. A button, not a nested form: forms cannot nest. */
export function SaveCrew({ formRef }: { formRef: RefObject<HTMLFormElement | null> }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="text-sm">
      <label className="block">
        <span className="text-ink-label">Save the ticked people as a crew (optional)</span>
        <input name="crewName" maxLength={60} placeholder="e.g. Ray's hanging crew" className={fieldClass} />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!formRef.current) return;
          const formData = new FormData(formRef.current);
          setMessage(null);
          startTransition(async () => {
            const result = await saveCrew(formData);
            setMessage(
              result.ok
                ? { ok: true, text: `Saved crew "${String(formData.get("crewName")).trim()}".` }
                : { ok: false, text: result.error },
            );
          });
        }}
        className={`${smallBtn} mt-2`}
      >
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Saving…
          </span>
        ) : (
          "Save these people as a crew"
        )}
      </button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-1 ${message.ok ? "text-ink" : "text-tag-rose-ink"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function CrewRow({ crew, canArchive }: { crew: SavedCrew; canArchive: boolean }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="py-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => renameCrew(crew.id, formData), () => setEditing(false));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="min-w-0 flex-1 text-sm">
            <span className="text-ink-label">Crew name</span>
            <input name="crewName" required maxLength={60} defaultValue={crew.name} className={fieldClass} />
          </label>
          <button type="submit" disabled={pending} className={smallBtn}>
            {pending ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner />
                Saving…
              </span>
            ) : (
              "Save"
            )}
          </button>
          <button type="button" disabled={pending} onClick={() => setEditing(false)} className={smallBtn}>
            Cancel
          </button>
        </form>
        {error && <p className="mt-1 text-sm text-tag-rose-ink" role="alert">{error}</p>}
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0 text-sm text-ink">
        {crew.name} <span className="text-ink-muted">· {crew.members.length} {crew.members.length === 1 ? "person" : "people"}</span>
      </span>
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2"
        destructive={
          canArchive ? (
            <ConfirmDelete
              label="Archive"
              confirmLabel="Archive it"
              pendingLabel="Archiving…"
              describe={`Hides ${crew.name} from the crew picker. No planned day changes; saving a crew with the same name brings it back.`}
              pinned="end"
              pending={pending}
              onConfirm={() => run(() => archiveCrew(crew.id))}
              deleteClassName={smallBtn}
              cancelClassName={smallBtn}
              confirmClassName={confirmBtn}
            />
          ) : null
        }
      >
        <button type="button" disabled={pending} onClick={() => setEditing(true)} className={smallBtn}>
          Rename
        </button>
      </RowActions>
      {error && <p className="w-full text-sm text-tag-rose-ink" role="alert">{error}</p>}
    </li>
  );
}

/** Rename and archive, behind a disclosure under the form — reading the
 * schedule is the common visit, managing crews is the rare one. */
export function ManageCrews({ crews, canArchive }: { crews: SavedCrew[]; canArchive: boolean }) {
  if (crews.length === 0) return null;
  return (
    <details className="mb-4 rounded-lg border border-line-card bg-surface px-4 py-2" data-testid="manage-crews">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-label">
        Manage saved crews ({crews.length})
      </summary>
      <ul className="divide-y divide-line-row">
        {crews.map((crew) => (
          <CrewRow key={crew.id} crew={crew} canArchive={canArchive} />
        ))}
      </ul>
    </details>
  );
}

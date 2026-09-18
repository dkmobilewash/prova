"use client";

import { useState, useTransition } from "react";
import { createPhaseCode, setPhaseCodeActive, updatePhaseCode } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

/**
 * The company's own cost-coding vocabulary, managed on /settings.
 *
 * A phase code is whatever this contractor writes on their own budget —
 * `04112` / "Plywood - SF". Free text, never checked against MasterFormat:
 * "we can rename our phase codes just so the way they appear in our
 * budget, they look the same", and a product that refuses a code for not
 * being in a standard list is one nobody can enter their own budget into.
 *
 * NOTHING HERE DELETES. Retiring sets `isActive = false`, and a retired
 * code keeps every dollar already coded to it — it is the evidence of how
 * work on an invoiced job was coded. The one-click "Bring back" is the
 * other half of that promise: because nothing was destroyed, retiring the
 * wrong row costs a click rather than a support call.
 */

export type PhaseCodeData = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  tracksLabor: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Line items coded to it, across every job. Derived at read time; the
   * reason it is here is that it turns "Retire" from a guess into a
   * decision — retiring a code with history keeps that history, and the
   * row says how much history there is before you click. */
  lineItemCount: number;
};

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-ink-body";

/**
 * One field set, used by both the add form and the inline edit.
 *
 * Shared rather than duplicated so the two can never drift into accepting
 * different things — an add form that validates something the edit form
 * does not is how a record gets into a state its own form cannot produce.
 */
function PhaseCodeFields({ phaseCode }: { phaseCode?: PhaseCodeData }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className={labelClass}>
        Code
        <input
          name="code"
          required
          defaultValue={phaseCode?.code ?? ""}
          placeholder="04112"
          className={`w-28 ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        Name
        <input
          name="name"
          required
          defaultValue={phaseCode?.name ?? ""}
          placeholder="Plywood - SF"
          className={`w-56 ${inputClass}`}
        />
      </label>

      {/* Nullable on purpose: a phase can be a dollar bucket with no
          natural unit — general conditions, overhead. */}
      <label className={labelClass}>
        Unit
        <input
          name="unit"
          defaultValue={phaseCode?.unit ?? ""}
          placeholder="SF, LF, EA, HR"
          className={`w-28 ${inputClass}`}
        />
      </label>

      {/* The order the company reads them in, which is not alphabetical
          and is not code order either. */}
      <label className={labelClass}>
        Sort order
        <input
          name="sortOrder"
          defaultValue={String(phaseCode?.sortOrder ?? 0)}
          inputMode="numeric"
          className={`w-20 ${inputClass}`}
        />
      </label>

      {/* "Some of these have labor codes, some are just cost codes."
          Recorded, not inferred from: nothing reads it to decide anything
          yet, and it is here so a labour report can tell an unphased hour
          from one that never takes any. */}
      <label className="flex items-center gap-2 pb-2 text-xs text-ink-body">
        <input
          type="checkbox"
          name="tracksLabor"
          defaultChecked={phaseCode?.tracksLabor ?? true}
          className="h-4 w-4 rounded border-line-card bg-canvas"
        />
        Hours are coded to this phase
      </label>
    </div>
  );
}

function PhaseCodeRow({ phaseCode, canManage }: { phaseCode: PhaseCodeData; canManage: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUpdate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updatePhaseCode(phaseCode.id, formData);
      if (result.ok) setIsEditing(false);
      else setError(result.error);
    });
  }

  function handleSetActive(isActive: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setPhaseCodeActive(phaseCode.id, isActive);
      if (!result.ok) setError(result.error);
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form action={handleUpdate} className="flex flex-col gap-3">
          <PhaseCodeFields phaseCode={phaseCode} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
            {error && <p className="text-sm text-tag-rose-ink">{error}</p>}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${phaseCode.isActive ? "text-ink" : "text-ink-muted"}`}>
          {phaseCode.code} — {phaseCode.name}
          {/* Retired reads differently from active at a glance, because a
              retired code still appears in every report it has history on
              and a reader has to be able to tell why it is not on the
              picker. */}
          {!phaseCode.isActive && (
            <span className="ml-2 rounded bg-tag-amber px-1.5 py-0.5 text-xs text-tag-amber-ink">
              Retired
            </span>
          )}
        </p>
        <p className="text-sm text-ink-body">
          {phaseCode.unit ? <>{phaseCode.unit}</> : <>no unit</>}
          {phaseCode.tracksLabor ? <> · takes hours</> : <> · cost only, no hours</>}
          {phaseCode.lineItemCount > 0 ? (
            <> · on {phaseCode.lineItemCount === 1 ? "1 line" : `${phaseCode.lineItemCount} lines`}</>
          ) : (
            <> · no work coded to it yet</>
          )}
        </p>
        {error && <p className="mt-1 text-xs text-tag-rose-ink">{error}</p>}
      </div>

      {canManage &&
        (phaseCode.isActive ? (
          /* Arming Retire empties the rest of this row, and Cancel inherits
             the pixel Retire vacated. This cluster hangs off the right of a
             `justify-between` row, so that pixel is at the END — the same
             geometry as the licences above, measured at 0% confirm overlap
             with `pinned="end"` and 100% with the default. Below `sm` the
             armed pair becomes a full-width column with Cancel on top;
             ConfirmDelete does that itself, so no caller can get it wrong. */
          <RowActions
            className="flex flex-wrap items-center gap-2"
            destructive={
              <ConfirmDelete
                describe="Stops offering this code on new work. Every line already coded to it keeps its code, and it keeps reporting on the phase codes page. Nothing is deleted and you can bring it back."
                label="Retire"
                confirmLabel="Confirm retire"
                pinned="end"
                pendingLabel="Retiring…"
                pending={isPending}
                onConfirm={() => handleSetActive(false)}
                deleteClassName="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:border-red-500 hover:text-red-400 disabled:opacity-50"
                cancelClassName="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
                confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-tag-rose disabled:opacity-50"
              />
            }
          >
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsEditing(true)}
              className="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              Edit
            </button>
          </RowActions>
        ) : (
          /* No confirm step: bringing a code back destroys nothing and is
             itself the undo for the step that needed one. */
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleSetActive(true)}
            title="Offer this code on new work again"
            className="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "Working…" : "Bring back"}
          </button>
        ))}
    </li>
  );
}

export function PhaseCodes({
  phaseCodes,
  canManage,
}: {
  phaseCodes: PhaseCodeData[];
  canManage: boolean;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createPhaseCode(formData);
      if (result.ok) setIsAdding(false);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {phaseCodes.length === 0 ? (
        <p className="text-sm text-ink-body">
          No phase codes yet. Add the codes you already write on your own budget — a number and a
          name, like <span className="text-ink-label">04112 — Plywood - SF</span> — and{" "}
          <span className="text-ink-label">Phase codes</span> can total budget against actual for
          each one across every job you run.
        </p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {phaseCodes.map((phaseCode) => (
            <PhaseCodeRow key={phaseCode.id} phaseCode={phaseCode} canManage={canManage} />
          ))}
        </ul>
      )}

      {canManage &&
        (isAdding ? (
          <form
            action={handleCreate}
            className="flex flex-col gap-3 rounded-lg border border-line-row p-4"
          >
            <PhaseCodeFields />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
              >
                {isPending ? "Adding…" : "Add phase code"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setIsAdding(false);
                  setError(null);
                }}
                className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
              >
                Cancel
              </button>
              {error && <p className="text-sm text-tag-rose-ink">{error}</p>}
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="self-start rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
          >
            Add a phase code
          </button>
        ))}
    </div>
  );
}

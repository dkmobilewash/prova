"use client";

import { useState, useTransition } from "react";
import {
  deleteDrawingRevision,
  deleteDrawingSet,
  recordDrawingRevision,
  updateDrawingRevision,
  updateDrawingSet,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { inputClass, labelClass } from "@/components/RfiFields";
import { DrawingSetFields, type DrawingSetDefaults } from "@/components/DrawingSetFields";
import {
  type RevisionData,
  byNewestFirst,
  currentRevision,
  daysToReachUs,
  setState,
  stateLabel,
} from "@/components/drawingLabels";
import { localToday } from "@/components/localToday";

export type DrawingSetRowData = DrawingSetDefaults & {
  id: string;
  jobName: string;
  revisions: RevisionData[];
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50";

/** The received-date and link fields, shared by "record an issue" and the
 * per-revision edit so the two can't drift. */
function ReceiptFields({ defaults }: { defaults?: Partial<RevisionData> }) {
  return (
    <>
      <label className={labelClass}>
        Date it reached us
        <input
          type="date"
          name="receivedOn"
          defaultValue={defaults?.receivedOn ?? ""}
          className={inputClass}
        />
        <span className="text-xs text-slate-500">
          Leave blank if it hasn&apos;t. That&apos;s the state worth seeing — it means the crew is
          building from paper that&apos;s already superseded.
        </span>
      </label>

      <label className={labelClass}>
        What changed
        <textarea
          name="description"
          rows={2}
          defaultValue={defaults?.description ?? ""}
          placeholder="The reason someone opens this revision later."
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Link to the set
          <input
            type="url"
            name="fileUrl"
            defaultValue={defaults?.fileUrl ?? ""}
            placeholder="https://…"
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            Wherever it actually lives — Procore, Box, the GC&apos;s portal.
          </span>
        </label>
        <label className={labelClass}>
          Link label
          <input
            type="text"
            name="fileName"
            defaultValue={defaults?.fileName ?? ""}
            placeholder="e.g. A-series full set"
            className={inputClass}
          />
        </label>
      </div>
    </>
  );
}

export function DrawingSetRow({
  set,
  today,
  canDelete,
  showJob,
}: {
  set: DrawingSetRowData;
  today: string;
  canDelete: boolean;
  showJob: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "issue">("view");
  const [editingRevisionId, setEditingRevisionId] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [confirmingRevisionId, setConfirmingRevisionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  const ordered = byNewestFirst(set.revisions);
  const current = currentRevision(set.revisions);
  const state = setState(set.revisions);

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => updateDrawingSet(set.id, formData),
              () => setMode("view"),
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">{set.jobName}</p>
          <DrawingSetFields defaults={set} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === "issue") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(
              () => recordDrawingRevision(set.id, formData),
              () => setMode("view"),
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-semibold text-slate-300">Record an issue of {set.name}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Revision label
              <input
                type="text"
                name="label"
                required
                placeholder="e.g. Rev 3, ASI-12, Bulletin 5"
                className={inputClass}
              />
              <span className="text-xs text-slate-500">
                Exactly as printed on the title block. It&apos;s the architect&apos;s label, not ours.
              </span>
            </label>
            <label className={labelClass}>
              Date issued
              <input
                type="date"
                name="issuedOn"
                required
                defaultValue={localToday()}
                className={inputClass}
              />
              <span className="text-xs text-slate-500">
                The date on the drawing itself, not today. This is what decides which one is current.
              </span>
            </label>
          </div>

          <ReceiptFields />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryBtn}>
              {isPending ? "Saving…" : "Record issue"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const stateChip =
    state === "BEHIND"
      ? "bg-red-500/15 text-red-300"
      : state === "CURRENT_IN_HAND"
        ? "bg-green-500/15 text-green-300"
        : "bg-slate-800 text-slate-400";

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-100">{set.name}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${stateChip}`}>{stateLabel(state)}</span>
          {current && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
              Build from {current.label}
            </span>
          )}
        </div>

        {set.description && <p className="mt-1 text-sm text-slate-300">{set.description}</p>}

        {ordered.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-l-2 border-slate-700 pl-3">
            {ordered.map((rev) => {
              const days = daysToReachUs(rev, today);
              const isCurrent = current?.id === rev.id;
              return (
                <li key={rev.id} className="text-xs text-slate-400">
                  {editingRevisionId === rev.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const formData = new FormData(event.currentTarget);
                        run(
                          () => updateDrawingRevision(rev.id, formData),
                          () => setEditingRevisionId(null),
                        );
                      }}
                      className="my-2 flex flex-col gap-3 rounded-md border border-slate-700 p-3"
                    >
                      <p className="text-sm font-semibold text-slate-300">
                        {rev.label} · issued {rev.issuedOn}
                      </p>
                      <ReceiptFields defaults={rev} />
                      {error && <p className="text-sm text-red-400">{error}</p>}
                      <div className="flex gap-2">
                        <button type="submit" disabled={isPending} className={primaryBtn}>
                          {isPending ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => setEditingRevisionId(null)}
                          className={btn}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className={isCurrent ? "font-mono text-slate-300" : "font-mono text-slate-500"}>
                        {rev.label}
                      </span>
                      {` · issued ${rev.issuedOn}`}
                      {rev.receivedOn
                        ? ` · received ${rev.receivedOn}${days !== null ? ` · ${days} day${days === 1 ? "" : "s"} to reach us` : ""}`
                        : ` · NOT RECEIVED${days !== null ? ` · waiting ${days} day${days === 1 ? "" : "s"}` : ""}`}
                      {!isCurrent && " · superseded"}
                      {rev.description && <span className="text-slate-500"> — {rev.description}</span>}
                      {rev.fileUrl && (
                        <a
                          href={rev.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-blue-400 underline"
                        >
                          {rev.fileName || "open"}
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setEditingRevisionId(rev.id);
                          setConfirmingRevisionId(null);
                        }}
                        className="ml-2 text-slate-500 underline disabled:opacity-50"
                      >
                        {rev.receivedOn ? "Edit" : "Mark received"}
                      </button>
                      {canDelete &&
                        (confirmingRevisionId === rev.id ? (
                          <>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => run(() => deleteDrawingRevision(rev.id))}
                              className="ml-2 text-red-400 underline disabled:opacity-50"
                            >
                              {isPending ? "Removing…" : "Confirm remove"}
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setConfirmingRevisionId(null)}
                              className="ml-2 text-slate-400 underline disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setConfirmingRevisionId(rev.id)}
                            className="ml-2 text-slate-500 underline disabled:opacity-50"
                          >
                            Remove
                          </button>
                        ))}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {showJob && <p className="mt-1 text-xs text-blue-400">{set.jobName}</p>}

        {error && !editingRevisionId && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => setMode("issue")}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Record an issue
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setMode("edit");
            setIsConfirmingDelete(false);
          }}
          className={btn}
        >
          Edit
        </button>

        {canDelete &&
          set.revisions.length === 0 &&
          (isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deleteDrawingSet(set.id))}
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className={btn}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className={btn}
            >
              Delete
            </button>
          ))}
      </div>
    </li>
  );
}

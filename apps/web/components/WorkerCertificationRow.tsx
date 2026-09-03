"use client";

import { useState, useTransition } from "react";
import { deleteWorkerCertification, updateWorkerCertification } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { CertificationFields } from "@/components/CertificationFields";
import {
  STANDING_LABELS,
  standingChipClass,
  standingTiming,
  type CertificationRecord,
  type Holding,
  type WorkerStanding,
} from "@/lib/certifications";

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50";

function workerLabel(worker: WorkerStanding["worker"]) {
  return worker.name?.trim() || worker.email;
}

function HoldingBlock({
  holding,
  holderLabel,
  canDelete,
  editingId,
  confirmingId,
  isPending,
  error,
  onEdit,
  onCancelEdit,
  onConfirm,
  onCancelConfirm,
  onSave,
  onDelete,
}: {
  holding: Holding;
  holderLabel: string;
  canDelete: boolean;
  editingId: string | null;
  confirmingId: string | null;
  isPending: boolean;
  error: string | null;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onConfirm: (id: string) => void;
  onCancelConfirm: () => void;
  onSave: (id: string, formData: FormData) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="border-l-2 border-slate-700 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-100">{holding.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${standingChipClass(holding.standing)}`}>
          {STANDING_LABELS[holding.standing]}
        </span>
        <span className="text-xs text-slate-500">{standingTiming(holding)}</span>
        {holding.required && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">required</span>
        )}
      </div>

      {holding.history.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">
          Required of everyone here, and there is no record of it for this person at all. That is
          not the same as expired — nobody has ever entered one.
        </p>
      )}

      <ul className="mt-1 flex flex-col gap-1">
        {holding.history.map((record: CertificationRecord) => {
          const supersededBy = holding.governing && holding.governing.id !== record.id;
          if (editingId === record.id) {
            return (
              <li key={record.id}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSave(record.id, new FormData(event.currentTarget));
                  }}
                  className="my-2 flex flex-col gap-3 rounded-md border border-slate-700 p-3"
                >
                  <p className="text-sm font-semibold text-slate-300">
                    {holding.title} — {holderLabel}
                  </p>
                  <CertificationFields defaults={record} lockedKind={record.kind} />
                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={isPending} className={primaryBtn}>
                      {isPending ? "Saving…" : "Save changes"}
                    </button>
                    <button type="button" disabled={isPending} onClick={onCancelEdit} className={btn}>
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            );
          }

          return (
            <li key={record.id} className="text-xs text-slate-400">
              <span className={supersededBy ? "text-slate-500" : "text-slate-300"}>
                {record.expiresOn ? `expires ${record.expiresOn}` : "no expiry recorded"}
              </span>
              {record.issuedOn && ` · issued ${record.issuedOn}`}
              {record.issuer && ` · ${record.issuer}`}
              {record.referenceNumber && ` · #${record.referenceNumber}`}
              {supersededBy && " · superseded"}
              {record.notes && <span className="text-slate-500"> — {record.notes}</span>}
              {record.documentUrl && (
                <a
                  href={record.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-blue-400 underline"
                >
                  {record.documentLabel || "open"}
                </a>
              )}
              <button
                type="button"
                disabled={isPending}
                onClick={() => onEdit(record.id)}
                className="ml-2 text-slate-500 underline disabled:opacity-50"
              >
                Edit
              </button>
              {canDelete &&
                (confirmingId === record.id ? (
                  <>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onDelete(record.id)}
                      className="ml-2 text-red-400 underline disabled:opacity-50"
                    >
                      {isPending ? "Removing…" : "Confirm remove"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={onCancelConfirm}
                      className="ml-2 text-slate-400 underline disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onConfirm(record.id)}
                    className="ml-2 text-slate-500 underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export function WorkerCertificationRow({
  standing,
  canDelete,
  showEverything,
}: {
  standing: WorkerStanding;
  canDelete: boolean;
  /** False shows only what needs acting on. True shows the whole file,
   * including current cards — what you want open when a GC asks for a
   * person's paperwork. */
  showEverything: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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

  const holdings = showEverything ? standing.holdings : standing.problems;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-100">{workerLabel(standing.worker)}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${standingChipClass(standing.worst)}`}>
          {STANDING_LABELS[standing.worst]}
        </span>
        <span className="text-xs text-slate-500">
          {standing.problems.length === 0
            ? "nothing outstanding"
            : `${standing.problems.length} to sort out`}
        </span>
      </div>

      {holdings.length === 0 ? (
        <p className="text-xs text-slate-500">
          Nothing recorded for this person, and nothing required of everyone yet. Requiring a
          certification below is what turns that from a blank into a finding.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {holdings.map((holding) => (
            <HoldingBlock
              key={holding.key}
              holding={holding}
              holderLabel={workerLabel(standing.worker)}
              canDelete={canDelete}
              editingId={editingId}
              confirmingId={confirmingId}
              isPending={isPending}
              error={error}
              onEdit={(id) => {
                setEditingId(id);
                setConfirmingId(null);
                setError(null);
              }}
              onCancelEdit={() => setEditingId(null)}
              onConfirm={(id) => setConfirmingId(id)}
              onCancelConfirm={() => setConfirmingId(null)}
              onSave={(id, formData) =>
                run(
                  () => updateWorkerCertification(id, formData),
                  () => setEditingId(null),
                )
              }
              onDelete={(id) => run(() => deleteWorkerCertification(id))}
            />
          ))}
        </ul>
      )}

      {error && !editingId && <p className="text-sm text-red-400">{error}</p>}
    </li>
  );
}

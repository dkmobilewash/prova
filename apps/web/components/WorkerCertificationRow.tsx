"use client";

import { useState, useTransition } from "react";
import { deleteWorkerCertification, updateWorkerCertification } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { CertificationFields } from "@/components/CertificationFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import {
  STANDING_LABELS,
  standingChipClass,
  standingTiming,
  type CertificationRecord,
  type Holding,
  type WorkerStanding,
} from "@/lib/certifications";

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:opacity-50";

/* The record line's controls are text links inside a sentence, not pills.
   Named here so the armed pair keeps exactly the look the hand-rolled
   version had — the conversion is about WHERE the arming state lives, and
   is not licence to restyle the row. */
const recordLink = "ml-2 text-ink-muted underline disabled:opacity-50";
const recordLinkCancel = "ml-2 text-ink-body underline disabled:opacity-50";
const recordLinkConfirm = "ml-2 text-red-600 underline disabled:opacity-50";

function workerLabel(worker: WorkerStanding["worker"]) {
  return worker.name?.trim() || worker.email;
}

/** The edit form for one certification record, extracted from the history
 * map so it can hold its own draft hook (hooks can't live in a loop).
 * Keyed by the record id, so two records' edits can never share a draft.
 * `onSave` passes the draft's clear callback through, to run only when the
 * update actually succeeded. */
function CertificationRecordEditForm({
  record,
  title,
  isPending,
  error,
  onSave,
  onCancel,
}: {
  record: CertificationRecord;
  title: string;
  isPending: boolean;
  error: string | null;
  onSave: (id: string, formData: FormData, onSaved: () => void) => void;
  onCancel: () => void;
}) {
  const draft = useFormDraft(`worker-certification:edit:${record.id}`);
  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(record.id, new FormData(event.currentTarget), draft.clear);
      }}
      className="my-2 flex flex-col gap-3 rounded-md border border-line-card p-3"
    >
      <p className="text-sm font-semibold text-ink-label">{title}</p>
      <FormDraftNotice draft={draft} />
      <CertificationFields defaults={record} lockedKind={record.kind} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className={primaryBtn}>
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" disabled={isPending} onClick={onCancel} className={btn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function HoldingBlock({
  holding,
  holderLabel,
  canDelete,
  editingId,
  isPending,
  error,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  holding: Holding;
  holderLabel: string;
  canDelete: boolean;
  editingId: string | null;
  isPending: boolean;
  error: string | null;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSave: (id: string, formData: FormData, onSaved: () => void) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="border-l-2 border-line-card pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink">{holding.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${standingChipClass(holding.standing)}`}>
          {STANDING_LABELS[holding.standing]}
        </span>
        <span className="text-xs text-ink-muted">{standingTiming(holding)}</span>
        {holding.required && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-ink-body">required</span>
        )}
      </div>

      {holding.history.length === 0 && (
        <p className="mt-1 text-xs text-ink-muted">
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
                <CertificationRecordEditForm
                  record={record}
                  title={`${holding.title} — ${holderLabel}`}
                  isPending={isPending}
                  error={error}
                  onSave={onSave}
                  onCancel={onCancelEdit}
                />
              </li>
            );
          }

          return (
            <li key={record.id} className="text-xs text-ink-body">
              <span className={supersededBy ? "text-ink-muted" : "text-ink-label"}>
                {record.expiresOn ? `expires ${record.expiresOn}` : "no expiry recorded"}
              </span>
              {record.issuedOn && ` · issued ${record.issuedOn}`}
              {record.issuer && ` · ${record.issuer}`}
              {record.referenceNumber && ` · #${record.referenceNumber}`}
              {supersededBy && " · superseded"}
              {record.notes && <span className="text-ink-muted"> — {record.notes}</span>}
              {/* Arming "Remove" empties this record line of everything else.
                  Both ordinary controls — the document link and "Edit" — are
                  children of RowActions, so neither survives beside the armed
                  confirm, and neither does whatever gets added here next. This
                  row hand-rolled the two-step delete because #88 was written
                  before #176 landed; the census in `rowActionsCensus.test.ts`
                  is what caught it.

                  The `end` pinning below is MEASURED, and it is a lesser
                  evil rather than a fix. Chromium, classes extracted from
                  this file, the app's w-16 rail and max-w-4xl container;
                  overlap of the armed Confirm against the box "Remove"
                  vacated:

                      1100px   default 100%   with `end` 54%
                       375px   default   0%   with `end` 54%

                  Neither value reaches 0% on desktop, because this cluster
                  is the shape `pinned` cannot solve: the delete is the LAST
                  control in a LEFT-flowing inline cluster, so hiding the
                  document link and Edit reflows the armed pair leftwards and
                  nothing is left holding the delete's pixel. Same mechanism
                  as issue #184, which is filed against the stacked rows.
                  `end` is taken because it is right on the DESKTOP case —
                  100% -> 54% — which is how the rows merged in #176 and #89
                  resolved the same trade. The phone regresses 0% -> 54% and
                  wants the layout change #184 is about, not another value of
                  this prop. It also happens to keep the order this row
                  already rendered: [Confirm remove][Cancel]. */}
              <RowActions
                as="span"
                destructive={
                  canDelete ? (
                    <ConfirmDelete
                      pinned="end"
                      label="Remove"
                      confirmLabel="Confirm remove"
                      pendingLabel="Removing…"
                      pending={isPending}
                      onConfirm={() => onDelete(record.id)}
                      deleteClassName={recordLink}
                      cancelClassName={recordLinkCancel}
                      confirmClassName={recordLinkConfirm}
                    />
                  ) : null
                }
              >
                {record.documentUrl && (
                  <a
                    href={record.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-link underline"
                  >
                    {record.documentLabel || "open"}
                  </a>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onEdit(record.id)}
                  className={recordLink}
                >
                  Edit
                </button>
              </RowActions>
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
  /* `editingId` stays: it drives the inline edit form, which is a different
     job from arming a delete. The `confirmingId` that used to sit beside it
     is gone — each record's <RowActions> owns its own arming now, so there is
     no keyed arming state to keep in sync with anything. */
  const [editingId, setEditingId] = useState<string | null>(null);
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
        <span className="text-ink">{workerLabel(standing.worker)}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${standingChipClass(standing.worst)}`}>
          {STANDING_LABELS[standing.worst]}
        </span>
        <span className="text-xs text-ink-muted">
          {standing.problems.length === 0
            ? "nothing outstanding"
            : `${standing.problems.length} to sort out`}
        </span>
      </div>

      {holdings.length === 0 ? (
        <p className="text-xs text-ink-muted">
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
              isPending={isPending}
              error={error}
              onEdit={(id) => {
                setEditingId(id);
                setError(null);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSave={(id, formData, onSaved) =>
                run(
                  () => updateWorkerCertification(id, formData),
                  () => {
                    onSaved();
                    setEditingId(null);
                  },
                )
              }
              onDelete={(id) => run(() => deleteWorkerCertification(id))}
            />
          ))}
        </ul>
      )}

      {error && !editingId && <p className="text-sm text-red-600">{error}</p>}
    </li>
  );
}

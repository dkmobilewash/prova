"use client";

import { useState, useTransition } from "react";
import { deleteEmployerBurdenRate, updateEmployerBurdenRate } from "@/lib/actions";
import { EmployerBurdenRateFields } from "@/components/EmployerBurdenRateFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import { employerBurdenPercentText, type EmployerBurdenRateRecord } from "@/lib/employer-burden";

/** Where this row stands against today — derived by the page from
 * `employerBurdenStanding`, never stored on the row. */
export type EmployerBurdenRateStanding = "current" | "upcoming" | "past";

const STANDING_LABEL: Record<EmployerBurdenRateStanding, string> = {
  current: "in force",
  upcoming: "not yet in effect",
  past: "earlier period",
};

const STANDING_CHIP: Record<EmployerBurdenRateStanding, string> = {
  current: "bg-tag-green text-tag-green-ink",
  upcoming: "bg-neutral-800 text-ink-body",
  past: "bg-neutral-800 text-ink-muted",
};

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50";

function EditForm({
  record,
  isPending,
  error,
  onSave,
  onCancel,
}: {
  record: EmployerBurdenRateRecord;
  isPending: boolean;
  error: string | null;
  onSave: (formData: FormData, onSaved: () => void) => void;
  onCancel: () => void;
}) {
  const draft = useFormDraft(`employer-burden-rate:edit:${record.id}`);
  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(new FormData(event.currentTarget), draft.clear);
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-sm font-semibold text-ink-label">
        Rate effective from {record.effectiveDate}
      </p>
      <p className="text-xs text-ink-muted">
        The effective date can&apos;t be changed — moving it would re-cost hours in a period nobody
        asked about. A rate recorded against the wrong date is removed and recorded again.
      </p>
      <FormDraftNotice draft={draft} />
      <EmployerBurdenRateFields defaults={record} showEffectiveDate={false} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" disabled={isPending} onClick={onCancel} className={btn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function EmployerBurdenRateRow({
  record,
  standing,
  canDelete,
}: {
  record: EmployerBurdenRateRecord;
  standing: EmployerBurdenRateStanding;
  canDelete: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isEditing) {
    return (
      <li className="p-4">
        <EditForm
          record={record}
          isPending={isPending}
          error={error}
          onCancel={() => {
            setIsEditing(false);
            setError(null);
          }}
          onSave={(formData, onSaved) => {
            setError(null);
            startTransition(async () => {
              const result = await updateEmployerBurdenRate(record.id, formData);
              if (result.ok) {
                onSaved();
                setIsEditing(false);
              } else {
                setError(result.error);
              }
            });
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink">{employerBurdenPercentText(record.percent)}%</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${STANDING_CHIP[standing]}`}>
            {STANDING_LABEL[standing]}
          </span>
          <span className="text-xs text-ink-body">from {record.effectiveDate}</span>
        </div>
        {record.note && <p className="mt-1 text-sm text-ink-body">{record.note}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Right-pinned (`shrink-0` beside a flex-1 body), so `pinned="end"`:
          the LAST control keeps its position, and Cancel renders last, so the
          confirm never lands on the pixel Delete vacated. Below sm
          ConfirmDelete stacks the armed pair itself, Cancel on top (#184).
          The delete label stays short — "Remove", 6 characters — because a
          long one makes the armed pair narrower than the button it replaced
          and the confirm drifts back under the old centre (#265). */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-3"
        destructive={
          canDelete ? (
            <ConfirmDelete
              describe="Removes this burden rate. Hours already logged in the period it covered stop carrying it, so cost to date on those jobs goes DOWN — this is not a display setting."
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  const result = await deleteEmployerBurdenRate(record.id);
                  if (!result.ok) setError(result.error);
                });
              }}
              deleteClassName="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:border-red-500 hover:text-red-400 disabled:opacity-50"
              cancelClassName={btn}
              confirmClassName="inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsEditing(true);
            setError(null);
          }}
          className={btn}
        >
          Edit
        </button>
      </RowActions>
    </li>
  );
}

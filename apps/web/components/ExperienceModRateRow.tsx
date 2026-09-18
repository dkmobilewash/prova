"use client";

import { useState, useTransition } from "react";
import { deleteExperienceModRate, updateExperienceModRate } from "@/lib/actions";
import { ExperienceModRateFields } from "@/components/ExperienceModRateFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import type { EmrRecord } from "@/lib/emr";

/** Where this row stands against today — derived by the page from
 * `emrStanding`, never stored on the row. */
export type ExperienceModRateStanding = "current" | "upcoming" | "past";

const STANDING_LABEL: Record<ExperienceModRateStanding, string> = {
  current: "current",
  upcoming: "not yet in effect",
  past: "earlier year",
};

const STANDING_CHIP: Record<ExperienceModRateStanding, string> = {
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
  record: EmrRecord;
  isPending: boolean;
  error: string | null;
  onSave: (formData: FormData, onSaved: () => void) => void;
  onCancel: () => void;
}) {
  const draft = useFormDraft(`experience-mod-rate:edit:${record.id}`);
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
      <p className="text-sm font-semibold text-ink-label">Rate effective {record.effectiveDate}</p>
      <p className="text-xs text-ink-muted">
        The effective date can&apos;t be changed. A rate recorded against the wrong year is removed and recorded
        again.
      </p>
      <FormDraftNotice draft={draft} />
      <ExperienceModRateFields defaults={record} showEffectiveDate={false} />
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

export function ExperienceModRateRow({
  record,
  standing,
  canDelete,
}: {
  record: EmrRecord;
  standing: ExperienceModRateStanding;
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
              const result = await updateExperienceModRate(record.id, formData);
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
          <span className="text-ink">{record.rate}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${STANDING_CHIP[standing]}`}>
            {STANDING_LABEL[standing]}
          </span>
          <span className="text-xs text-ink-body">effective {record.effectiveDate}</span>
        </div>
        <p className="mt-1 text-xs text-ink-body">
          Issued by {record.source}
          {record.sourceUrl && (
            <>
              {" · "}
              <a href={record.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-link underline">
                worksheet
              </a>
            </>
          )}
        </p>
        {record.note && <p className="mt-1 text-sm text-ink-body">{record.note}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Right-pinned (`shrink-0` beside a flex-1 body), so `pinned="end"`:
          the LAST control keeps its position, and Cancel renders last. Below
          sm ConfirmDelete stacks the armed pair itself, Cancel on top (#184). */}
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-3"
        destructive={
          canDelete ? (
            <ConfirmDelete
              describe="Removes this rate from your records. The bureau's worksheet is not affected — only what this app can tell a GC."
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  const result = await deleteExperienceModRate(record.id);
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

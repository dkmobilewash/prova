"use client";

import { useState, useTransition } from "react";
import { createEquipmentRate, deleteEquipmentRate, updateEquipmentRate } from "@/lib/actions";
import { EquipmentRateFields } from "@/components/EquipmentRateFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import { Spinner } from "@/components/Spinner";
import { money } from "@/lib/money";
import { rateStanding, unitLabel, type EquipmentRateRow } from "@/lib/equipment-rates";

const primary = "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50";
const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50";

function SaveButton({ isPending, label }: { isPending: boolean; label: string }) {
  return (
    <button type="submit" disabled={isPending} className={primary}>
      {isPending ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner />
          Saving…
        </span>
      ) : (
        label
      )}
    </button>
  );
}

export function EquipmentRateForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("equipment-rate:create");

  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)} className={primary}>
        Add a rate
      </button>
    );
  }

  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createEquipmentRate(formData);
          if (result.ok) {
            draft.clear();
            draft.resetForm();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <FormDraftNotice draft={draft} />
      <EquipmentRateFields />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <SaveButton isPending={isPending} label="Save rate" />
        <button type="button" disabled={isPending} onClick={() => setIsOpen(false)} className={btn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function EquipmentRateRowView({ rate, today, canDelete }: { rate: EquipmentRateRow; today: string; canDelete: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isEditing) {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await updateEquipmentRate(rate.id, formData);
              if (result.ok) setIsEditing(false);
              else setError(result.error);
            });
          }}
          className="flex flex-col gap-3"
        >
          <EquipmentRateFields defaults={rate} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <SaveButton isPending={isPending} label="Save changes" />
            <button type="button" disabled={isPending} onClick={() => setIsEditing(false)} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="text-ink">
          {rate.name}: {money(rate.rate)} per {unitLabel(rate.unit)}
        </p>
        <p className="text-xs text-ink-muted">
          {rateStanding(rate, today)} · from {rate.effectiveFrom}
          {rate.effectiveTo ? ` to ${rate.effectiveTo}` : ""}
          {rate.notes ? ` · ${rate.notes}` : ""}
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <RowActions
        className="flex shrink-0 flex-wrap items-center justify-end gap-2"
        destructive={
          canDelete ? (
            <ConfirmDelete
              pinned="end"
              pending={isPending}
              onConfirm={() =>
                startTransition(async () => {
                  const result = await deleteEquipmentRate(rate.id);
                  if (!result.ok) setError(result.error);
                })
              }
              describe="Removes this rate. Change orders already written keep their figures."
              label="Remove"
              confirmLabel="Remove it"
            />
          ) : undefined
        }
      >
        <button type="button" onClick={() => setIsEditing(true)} className={btn}>
          Edit
        </button>
      </RowActions>
    </li>
  );
}

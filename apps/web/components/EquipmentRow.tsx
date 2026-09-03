"use client";

import { useState, useTransition } from "react";
import { deleteEquipment, updateEquipment } from "@/lib/actions";
import { EquipmentFields, type EquipmentFieldValues, type JobOption } from "@/components/EquipmentFields";

// One definition for the row's controls so they can't drift back under 44px a
// button at a time. `inline-flex` + `items-center` is what makes min-h centre
// the label rather than pin it to the top.
const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const rowBtnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const rowBtnConfirm =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-500 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50";

type EquipmentRowProps = {
  canDelete: boolean;
  jobs: JobOption[];
  item: EquipmentFieldValues & { id: string; assignedJobName: string | null };
};

export function EquipmentRow({ canDelete, jobs, item }: EquipmentRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await updateEquipment(item.id, formData);
        setIsEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save changes");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteEquipment(item.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete equipment");
        setIsConfirmingDelete(false);
      }
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <EquipmentFields jobs={jobs} defaults={item} />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const detail = [item.type, item.assetTag].filter(Boolean).join(" · ");

  return (
    // Stacks on a phone. Measured at 375px, the single-row layout gave the
    // equipment NAME a 14.6px column once the three confirm-delete buttons
    // appeared — you could not read what you were about to delete.
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-slate-100">{item.name}</p>
        {detail && <p className="text-sm text-slate-400">{detail}</p>}
        {/* slate-400 rather than slate-500: measured 3.83:1 on the slate-900
            card, under the 4.5 text floor. Where a thing is, is the reason
            this page exists. */}
        <p className={item.assignedJobName ? "text-xs text-blue-400" : "text-xs text-slate-400"}>
          {item.assignedJobName ? `On ${item.assignedJobName}` : "In the yard"}
        </p>
        {item.notes && <p className="mt-1 text-sm text-slate-400">{item.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsEditing(true);
            setIsConfirmingDelete(false);
          }}
          className={rowBtn}
        >
          Edit
        </button>

        {canDelete &&
          (isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={handleDelete}
                className={rowBtnConfirm}
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className={rowBtn}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className={rowBtnDanger}
            >
              Remove
            </button>
          ))}
      </div>
    </li>
  );
}

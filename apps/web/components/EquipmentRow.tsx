"use client";

import { useState, useTransition } from "react";
import { deleteEquipment, updateEquipment } from "@/lib/actions";
import { EquipmentFields, type EquipmentFieldValues, type JobOption } from "@/components/EquipmentFields";

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

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
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
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-100">{item.name}</p>
        {detail && <p className="text-sm text-slate-400">{detail}</p>}
        <p className={item.assignedJobName ? "text-xs text-blue-400" : "text-xs text-slate-500"}>
          {item.assignedJobName ? `On ${item.assignedJobName}` : "In the yard"}
        </p>
        {item.notes && <p className="mt-1 text-sm text-slate-500">{item.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsEditing(true);
            setIsConfirmingDelete(false);
          }}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
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
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
            >
              Remove
            </button>
          ))}
      </div>
    </li>
  );
}

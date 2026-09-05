"use client";

import { useState, useTransition } from "react";
import { deleteVendor, updateVendor } from "@/lib/actions";
import { tradeScopeLabel } from "@/components/tradeScopeLabels";
import { VendorFields, type VendorFieldValues } from "@/components/VendorFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

type VendorRowProps = {
  canDelete: boolean;
  vendor: VendorFieldValues & { id: string };
};

/** Three states: reading, editing, and confirming a delete. Delete asks
 * twice on purpose — a misclick that silently destroys a record you typed by
 * hand is the wrong default. A two-step button rather than window.confirm(),
 * which is blocked in some embedded browsers and can't be styled.
 *
 * Edit no longer sits next to the armed confirm: the cluster is a
 * <RowActions>, which renders none of its ordinary actions while a delete is
 * armed, so the click after the one you meant to stop at cannot open the
 * edit form. Issue #152. */
export function VendorRow({ canDelete, vendor }: VendorRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const trade = tradeScopeLabel(vendor.tradeScope);
  const contactLine = [vendor.contactName, vendor.phone, vendor.email].filter(Boolean).join(" · ");

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await updateVendor(vendor.id, formData);
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
        await deleteVendor(vendor.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete vendor");
      }
    });
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <VendorFields defaults={vendor} />

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

  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-100">{vendor.name}</p>
        {trade && <p className="text-xs text-blue-400">{trade}</p>}
        <p className="text-sm text-slate-400">{contactLine || "No contact info"}</p>
        {vendor.notes && <p className="mt-1 text-sm text-slate-500">{vendor.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <RowActions
        className="flex shrink-0 items-center gap-2"
        destructive={
          canDelete ? (
            <ConfirmDelete
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={handleDelete}
              deleteClassName="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
              cancelClassName="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => setIsEditing(true)}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Edit
        </button>
      </RowActions>
    </li>
  );
}

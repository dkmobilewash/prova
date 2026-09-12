"use client";

import { useState, useTransition } from "react";
import { deleteVendor, updateVendor } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { tradeScopeLabel } from "@/components/tradeScopeLabels";
import { VendorFields, type VendorFieldValues } from "@/components/VendorFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

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
  // Keyed by the vendor id so two rows' edit forms can never share a draft.
  const draft = useFormDraft(`vendor:edit:${vendor.id}`);

  const trade = tradeScopeLabel(vendor.tradeScope);
  const contactLine = [vendor.contactName, vendor.phone, vendor.email].filter(Boolean).join(" · ");

  /** Runs an action and renders the sentence it refuses with.
   *
   * Was two try/catch blocks over `err.message`, which in production is
   * React's "the specific message is omitted in production builds"
   * paragraph rather than anything this app wrote. These actions return
   * their refusals now — including the one that matters most here: a vendor
   * with material orders against it CANNOT be deleted (the foreign key is
   * RESTRICT), and until now the Remove button simply appeared to do
   * nothing. Same shape as `SubmittalRow`. */
  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // Draft cleared and form closed on the OK branch only, so a refused
    // save leaves every field exactly as typed.
    run(
      () => updateVendor(vendor.id, formData),
      () => {
        draft.clear();
        setIsEditing(false);
      },
    );
  }

  function handleDelete() {
    run(() => deleteVendor(vendor.id));
  }

  if (isEditing) {
    return (
      <li className="p-4">
        <form ref={draft.formRef} onSubmit={handleSave} onChange={draft.save} className="flex flex-col gap-3">
          <FormDraftNotice draft={draft} />
          <VendorFields defaults={vendor} />

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
              className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
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
        <p className="font-medium text-ink">{vendor.name}</p>
        {trade && <p className="text-xs text-link">{trade}</p>}
        <p className="text-sm text-ink-body">{contactLine || "No contact info"}</p>
        {vendor.notes && <p className="mt-1 text-sm text-ink-muted">{vendor.notes}</p>}
        {error && (
          <p role="alert" className="mt-1 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      <RowActions
        className="flex shrink-0 items-center gap-2"
        destructive={
          canDelete ? (
            <ConfirmDelete
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={handleDelete}
              deleteClassName="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:border-red-500 hover:text-red-400 disabled:opacity-50"
              cancelClassName="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-tag-rose disabled:opacity-50"
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => setIsEditing(true)}
          className="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Edit
        </button>
      </RowActions>
    </li>
  );
}

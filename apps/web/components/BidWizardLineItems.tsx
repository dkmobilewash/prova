"use client";

import { useState, useTransition } from "react";
import { addLineItem, addLineItemFromCatalog, deleteLineItem } from "@/lib/actions";
import { TakeoffForm } from "@/components/TakeoffForm";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { money } from "@/lib/money";

export interface WizardLineItem {
  id: string;
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string | null;
}

export interface WizardCatalogOption {
  id: string;
  description: string;
  unit: string | null;
}

const field =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";

/**
 * Step 2 of the bid-creation stepper: put work on the job. Three ways in —
 * type one line by hand, pull one from the catalog, or run a takeoff — and
 * a running list of what's on the estimate so far. This is deliberately a
 * SUBSET of what `jobs/[id]/page.tsx`'s own "Line items (estimate)"
 * section offers: no trade tag, no craft classification, no phase code, no
 * cost-to-complete forecasting. Those are management fields — they matter
 * once a job is running, not while somebody is still getting the bid's
 * scope onto paper — and every one of them stays fully editable on the
 * real job page afterward. Cramming them in here would just rebuild the
 * wall of fields this stepper exists to take apart.
 *
 * Each add action already calls `revalidatePath` (against `/jobs/${jobId}`,
 * the job's own page — not this URL). That still refreshes what's on
 * THIS screen: a Server Action's response always carries a root render
 * regardless of the path string passed to `revalidatePath` (see
 * CLAUDE.md's `router.refresh()` investigation, and `TakeoffForm`, which
 * has relied on exactly this for as long as it has existed). No
 * `router.refresh()` call is needed or added here.
 */
export function BidWizardLineItems({
  jobId,
  lineItems,
  catalogEntries,
}: {
  jobId: string;
  lineItems: WizardLineItem[];
  catalogEntries: WizardCatalogOption[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <ManualAddForm jobId={jobId} />
      {catalogEntries.length > 0 && <CatalogAddForm jobId={jobId} catalogEntries={catalogEntries} />}
      <TakeoffForm jobId={jobId} />

      <div className="rounded-lg border border-line-card bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink-label">On this estimate</h3>
        {lineItems.length === 0 ? (
          <p className="py-2 text-sm text-ink-body">Nothing added yet — use one of the ways above.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-row">
            {lineItems.map((item) => {
              const qty = Number(item.quantity);
              const price = item.unitPrice === null ? null : Number(item.unitPrice);
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{item.description}</p>
                    <p className="text-xs text-ink-muted">
                      {item.quantity} {item.unit ?? ""}
                      {price !== null && ` · ${money(price)}/${item.unit || "unit"} · ${money(qty * price)}`}
                    </p>
                  </div>
                  <ConfirmDeleteButton
                    action={deleteLineItem.bind(null, jobId, item.id)}
                    label="Remove"
                    confirmLabel="Confirm"
                    describe="Removes this line from the estimate. It can be added again from here or from the job page."
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ManualAddForm({ jobId }: { jobId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        const form = event.currentTarget;
        startTransition(async () => {
          try {
            await addLineItem(jobId, formData);
            form.reset();
          } catch (err) {
            // Nothing typed is lost: no reset happens on this branch, so
            // every field the contractor filled in is still on screen next
            // to the reason it didn't save.
            setError(err instanceof Error ? err.message : "Couldn't add that line item.");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-ink-label">Add a line</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Description
          <input name="description" required placeholder="5/8&quot; Type X drywall, level 2 corridor" className={`${field} min-w-[220px]`} />
        </label>
        <label className={labelClass}>
          Qty
          <input name="quantity" defaultValue="1" required inputMode="decimal" className={`${field} w-20`} />
        </label>
        <label className={labelClass}>
          Unit
          <input name="unit" placeholder="SF" className={`${field} w-20`} />
        </label>
        <label className={labelClass}>
          Unit price
          <input name="unitPrice" placeholder="cost-only" inputMode="decimal" className={`${field} w-28`} />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Adding…" : "Add line"}
        </button>
      </div>
      {error && <p className="text-sm text-tag-rose-ink">{error}</p>}
    </form>
  );
}

function CatalogAddForm({ jobId, catalogEntries }: { jobId: string; catalogEntries: WizardCatalogOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        const form = event.currentTarget;
        startTransition(async () => {
          try {
            await addLineItemFromCatalog(jobId, formData);
            form.reset();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't add that catalog line.");
          }
        });
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <label className={labelClass}>
        Add from catalog
        <select name="catalogEntryId" required className={`${field} min-w-[220px]`}>
          {catalogEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.description}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Qty
        <input name="quantity" defaultValue="1" required inputMode="decimal" className={`${field} w-20`} />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Adding…" : "Add from catalog"}
      </button>
      {error && <p className="w-full text-sm text-tag-rose-ink">{error}</p>}
    </form>
  );
}

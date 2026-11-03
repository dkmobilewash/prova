"use client";

import { useState, useTransition } from "react";
import { billRetainage } from "@/lib/actions";
import { localToday } from "@/components/localToday";
import { monthEnd } from "@/lib/month-end";
import { money } from "@/lib/money";
import { Spinner } from "@/components/Spinner";

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink focus:border-link focus:outline-none";
const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50";

/** Bills the retainage held as its own pay application. Opened by a click, so
 * today's date is safe to read here. */
export function BillRetainage({ jobId, held }: { jobId: string; held: number }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className={btn} onClick={() => setOpen(true)}>
        Bill the retainage ({money(held)} held)
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await billRetainage(jobId, form);
          if (result.ok) setOpen(false);
          else setError(result.error);
        });
      }}
    >
      <p className="text-sm text-ink-body">
        A pay application that bills the retainage held and no new work. Its G702 shows retainage to date going down by
        this amount, and this amount as the payment due.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Amount to bill
          <input name="amount" inputMode="decimal" required defaultValue={held.toFixed(2)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Period to
          <input name="periodTo" type="date" defaultValue={monthEnd(localToday())} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Description
          <input name="description" defaultValue="Retainage release" className={inputClass} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className={btn}>
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Billing…
            </span>
          ) : (
            "Create the retainage application"
          )}
        </button>
        <button type="button" disabled={isPending} className={btn} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}

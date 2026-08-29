"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createMaterialOrder } from "@/lib/actions";
import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";
import { MaterialOrderFields, type VendorOption } from "@/components/MaterialOrderFields";
import { localToday } from "@/components/localToday";

/** An order needs both a job to belong to and a vendor to be owed by, so
 * either one missing is a dead end with a way out rather than a form that
 * can't be submitted. */
function EmptyState({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-5">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
      <Link
        href={href}
        className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        {cta}
      </Link>
    </div>
  );
}

export function MaterialOrderForm({
  jobs,
  vendors,
  defaultJobId,
}: {
  jobs: JobOption[];
  vendors: VendorOption[];
  defaultJobId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs yet"
        body="A material order is always material for a specific job, so it has to belong to one. Create a job and the form will appear here."
        href="/dashboard"
        cta="Go to Jobs"
      />
    );
  }

  if (vendors.length === 0) {
    return (
      <EmptyState
        title="No vendors yet"
        body="An order needs someone on the hook for it — that's the whole point of tracking one. Add the supplier to your vendor directory first."
        href="/vendors"
        cta="Go to Vendors"
      />
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Log an order
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          // Actions in this module return their failures instead of
          // throwing — a thrown message is redacted to a digest in
          // production builds, verified 2026-08-27.
          const result = await createMaterialOrder(formData);
          if (result.ok) {
            formRef.current?.reset();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Log a material order</h2>

      <MaterialOrderFields
        jobs={jobs}
        vendors={vendors}
        defaultJobId={defaultJobId}
        defaults={{ description: "", vendorId: "", vendorReference: null, notes: null, promisedFor: null }}
      />

      <label className={labelClass}>
        Date ordered
        <input type="date" name="orderedOn" required defaultValue={localToday()} className={inputClass} />
        <span className="text-xs text-slate-500">
          The date you actually placed it, not today — backdate it when you&apos;re entering orders
          already out.
        </span>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save order"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

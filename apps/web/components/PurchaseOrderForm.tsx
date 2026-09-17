"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createPurchaseOrder } from "@/lib/actions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";
import { type JobOption } from "@/components/RfiFields";
import {
  PurchaseOrderFields,
  type PurchaseOrderVendorOption,
} from "@/components/PurchaseOrderFields";

/** A purchase order needs a job to be raised against and a vendor to be
 * issued to, so either one missing is a dead end — with a way out rather
 * than a sentence telling the reader to go and find it. */
function EmptyState({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5">
      <p className="text-sm font-medium text-ink-label">{title}</p>
      <p className="mt-1 text-sm text-ink-body">{body}</p>
      <Link
        href={href}
        className="mt-3 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        {cta}
      </Link>
    </div>
  );
}

export function PurchaseOrderForm({
  jobs,
  vendors,
  defaultJobId,
}: {
  jobs: JobOption[];
  vendors: PurchaseOrderVendorOption[];
  defaultJobId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("purchase-order:create");

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs yet"
        body="A purchase order is always raised against one job — that is what the number is scoped to and what the cost codes come from. Create a job and this form appears."
        href="/jobs/new"
        cta="Create a job"
      />
    );
  }

  if (vendors.length === 0) {
    return (
      <EmptyState
        title="No vendors yet"
        body="A purchase order commits you to somebody. Add the supplier to your vendor directory first — their vendor number and address come from there and print on the order."
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
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Raise a purchase order
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
          // This action RETURNS its failures — production redacts a thrown
          // Server Action message to a digest, so a thrown refusal would
          // render as a button that does nothing.
          const result = await createPurchaseOrder(formData);
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
      <h2 className="text-sm font-semibold text-ink-label">Raise a purchase order</h2>
      <p className="text-xs text-ink-muted">
        The next number on this job is issued when you save. Line items are added one at a time
        afterwards.
      </p>
      <FormDraftNotice draft={draft} />

      <PurchaseOrderFields
        jobs={jobs}
        vendors={vendors}
        defaultJobId={defaultJobId}
        defaults={{
          vendorId: "",
          title: "",
          shipToAddress: null,
          paymentTerms: null,
          awardedOn: null,
          expectedOn: null,
          notes: null,
        }}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Issue the order"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

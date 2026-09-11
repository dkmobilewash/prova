"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { recordWorkerCertification } from "@/lib/actions";
import {
  CertificationFields,
  type CertificationDefaults,
  type WorkerOption,
} from "@/components/CertificationFields";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

const EMPTY: CertificationDefaults = {
  otherLabel: null,
  issuer: null,
  referenceNumber: null,
  issuedOn: null,
  expiresOn: null,
  notes: null,
  documentUrl: null,
  documentLabel: null,
};

/** Collapsed behind a button until someone wants it, like every other add
 * form in this app. The submit button is disabled while the action is in
 * flight — no create action here is idempotent, and a page that stalls
 * after a commit invites a second click (see #19). */
export function CertificationForm({
  workers,
  defaultWorkerId,
}: {
  workers: WorkerOption[];
  defaultWorkerId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("worker-certification:create");

  if (workers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5">
        <p className="text-sm font-medium text-ink-label">Nobody on the team yet</p>
        <p className="mt-1 text-sm text-ink-body">
          A certification belongs to a person, and the point of recording one is knowing whether the
          crew you dispatch tomorrow is clear. Invite the people you dispatch and this form appears
          here.
        </p>
        <Link
          href="/team"
          className="mt-3 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500"
        >
          Go to Team
        </Link>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500"
      >
        Record a certification
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
          const result = await recordWorkerCertification(formData);
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
      <h2 className="text-sm font-semibold text-ink-label">Record a certification</h2>
      <FormDraftNotice draft={draft} />
      <p className="text-xs text-ink-muted">
        A renewal is a new record, not an edit of the old one. The superseded card stays on file —
        it is what says who was qualified on the day of an incident.
      </p>

      <CertificationFields defaults={EMPTY} workers={workers} defaultWorkerId={defaultWorkerId} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save certification"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

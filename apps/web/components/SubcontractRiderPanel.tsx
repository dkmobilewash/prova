"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  attachSubcontractRider,
  createSubcontractRider,
  deleteSubcontractRider,
  saveSubcontractRider,
} from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { Spinner } from "@/components/Spinner";
import type { RiderView } from "@/lib/subcontract-review/query";

/**
 * The rider: drafted by code from the job's exclusions and clarifications and
 * the findings marked Negotiating, edited here, then attached as the job's
 * next contract version. Attaching sends NOTHING — the version appears in the
 * job's Subcontract agreement section, where e-sign and DocuSign already are,
 * and sending is a separate press there.
 */
const buttonClass =
  "min-h-12 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:cursor-not-allowed disabled:opacity-60";

export function SubcontractRiderPanel({ jobId, riders }: { jobId: string; riders: RiderView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmAttach, setConfirmAttach] = useState(false);
  const [isPending, startTransition] = useTransition();
  const draft = riders.find((rider) => rider.status === "DRAFT") ?? null;
  const attached = riders.filter((rider) => rider.status === "ATTACHED");

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      if (done) setNotice(done);
      setConfirmAttach(false);
      router.refresh();
    });
  };

  return (
    <section className="mb-8 print:hidden" data-subcontract-review="rider">
      <h2 className="mb-1 text-lg font-semibold text-ink">Rider</h2>
      <p className="mb-3 text-sm text-ink-body">
        A rider carries your exclusions, clarifications and negotiated positions back to the GC as part of the
        subcontract. The draft is built from this job&apos;s proposal clauses and the findings you marked Negotiating —
        edit every word before you attach it.
      </p>

      {attached.map((rider) => (
        <p key={rider.id} className="mb-2 text-sm text-ink-body" data-subcontract-review="rider-attached">
          <span className="text-ink">{rider.title}</span> — attached as contract version {rider.attachedVersionNumber ?? "?"}.
          Send it for signature from the job&apos;s{" "}
          <Link href={`/jobs/${jobId}#contract-signature`} className="text-link hover:underline">
            Subcontract agreement
          </Link>{" "}
          section; nothing has been sent.
        </p>
      ))}

      {!draft ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => createSubcontractRider(jobId))}
          className={buttonClass}
          data-subcontract-review="rider-create"
        >
          {isPending ? <Spinner /> : attached.length > 0 ? "Draft another rider" : "Draft a rider"}
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => saveSubcontractRider(draft.id, formData), "Saved.");
          }}
          className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
        >
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Title
            <input
              name="title"
              defaultValue={draft.title}
              className="min-h-12 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Text — a line starting “## ” is a heading, “- ” is a list item
            <textarea
              name="body"
              defaultValue={draft.body}
              rows={16}
              className="rounded-md border border-line-card bg-canvas px-3 py-2 font-mono text-sm text-ink"
              data-subcontract-review="rider-body"
            />
          </label>
          <RowActions
            className="flex flex-wrap items-center gap-2"
            destructive={
              <ConfirmDelete
                label="Delete draft"
                confirmLabel="Delete it"
                describe="Deletes this draft rider. Nothing has been attached or sent."
                pending={isPending}
                onConfirm={() => run(() => deleteSubcontractRider(draft.id))}
              />
            }
          >
            <button type="submit" disabled={isPending} className={buttonClass}>
              Save
            </button>
            <Link
              href={`/jobs/${jobId}/subcontract-review/rider/${draft.id}`}
              className="text-sm text-link hover:underline"
              data-subcontract-review="rider-print"
            >
              Print preview →
            </Link>
            {confirmAttach ? (
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setConfirmAttach(false)} className={buttonClass}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => attachSubcontractRider(draft.id), "Attached as a new contract version. Nothing was sent.")}
                  className="min-h-12 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover disabled:opacity-60"
                  data-subcontract-review="rider-attach-confirm"
                >
                  Attach the saved text
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmAttach(true)}
                className={buttonClass}
                data-subcontract-review="rider-attach"
              >
                Attach as a contract version
              </button>
            )}
          </RowActions>
          {confirmAttach && (
            <p className="text-sm text-ink-body">
              Attaching saves the rider as a PDF and files it as this job&apos;s next contract version. After that it can&apos;t
              be edited — save first. It is not sent to anyone.
            </p>
          )}
        </form>
      )}

      {notice && (
        <p role="status" className="mt-2 text-sm text-ok">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

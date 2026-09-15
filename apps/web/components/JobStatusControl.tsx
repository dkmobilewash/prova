"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStatus } from "@/lib/actions";
import { StatusBadge } from "@prova/ui";
import {
  allowedJobStatusTransitions,
  JOB_STATUS_ACTION_LABELS,
  JOB_STATUS_LABELS,
  type JobStatusValue,
} from "@/lib/job-status-transitions";

/**
 * Where the job is, and the moves available from here.
 *
 * Only the LEGAL next steps get a button — the illegal ones are not drawn
 * greyed out, because a disabled button is a question the reader has to
 * answer for themselves. The action refuses them anyway (it is its own
 * endpoint and answers whoever posts to it), and when it does, its sentence
 * is rendered right here rather than thrown: production redacts a thrown
 * Server Action message to a digest.
 *
 * An ESTIMATE job gets no buttons at all and a line saying why, because
 * leaving an estimate is `markJobContracted`'s job — that is where the
 * evidence gate lives.
 */
export function JobStatusControl({
  jobId,
  status,
}: {
  jobId: string;
  status: JobStatusValue;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const moves = allowedJobStatusTransitions(status);

  return (
    <div className="rounded-lg border border-line-card bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-body">Status</span>
        <StatusBadge status={status} />

        {moves.map((next) => (
          <button
            key={next}
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await setJobStatus(jobId, next);
                if (result.ok) {
                  router.refresh();
                } else {
                  setError(result.error);
                }
              });
            }}
            className="rounded-md border border-line-card px-3 py-1.5 text-sm font-medium text-ink-label hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Saving…" : JOB_STATUS_ACTION_LABELS[next]}
          </button>
        ))}
      </div>

      {status === "ESTIMATE" ? (
        <p className="mt-2 text-sm text-ink-muted">
          An estimate becomes a contracted job further down this page, once the contract is
          executed — either the GC signs it in C Stream or you record the executed subcontract they
          sent.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          Status is set by hand, never guessed from time entries or dates. Currently{" "}
          {JOB_STATUS_LABELS[status].toLowerCase()}.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-tag-rose-ink">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setJobStatus } from "@/lib/actions";
import { StatusBadge } from "@prova/ui";
import {
  allowedJobStatusTransitions,
  JOB_STATUS_ACTION_LABELS,
  JOB_STATUS_LABELS,
  type JobStatusValue,
} from "@/lib/job-status-transitions";
import { Spinner } from "@/components/Spinner";

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
  showsEstimateTab = true,
}: {
  jobId: string;
  status: JobStatusValue;
  /** Whether this viewer has the estimate page (and the header's "Won
   * it?" box), where "Mark contracted" lives. Without it the sentence names the step but links nothing — a
   * link to a page that refuses is a door that will not open. */
  showsEstimateTab?: boolean;
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
            className="rounded-md border border-line-card px-3 py-1.5 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner />
                Saving…
              </span>
            ) : (
              JOB_STATUS_ACTION_LABELS[next]
            )}
          </button>
        ))}
      </div>

      {status === "ESTIMATE" ? (
        <p className="mt-2 text-sm text-ink-muted">
          An estimate becomes a contracted job with Mark contracted{" "}
          {showsEstimateTab ? (
            <>
              — the &ldquo;Won it?&rdquo; box at the top of this job, or the{" "}
              <Link href={`/jobs/${jobId}/estimate#job-lock-in`} className="text-link hover:underline">
                bottom of the estimate page
              </Link>{" "}
              —
            </>
          ) : (
            "on the job's estimate page (the Estimate step)"
          )}
          , once the contract is executed — either the GC signs it in C Stream or you record the
          executed subcontract they sent, under Contract signature below.
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

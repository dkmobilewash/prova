"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceSubcontractReview, continueSubcontractReview, startSubcontractReview } from "@/lib/actions";
import { uploadDocumentFile } from "@/lib/document-upload-client";
import { EXHIBIT_ROLES, SOURCE_ROLE_LABEL, type SourceRole } from "@/lib/subcontract-review/roles";
import { Spinner } from "@/components/Spinner";

/**
 * The control that runs an AI subcontract review: choose exhibits, start, and
 * keep reading one chunk at a time while the page is open.
 *
 * THE LOOP LIVES HERE, ON PURPOSE. A server function has 60 seconds; a
 * 100-page contract is a dozen model calls. So the open page calls
 * `advanceSubcontractReview` once per chunk, refreshing after each so findings
 * appear as they are read — plan ingestion's shape. Close the tab and the review
 * simply waits; open it again and it carries on from the next unread chunk.
 *
 * Nothing here saves a finding as anything but a proposal. The decisions are on
 * each finding's own card.
 */

type ReviewState = {
  id: string;
  state: "RUNNING" | "STOPPED" | "COMPLETE";
  failureReason: string | null;
  chunksDone: number;
  chunksTotal: number;
} | null;

type ExhibitRow = { key: number; role: SourceRole; file: File | null };

export function SubcontractReviewPanel({
  jobId,
  contractDocumentId,
  versionNumber,
  review,
}: {
  jobId: string;
  contractDocumentId: string;
  versionNumber: number;
  review: ReviewState;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string | null>(review?.state === "STOPPED" ? review.failureReason : null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    review && review.state !== "COMPLETE" ? { done: review.chunksDone, total: review.chunksTotal } : null,
  );
  const [running, setRunning] = useState(false);
  const [exhibits, setExhibits] = useState<ExhibitRow[]>([]);
  const [showSetup, setShowSetup] = useState(review === null);
  const [isPending, startTransition] = useTransition();
  const nextKey = useRef(1);
  const looping = useRef(false);

  const loop = useCallback(
    async (reviewId: string) => {
      if (looping.current) return;
      looping.current = true;
      setRunning(true);
      try {
        for (let guard = 0; guard < 500; guard++) {
          const result = await advanceSubcontractReview(reviewId);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setProgress({ done: result.value.chunksDone, total: result.value.chunksTotal });
          router.refresh();
          if (result.value.stopped) {
            setStopped(result.value.stopped);
            return;
          }
          if (result.value.done) {
            setProgress(null);
            return;
          }
        }
      } finally {
        looping.current = false;
        setRunning(false);
      }
    },
    [router],
  );

  // A review left RUNNING (a closed tab, a refresh) carries on by itself.
  useEffect(() => {
    if (review?.state === "RUNNING") void loop(review.id);
  }, [review?.id, review?.state, loop]);

  const start = () => {
    setError(null);
    setStopped(null);
    startTransition(async () => {
      const uploaded: { fileUrl: string; fileName: string; role: SourceRole }[] = [];
      for (const row of exhibits) {
        if (!row.file) continue;
        const result = await uploadDocumentFile("subcontract-review-source", jobId, row.file);
        if (!result.ok) {
          setError(`${SOURCE_ROLE_LABEL[row.role]}: ${result.error}`);
          return;
        }
        uploaded.push({ fileUrl: result.fileUrl, fileName: result.fileName ?? row.file.name, role: row.role });
      }
      const formData = new FormData();
      formData.set("exhibits", JSON.stringify(uploaded));
      const started = await startSubcontractReview(contractDocumentId, formData);
      if (!started.ok) {
        setError(started.error);
        return;
      }
      setShowSetup(false);
      setExhibits([]);
      setProgress({ done: 0, total: 0 });
      router.refresh();
      void loop(started.value.reviewId);
    });
  };

  const resume = () => {
    if (!review) return;
    setError(null);
    startTransition(async () => {
      const result = await continueSubcontractReview(review.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStopped(null);
      void loop(review.id);
    });
  };

  const busy = running || isPending;

  return (
    <section
      data-subcontract-review="panel"
      className="mb-6 flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4 print:hidden"
    >
      {busy && progress && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-body" data-subcontract-review="progress">
          <Spinner />
          {progress.total > 0
            ? `Reading part ${Math.min(progress.done + 1, progress.total)} of ${progress.total}. Findings appear below as each part is read — keep this page open.`
            : "Reading the files…"}
        </p>
      )}

      {stopped && !busy && (
        <div role="alert" className="flex flex-col gap-2" data-subcontract-review="stopped">
          <p className="text-sm text-warn">{stopped}</p>
          <div>
            <button
              type="button"
              onClick={resume}
              className="min-h-12 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
            >
              Continue the review
            </button>
          </div>
        </div>
      )}

      {!showSetup && !busy && (
        <div>
          <button
            type="button"
            onClick={() => setShowSetup(true)}
            className="min-h-12 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
          >
            {review ? "Run the review again on this version" : "Review this version"}
          </button>
        </div>
      )}

      {showSetup && !busy && (
        <div className="flex flex-col gap-3" data-subcontract-review="setup">
          <p className="text-sm text-ink-body">
            Reads version {versionNumber} of the subcontract and any exhibits you add — scope of work, insurance
            requirements, general conditions. Each finding quotes the contract word for word and names the page;
            anything that cannot be found on the page is thrown away rather than shown. Scanned pages have no text
            to quote and are listed as unread. Nothing is saved to the job, and nothing is sent to anyone.
          </p>

          {exhibits.map((row) => (
            <div key={row.key} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                What it is
                <select
                  value={row.role}
                  onChange={(event) =>
                    setExhibits((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, role: event.target.value as SourceRole } : r)),
                    )
                  }
                  className="min-h-12 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink"
                >
                  {EXHIBIT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {SOURCE_ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                File
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setExhibits((rows) => rows.map((r) => (r.key === row.key ? { ...r, file } : r)));
                  }}
                  className="text-sm text-ink-label file:mr-3 file:rounded-md file:border-0 file:bg-rail-hover file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-lift"
                />
              </label>
              <button
                type="button"
                onClick={() => setExhibits((rows) => rows.filter((r) => r.key !== row.key))}
                className="min-h-12 rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-rail-hover"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                setExhibits((rows) => [...rows, { key: nextKey.current++, role: "SCOPE_EXHIBIT", file: null }])
              }
              className="min-h-12 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
            >
              Add an exhibit
            </button>
            <button
              type="button"
              onClick={start}
              data-subcontract-review="start"
              className="min-h-12 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
            >
              Start the review
            </button>
            {review && (
              <button
                type="button"
                onClick={() => setShowSetup(false)}
                className="min-h-12 rounded-md px-4 py-2 text-sm text-ink-muted hover:bg-rail-hover"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger" data-subcontract-review="error">
          {error}
        </p>
      )}
    </section>
  );
}

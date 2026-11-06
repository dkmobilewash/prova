"use client";

import { useRef, useState, useTransition } from "react";
import { formatDocumentSize } from "@/lib/document-uploads";

import { SubmitButton } from "@/components/SubmitButton";
import { Spinner } from "@/components/Spinner";
import { uploadPlanSetFile } from "@/lib/document-upload-client";
import { PDF_MAGIC_BYTES, looksLikePdf } from "@/lib/pdf-bytes";
import { recordTakeoffPlan } from "@/lib/actions";

/**
 * Puts a drawing where the viewer can open it.
 *
 * THE UPLOAD CANNOT GO THROUGH THE SERVER ACTION, and that is a framework
 * limit rather than a choice: Next caps an action body at 1MB, including
 * multipart file parts, and a bid sheet is far past it. So the browser uploads
 * under a one-shot token from `/api/documents/upload` and then calls the
 * action with the URL — the same triad site photos, contract documents and
 * document intake all already use.
 *
 * The magic-byte check is here so a DWG or a scanned JPEG is refused before a
 * token is minted, with a sentence naming what went wrong, instead of failing
 * later inside pdf.js where the message would be about a corrupt stream.
 */
export function TakeoffPlanUploader({ jobId }: { jobId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** How far the bytes are, while they go. */
  const [progress, setProgress] = useState<{ loaded: number; total: number; percent: number } | null>(null);
  /** The file an upload stopped on, kept for Resume: its stored parts are not sent again. */
  const [stopped, setStopped] = useState<File | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const file = inputRef.current?.files?.[0] ?? stopped ?? undefined;
    if (!file) {
      setError("Pick a PDF of the sheet you're bidding.");
      return;
    }

    const head = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES).arrayBuffer());
    if (!looksLikePdf(head)) {
      setError("That file isn't a PDF. Export the sheet to PDF and try again.");
      return;
    }

    setBusy(true);
    setStopped(null);
    setProgress({ loaded: 0, total: file.size, percent: 0 });
    const uploaded = await uploadPlanSetFile(jobId, file, { onProgress: setProgress });
    setBusy(false);
    if (!uploaded.ok) {
      setError(uploaded.error);
      // Only an upload that stopped on the way can be resumed; a refusal cannot.
      if (uploaded.resumable) setStopped(file);
      return;
    }
    setProgress(null);

    const formData = new FormData();
    formData.set("fileUrl", uploaded.fileUrl);
    if (uploaded.fileName) formData.set("fileName", uploaded.fileName);
    startTransition(async () => {
      const result = await recordTakeoffPlan(jobId, formData);
      if (result && !result.ok) {
        setError(result.error);
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="text-sm text-ink-body file:mr-3 file:rounded-md file:border file:border-line-card file:bg-surface-input file:px-3 file:py-1.5 file:text-sm file:text-ink-label"
        />
        <SubmitButton
          type="submit"
          disabled={busy || isPending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {busy ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Uploading…
            </span>
          ) : (
            "Add a drawing"
          )}
        </SubmitButton>
      </div>
      <p className="text-xs text-ink-muted">
        Upload the sheets you&rsquo;re bidding rather than the whole set — this is a measuring tool, not a drawing
        register. The issued set belongs on Drawings.
      </p>
      {/* ── HOW FAR, WHILE IT GOES ── A 342 MB set is minutes on a site connection. */}
      {busy && progress !== null && (
        <div className="flex items-center gap-2" data-takeoff="plan-upload-progress">
          <progress value={progress.percent} max={100} className="h-2 w-48" aria-label="Upload progress" />
          <span className="text-xs tabular-nums text-ink-body" data-takeoff="plan-upload-progress-text">
            {formatDocumentSize(progress.loaded)} of {formatDocumentSize(progress.total)} · {progress.percent}%
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-tag-rose-ink">
          {error}
        </p>
      )}
      {stopped !== null && !busy && (
        <button
          type="submit"
          className="self-start rounded-md border border-line-card px-3 py-1.5 text-sm font-medium text-ink-body hover:bg-rail"
          data-takeoff="plan-upload-resume"
        >
          Resume the upload of {stopped.name}
        </button>
      )}
    </form>
  );
}
